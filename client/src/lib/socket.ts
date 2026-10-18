import { io, type Socket } from 'socket.io-client';

/** Conexão de sinalização na mesma origem (em dev, o Vite faz proxy para :3000). */
export function createSocket(): Socket {
  return io({
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });
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
