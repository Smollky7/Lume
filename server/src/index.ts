import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { HOST, HOST_GRACE_MS, MAX_VIEWERS, PORT, TRUST_PROXY, getIceServers, hasTurn } from './config.js';
import { createRoom, rooms, sanitizeName, verifyHostToken, verifyPassword, type Room } from './rooms.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../../client/dist');

const app = express();
app.use((req, res, next) => {
  const origin = process.env.FRONTEND_URL;

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  next();
});
app.disable('x-powered-by');
if (TRUST_PROXY) app.set('trust proxy', true);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Discord Activities use an iframe. CSP restricts who can embed the app.
  // X-Frame-Options DENY would block the Activity.
  res.setHeader('Permissions-Policy', 'display-capture=(self), microphone=(self), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
      "media-src 'self' blob: mediastream:; connect-src 'self' ws: wss:; frame-ancestors 'self' https://discord.com https://*.discordsays.com",
  );
  next();
});

// --- Limite simples de tentativas por IP (força bruta de senha / criação de salas) ---
const buckets = new Map<string, { count: number; reset: number }>();
function hit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

function clientIp(socket: Socket): string {
  if (TRUST_PROXY) {
    const h = socket.handshake.headers;
    const cf = h['cf-connecting-ip'];
    if (typeof cf === 'string') return cf;
    const xff = h['x-forwarded-for'];
    if (typeof xff === 'string') return xff.split(',')[0].trim();
  }
  return socket.handshake.address;
}

// Activity lobby: up to four independent existing host rooms per Discord instance.
// This is ephemeral shared state, not Discord authentication. Use only trusted calls.
type ActivityStream = { roomId: string; title: string };
const activityStreams = new Map<string, ActivityStream[]>();
const activityKey = (raw: unknown): string | null =>
  typeof raw === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(raw) ? raw : null;
function activityList(id: string): ActivityStream[] {
  return (activityStreams.get(id) || []).filter(s => rooms.has(s.roomId));
}

app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

app.get('/api/rooms/:id', (req, res) => {
  if (!hit(`lookup:${req.ip}`, 60, 60_000)) return res.status(429).json({ error: 'rate_limited' });
  const room = rooms.get(req.params.id);
  if (!room) return res.json({ exists: false });
  res.json({ exists: true, protected: !!room.passwordHash, state: room.state });
});

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else {
  app.get('/', (_req, res) =>
    res.type('text').send('Frontend ainda não compilado. Rode "npm run build" ou use "npm run dev".'),
  );
}

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
    origin: process.env.FRONTEND_URL,
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 1e5, // sinalização só carrega SDP/ICE
  pingInterval: 5000,
  pingTimeout: 8000,
});

type Ack = (res: Record<string, unknown>) => void;

function endRoom(room: Room, reason: string) {
  if (room.graceTimer) clearTimeout(room.graceTimer);
  io.to(room.id).emit('room:ended', { reason });
  io.in(room.id).socketsLeave(room.id);
  rooms.delete(room.id);
  for (const [id, streams] of activityStreams) {
    if (streams.some(s => s.roomId === room.id)) {
      const next = streams.filter(s => s.roomId !== room.id);
      activityStreams.set(id, next);
      io.to(`activity:${id}`).emit('activity:streams', next);
    }
  }
}

const emitViewers = (room: Room) => io.to(room.id).emit('room:viewers', { count: room.viewers.size });

