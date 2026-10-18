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
export const MAX_VIEWERS = Number(process.env.MAX_VIEWERS ?? 8);
export const TRUST_PROXY = (process.env.TRUST_PROXY ?? 'false') === 'true';
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

const dynamicCache = new Map<string, { servers: IceServer[]; expires: number }>();

const normalize = (raw: unknown): IceServer[] => {
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return (arr as IceServer[]).map((s) => ({
    ...s,
    // a porta 53 não funciona em navegadores e só atrasa a coleta de candidatos
    urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)),
  }));
};

async function fetchDynamic(key: string, ttlMs: number, load: () => Promise<unknown>): Promise<IceServer[]> {
  const hit = dynamicCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.servers;
  try {
    const servers = normalize(await load());
    dynamicCache.set(key, { servers, expires: Date.now() + ttlMs });
    return servers;
  } catch (e) {
    console.warn(`[ice] falha ao obter credenciais TURN (${key}):`, (e as Error).message);
    return hit?.servers ?? [];
  }
}

/** TURN gerenciado da Cloudflare (Realtime TURN): credenciais temporárias geradas pela API. */
async function cloudflareServers(): Promise<IceServer[]> {
  const id = process.env.CF_TURN_KEY_ID;
  const token = process.env.CF_TURN_API_TOKEN;
  if (!id || !token) return [];
  return fetchDynamic('cloudflare', 6 * 3600_000, async () => {
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
  const url = process.env.ICE_API_URL;
  if (!url) return [];
  return fetchDynamic('api', 3600_000, async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

export const hasTurn = (servers: IceServer[]) =>
  servers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /^turns?:/i.test(u)));

/** Monta a lista de servidores ICE enviada aos clientes. */
export async function getIceServers(): Promise<IceServer[]> {
  const stun = list(process.env.STUN_URLS);
  const servers: IceServer[] = [
    { urls: stun.length ? stun : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  servers.push(...(await cloudflareServers()), ...(await apiServers()));
  const turnUrls = list(process.env.TURN_URLS);
  if (turnUrls.length) {
    if (process.env.TURN_SECRET) {
      // coturn com "use-auth-secret": credenciais temporárias (TURN REST API)
      const username = String(Math.floor(Date.now() / 1000) + 6 * 3600);
      const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
      servers.push({ urls: turnUrls, username, credential });
    } else if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      servers.push({ urls: turnUrls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
    }
  }
  return servers;
}
