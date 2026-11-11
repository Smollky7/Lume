import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

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

export async function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
  return (await scrypt(password, salt, 32)) as Buffer;
}

export async function createRoom(hostSocketId: string, password?: string): Promise<Room> {
  let id = crypto.randomBytes(16).toString('base64url');
  while (rooms.has(id)) id = crypto.randomBytes(16).toString('base64url');
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
  rooms.set(id, room);
  if (password) {
    room.passwordSalt = crypto.randomBytes(16);
    try {
      room.passwordHash = await hashPassword(password, room.passwordSalt);
    } catch (error) {
      rooms.delete(id);
      throw error;
    }
  }
  return room;
}

export async function verifyPassword(room: Room, password?: string): Promise<boolean> {
  if (!room.passwordHash || !room.passwordSalt) return true;
  if (typeof password !== 'string') return false;
  const candidate = await hashPassword(password, room.passwordSalt);
  return crypto.timingSafeEqual(candidate, room.passwordHash);
}

export function verifyHostToken(room: Room, token: unknown): boolean {
  if (typeof token !== 'string' || token.length !== 32) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(room.hostToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function sanitizeName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) : '';
  return s || 'Convidado';
}