io.on('connection', (socket) => {
  let activityId: string | null = null;
  socket.on('activity:join', (raw: unknown, ack?: Ack) => {
    const id = activityKey(raw);
    if (!id) return ack?.({ ok: false, error: 'invalid_instance' });
    if (activityId) socket.leave(`activity:${activityId}`);
    activityId = id;
    socket.join(`activity:${id}`);
    ack?.({ ok: true, streams: activityList(id) });
  });
  socket.on('activity:add', (payload: { roomId?: string; title?: string } | undefined, ack?: Ack) => {
    if (!activityId || !hit(`activity-edit:${socket.id}`, 20, 60_000)) return ack?.({ ok: false, error: 'rate_limited' });
    const id = typeof payload?.roomId === 'string' ? payload.roomId.trim() : '';
    const room = rooms.get(id);
    if (!room || room.passwordHash) return ack?.({ ok: false, error: 'room_missing_or_protected' });
    const list = activityList(activityId);
    if (!list.some(s => s.roomId === id) && list.length >= 4) return ack?.({ ok: false, error: 'activity_full' });
    const title = sanitizeName(payload?.title || 'Tela compartilhada');
    const next = [...list.filter(s => s.roomId !== id), { roomId: id, title }];
    activityStreams.set(activityId, next);
    io.to(`activity:${activityId}`).emit('activity:streams', next);
    ack?.({ ok: true });
  });
  socket.on('activity:remove', (roomId: unknown, ack?: Ack) => {
    if (!activityId || typeof roomId !== 'string') return ack?.({ ok: false });
    const next = activityList(activityId).filter(s => s.roomId !== roomId);
    activityStreams.set(activityId, next);
    io.to(`activity:${activityId}`).emit('activity:streams', next);
    ack?.({ ok: true });
  });
  let roomId: string | null = null;
  let role: 'host' | 'viewer' | null = null;
  const ip = clientIp(socket);

  const currentRoom = () => (roomId ? rooms.get(roomId) : undefined);

  socket.on('room:create', async (payload: { password?: string } | undefined, ack?: Ack) => {
    if (typeof ack !== 'function') return;
    if (!hit(`create:${ip}`, 10, 60_000)) return ack({ ok: false, error: 'rate_limited' });
    const password = typeof payload?.password === 'string' && payload.password ? payload.password.slice(0, 128) : undefined;
    const iceServers = await getIceServers();
    const room = createRoom(socket.id, password);
    roomId = room.id;
    role = 'host';
    socket.join(room.id);
    ack({ ok: true, roomId: room.id, hostToken: room.hostToken, iceServers, turn: hasTurn(iceServers) });
  });

  socket.on('room:resume', async (payload: { roomId?: string; hostToken?: string } | undefined, ack?: Ack) => {
    if (typeof ack !== 'function') return;
    const room = typeof payload?.roomId === 'string' ? rooms.get(payload.roomId) : undefined;
    if (!room || !verifyHostToken(room, payload?.hostToken)) return ack({ ok: false, error: 'not_found' });
    if (room.graceTimer) clearTimeout(room.graceTimer);
    room.graceTimer = undefined;
    room.hostSocketId = socket.id;
    roomId = room.id;
    role = 'host';
    socket.join(room.id);
    io.to(room.id).emit('room:host-online');
    ack({ ok: true, viewers: [...room.viewers.values()], iceServers: await getIceServers() });
  });

  socket.on(
    'room:join',
    async (payload: { roomId?: string; password?: string; name?: string } | undefined, ack?: Ack) => {
      if (typeof ack !== 'function') return;
      const room = typeof payload?.roomId === 'string' ? rooms.get(payload.roomId) : undefined;
      if (!room) return ack({ ok: false, error: 'not_found' });
      if (room.passwordHash && !hit(`pw:${ip}`, 8, 60_000)) return ack({ ok: false, error: 'rate_limited' });
      if (!verifyPassword(room, payload?.password)) return ack({ ok: false, error: 'bad_password' });
      if (!room.viewers.has(socket.id) && room.viewers.size >= MAX_VIEWERS) return ack({ ok: false, error: 'room_full' });

      const iceServers = await getIceServers();
      if (!rooms.has(room.id)) return ack({ ok: false, error: 'not_found' });
      const viewer = { id: socket.id, name: sanitizeName(payload?.name) };
      room.viewers.set(socket.id, viewer);
      roomId = room.id;
      role = 'viewer';
      socket.join(room.id);
      ack({
        ok: true,
        viewerId: socket.id,
        iceServers,
        state: room.state,
        hostOnline: !!room.hostSocketId,
        count: room.viewers.size,
      });
      if (room.hostSocketId) io.to(room.hostSocketId).emit('viewer:joined', viewer);
      socket.to(room.id).emit('peer:joined', { name: viewer.name });
      emitViewers(room);
    },
  );

  // Sinalização WebRTC: o anfitrião sempre faz a oferta; espectadores respondem.
  socket.on('signal:to-viewer', (msg: { to?: string; data?: unknown } | undefined) => {
    const room = currentRoom();
    if (!room || role !== 'host' || typeof msg?.to !== 'string' || !room.viewers.has(msg.to)) return;
    io.to(msg.to).emit('signal', { from: socket.id, data: msg.data });
  });

  socket.on('signal:to-host', (msg: { data?: unknown } | undefined) => {
    const room = currentRoom();
    if (!room || role !== 'viewer' || !room.hostSocketId) return;
    io.to(room.hostSocketId).emit('signal', { from: socket.id, data: msg?.data });
  });

  socket.on('room:state', (msg: { state?: string } | undefined) => {
    const room = currentRoom();
    if (!room || role !== 'host') return;
    if (msg?.state !== 'live' && msg?.state !== 'paused') return;
    room.state = msg.state;
    io.to(room.id).emit('room:state', { state: room.state });
  });

  socket.on('room:end', () => {
    const room = currentRoom();
    if (!room || role !== 'host') return;
    endRoom(room, 'host_ended');
  });

  socket.on('disconnect', () => {
    const room = currentRoom();
    if (!room) return;
    if (role === 'host' && room.hostSocketId === socket.id) {
      room.hostSocketId = null;
      io.to(room.id).emit('room:host-offline');
      room.graceTimer = setTimeout(() => endRoom(room, 'host_gone'), HOST_GRACE_MS);
    } else if (role === 'viewer') {
      const viewer = room.viewers.get(socket.id);
      room.viewers.delete(socket.id);
      if (viewer) {
        if (room.hostSocketId) io.to(room.hostSocketId).emit('viewer:left', { id: viewer.id, name: viewer.name });
        socket.to(room.id).emit('peer:left', { name: viewer.name });
      }
      emitViewers(room);
    }
  });
});

server.listen(PORT, HOST, async () => {
  const turn = hasTurn(await getIceServers());
  console.log(`\n  Lume rodando em http://localhost:${PORT}`);
  console.log(
    turn
      ? '  TURN: configurado (conexões atrás de NAT/CGNAT podem usar relay)'
      : '  TURN: NÃO configurado — entre redes diferentes a conexão de vídeo pode travar em "estabelecendo conexão" (veja o README)',
  );
  console.log(`  Frontend compilado: ${fs.existsSync(clientDist) ? 'sim' : 'não (use npm run dev)'}\n`);
});
