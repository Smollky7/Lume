import crypto from 'node:crypto';

export interface Viewer {
  id: string;
  name: string;
}

export interface Room {
  id: string;
  hostSocketId: string | null;
  hostToken: string;
  passwordHash: Buffer | null;
  passwordSalt: Buffer | null;
  viewers: Map<string, Viewer>;
  state: 'live' | 'paused';
  createdAt: number;
  graceTimer?: NodeJS.Timeout;
}

export const rooms = new Map<string, Room>();

export function hashPassword(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, 32);
}

export function createRoom(hostSocketId: string, password?: string): Room {
  let id = crypto.randomBytes(9).toString('base64url'); // 72 bits de entropia
  while (rooms.has(id)) id = crypto.randomBytes(9).toString('base64url');
  const room: Room = {
    id,
    hostSocketId,
    hostToken: crypto.randomBytes(24).toString('base64url'),
    passwordHash: null,
    passwordSalt: null,
    viewers: new Map(),
    state: 'live',
    createdAt: Date.now(),
  };
  if (password) {
    room.passwordSalt = crypto.randomBytes(16);
    room.passwordHash = hashPassword(password, room.passwordSalt);
  }
  rooms.set(id, room);
  return room;
}

export function verifyPassword(room: Room, password?: string): boolean {
  if (!room.passwordHash || !room.passwordSalt) return true;
  if (typeof password !== 'string') return false;
  const candidate = hashPassword(password, room.passwordSalt);
  return crypto.timingSafeEqual(candidate, room.passwordHash);
}

export function verifyHostToken(room: Room, token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const a = Buffer.from(token);
  const b = Buffer.from(room.hostToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function sanitizeName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) : '';
  return s || 'Convidado';
}
