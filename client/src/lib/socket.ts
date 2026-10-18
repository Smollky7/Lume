import { io, type Socket } from 'socket.io-client';

const DISCORD_BACKEND_PREFIX = '/.proxy/backend';

/** Verdadeiro quando a página está passando pelo proxy de Discord Activities. */
export function isDiscordActivity(): boolean {
  return new URLSearchParams(location.search).has('frame_id') || location.hostname.endsWith('.discordsays.com');
}

/**
 * Monta uma URL HTTP para a API.
 * Dentro da Activity, /backend é o URL Mapping configurado no Developer Portal.
 */
export function backendHttpUrl(pathname: string): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (isDiscordActivity()) return `${DISCORD_BACKEND_PREFIX}${path}`;
  const base = String(import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');
  return `${base}${path}`;
}

/** Conexão Socket.IO direta no navegador e via URL Mapping dentro do Discord. */
export function createSocket(): Socket {
  const discord = isDiscordActivity();
  const options = {
    path: discord ? `${DISCORD_BACKEND_PREFIX}/socket.io` : '/socket.io',
    transports: ['websocket', 'polling'] as ('websocket' | 'polling')[],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 10_000,
  };
  return discord ? io(options) : io(import.meta.env.VITE_BACKEND_URL || undefined, options);
}

export function emitAck<T = Record<string, unknown>>(socket: Socket, event: string, payload?: unknown, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
    socket.emit(event, payload, (res: T) => {
      window.clearTimeout(t);
      resolve(res);
    });
  });
}
