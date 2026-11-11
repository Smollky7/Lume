import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Carrega .env da raiz do projeto (sem dependências externas).
const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(here, '../../.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const [, key, raw] = m;
    if (process.env[key] === undefined) process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}

export const PORT = Number(process.env.PORT ?? 3000);
export const HOST = process.env.HOST ?? '0.0.0.0';
function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export const MAX_VIEWERS = boundedInteger(process.env.MAX_VIEWERS, 8, 1, 32);
export const MAX_ROOMS = boundedInteger(process.env.MAX_ROOMS, 500, 1, 10_000);
export const MAX_CONNECTIONS = boundedInteger(process.env.MAX_CONNECTIONS, 2_000, 1, 20_000);
export const MAX_ACTIVITY_SESSIONS = boundedInteger(process.env.MAX_ACTIVITY_SESSIONS, 5_000, 1, 20_000);
const proxyHops = process.env.TRUST_PROXY_HOPS ?? (process.env.TRUST_PROXY === 'true' ? '1' : process.env.TRUST_PROXY ?? '0');
export const TRUST_PROXY_HOPS = /^\d+$/.test(proxyHops) && Number(proxyHops) <= 10 ? Number(proxyHops) : 0;
export const HOST_GRACE_MS = 30_000;

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const list = (v?: string) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

interface DynamicCacheEntry {
  servers: IceServer[];
  refreshAt: number;
  expiresAt: number;
}

const dynamicCache = new Map<string, DynamicCacheEntry>();
const dynamicRequests = new Map<string, Promise<IceServer[]>>();
const DYNAMIC_RETRY_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeIceServers(raw: unknown): IceServer[] {
  const entries = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.iceServers) ? raw.iceServers : null;
  if (!entries?.length) throw new Error('invalid ICE server response');

  return entries.map((entry) => {
    if (!isRecord(entry)) throw new Error('invalid ICE server entry');
    const rawUrls = typeof entry.urls === 'string' ? [entry.urls] : entry.urls;
    if (!Array.isArray(rawUrls) || !rawUrls.length || !rawUrls.every((url) => typeof url === 'string')) {
      throw new Error('invalid ICE server URLs');
    }

    const urls = rawUrls.filter((url): url is string => !/:53(?:\?|$)/.test(url));
    if (urls.some((url) => !/^(?:stun|stuns|turn|turns):[^\s]+$/i.test(url)) || !urls.length) {
      throw new Error('invalid ICE server URL');
    }

    const hasTurnUrl = urls.some((url) => /^turns?:/i.test(url));
    const username = entry.username;
    const credential = entry.credential;
    if ((username !== undefined && typeof username !== 'string') || (credential !== undefined && typeof credential !== 'string')) {
      throw new Error('invalid ICE server credentials');
    }
    if ((username === undefined) !== (credential === undefined) || (hasTurnUrl && (!username || !credential))) {
      throw new Error('TURN credentials are missing');
    }

    return {
      urls: urls.length === 1 ? urls[0] : urls,
      ...(username === undefined ? {} : { username }),
      ...(credential === undefined ? {} : { credential }),
    };
  });
}

async function fetchDynamic(
  key: string,
  refreshMs: number,
  credentialLifetimeMs: number,
  load: () => Promise<unknown>,
): Promise<IceServer[]> {
  const now = Date.now();
  const hit = dynamicCache.get(key);
  if (hit && hit.refreshAt > now) return hit.servers;
  const pending = dynamicRequests.get(key);
  if (pending) return pending;

  const request = (async (): Promise<IceServer[]> => {
    try {
      const servers = normalizeIceServers(await load());
      const fetchedAt = Date.now();
      dynamicCache.set(key, {
        servers,
        refreshAt: fetchedAt + refreshMs,
        expiresAt: fetchedAt + credentialLifetimeMs,
      });
      return servers;
    } catch (error) {
      const failedAt = Date.now();
      const retryAt = failedAt + DYNAMIC_RETRY_MS;
      if (hit && hit.expiresAt > failedAt) {
        hit.refreshAt = Math.min(retryAt, hit.expiresAt);
        console.warn(`[ice] falha ao atualizar credenciais (${key}); usando cache ainda válido.`);
        return hit.servers;
      }
      dynamicCache.set(key, { servers: [], refreshAt: retryAt, expiresAt: failedAt });
      const reason = error instanceof Error && /^HTTP \d{3}$/.test(error.message) ? `: ${error.message}` : '';
      console.warn(`[ice] falha ao obter credenciais TURN (${key})${reason}.`);
      return [];
    }
  })();
  dynamicRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (dynamicRequests.get(key) === request) dynamicRequests.delete(key);
  }
}

/** TURN gerenciado da Cloudflare (Realtime TURN): credenciais temporárias geradas pela API. */
async function cloudflareServers(): Promise<IceServer[]> {
  const id = process.env.CF_TURN_KEY_ID;
  const token = process.env.CF_TURN_API_TOKEN;
  if (!id || !token) return [];
  return fetchDynamic('cloudflare', 6 * 3600_000, 86_340_000, async () => {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { iceServers?: unknown }).iceServers;
  });
}

/** Qualquer API que devolva um array de iceServers por GET (ex.: Metered). */
async function apiServers(): Promise<IceServer[]> {
  const url = process.env.ICE_API_URL?.trim();
  if (!url) return [];
  let endpoint: URL;
  try {
    endpoint = new URL(url);
  } catch {
    console.warn('[ice] ICE_API_URL inválida; provedor externo ignorado.');
    return [];
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    console.warn('[ice] ICE_API_URL deve usar HTTPS sem credenciais na URL; provedor externo ignorado.');
    return [];
  }
  return fetchDynamic('api', 3600_000, 3600_000, async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

export const hasTurn = (servers: IceServer[]) =>
  servers.some(
    (server) =>
      typeof server.username === 'string' &&
      !!server.username &&
      typeof server.credential === 'string' &&
      !!server.credential &&
      (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => /^turns?:/i.test(url)),
  );

/** Monta a lista de servidores ICE enviada aos clientes. */
export async function getIceServers(): Promise<IceServer[]> {
  let stun = list(process.env.STUN_URLS);
  if (stun.length) {
    try {
      stun = normalizeIceServers([{ urls: stun }]).flatMap((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]));
    } catch {
      console.warn('[ice] STUN_URLS inválida; usando servidores STUN padrão.');
      stun = [];
    }
  }
  const servers: IceServer[] = [
    { urls: stun.length ? stun : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  const [cloudflare, external] = await Promise.all([cloudflareServers(), apiServers()]);
  servers.push(...cloudflare, ...external);
  const turnUrls = list(process.env.TURN_URLS);
  if (turnUrls.length) {
    if (process.env.TURN_SECRET) {
      // coturn com "use-auth-secret": credenciais temporárias (TURN REST API)
      const username = String(Math.floor(Date.now() / 1000) + 6 * 3600);
      const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
      try {
        servers.push(...normalizeIceServers([{ urls: turnUrls, username, credential }]));
      } catch {
        console.warn('[ice] TURN_URLS inválida; coturn temporário ignorado.');
      }
    } else if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      try {
        servers.push(...normalizeIceServers([{ urls: turnUrls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL }]));
      } catch {
        console.warn('[ice] TURN_URLS inválida; servidor TURN ignorado.');
      }
    } else {
      console.warn('[ice] TURN_URLS configurada sem credenciais; servidor TURN ignorado.');
    }
  }
  return servers;
}
