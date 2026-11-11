import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { HOST, HOST_GRACE_MS, MAX_ACTIVITY_SESSIONS, MAX_CONNECTIONS, MAX_ROOMS, MAX_VIEWERS, PORT, TRUST_PROXY_HOPS, getIceServers, hasTurn } from './config.js';
import { clientIpFromHeaders } from './client-ip.js';
import { createRoom, rooms, sanitizeName, verifyHostToken, verifyPassword, type Room } from './rooms.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../../client/dist');

const app = express();
app.disable('x-powered-by');

const configuredOrigins = (process.env.FRONTEND_URL ?? '')
  .split(',')
  .map((value) => value.trim().replace(/\/$/, ''))
  .filter(Boolean);
const isAllowedOrigin = (origin?: string): boolean =>
  !origin ||
  configuredOrigins.includes(origin.replace(/\/$/, '')) ||
  /^https:\/\/(?:\d+\.)?discordsays\.com$/i.test(origin) ||
  (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  next();
});
app.set('trust proxy', TRUST_PROXY_HOPS);

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
const MAX_RATE_BUCKETS = 20_000;
function hit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    if (buckets.size >= MAX_RATE_BUCKETS) {
      for (const [bucketKey, bucket] of buckets) if (bucket.reset < now) buckets.delete(bucketKey);
      if (buckets.size >= MAX_RATE_BUCKETS) return false;
    }
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
  const forwardedFor = socket.handshake.headers['x-forwarded-for'];
  return clientIpFromHeaders(
    socket.request.socket.remoteAddress ?? socket.handshake.address,
    typeof forwardedFor === 'string' ? forwardedFor : undefined,
    TRUST_PROXY_HOPS,
  );
}

// Activity IDs route lobby updates; they are client-provided and are not authentication.
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

export const server = http.createServer(app);
export const io = new Server(server, {
  maxHttpBufferSize: 1e5, // sinalização só carrega SDP/ICE
  pingInterval: 5000,
  pingTimeout: 8000,
  cors: {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    methods: ['GET', 'POST'],
  },
});

io.use((socket, next) => {
  const origin = socket.handshake.headers.origin;
  if (typeof origin === 'string' && !isAllowedOrigin(origin)) return next(new Error('origin_not_allowed'));
  if (io.engine.clientsCount >= MAX_CONNECTIONS) return next(new Error('server_full'));
  next();
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
      if (next.length) activityStreams.set(id, next);
      else activityStreams.delete(id);
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
    if (!hit(`activity-join:${ip}`, 120, 60_000)) return ack?.({ ok: false, error: 'rate_limited' });
    if (activityId) socket.leave(`activity:${activityId}`);
    activityId = id;
    socket.join(`activity:${id}`);
    ack?.({ ok: true, streams: activityList(id) });
  });
  // The broadcaster itself announces an active stream: no copied links or names.
  socket.on('activity:publish', (payload: { instanceId?: string; roomId?: string } | undefined, ack?: Ack) => {
    const id = activityKey(payload?.instanceId);
    const room = typeof payload?.roomId === 'string' ? rooms.get(payload.roomId) : undefined;
    if (!id || !room || room.passwordHash || room.hostSocketId !== socket.id) {
      return ack?.({ ok: false, error: 'not_host' });
    }
    if (!hit(`activity-publish:${ip}`, 20, 60_000)) return ack?.({ ok: false, error: 'rate_limited' });
    if (!activityStreams.has(id) && activityStreams.size >= MAX_ACTIVITY_SESSIONS) return ack?.({ ok: false, error: 'server_full' });
    const list = activityList(id);
    if (!list.some(s => s.roomId === room.id) && list.length >= 4) return ack?.({ ok: false, error: 'activity_full' });
    const used = new Set(list.map((stream) => stream.title));
    const title = [1, 2, 3, 4].map((n) => `Tela ${n}`).find((candidate) => !used.has(candidate)) ?? 'Tela';
    const next = [...list.filter(s => s.roomId !== room.id), { roomId: room.id, title }];
    activityStreams.set(id, next);
    io.to(`activity:${id}`).emit('activity:streams', next);
    ack?.({ ok: true });
  });
  let roomId: string | null = null;
  let role: 'host' | 'viewer' | null = null;
  let roomPending = false;
  const ip = clientIp(socket);

  const currentRoom = () => (roomId ? rooms.get(roomId) : undefined);

  socket.on('room:create', async (payload: { password?: string } | undefined, ack?: Ack) => {
    if (typeof ack !== 'function') return;
    if (roomId || role || roomPending) return ack({ ok: false, error: 'already_in_room' });
    if (!hit(`create:${ip}`, 10, 60_000)) return ack({ ok: false, error: 'rate_limited' });
    if (typeof payload?.password === 'string' && payload.password.length > 128) return ack({ ok: false, error: 'invalid_password' });
    if (rooms.size >= MAX_ROOMS) return ack({ ok: false, error: 'server_full' });
    roomPending = true;
    try {
      const iceServers = await getIceServers();
      if (!socket.connected) return;
      if (rooms.size >= MAX_ROOMS) return ack({ ok: false, error: 'server_full' });
      const password = typeof payload?.password === 'string' && payload.password ? payload.password : undefined;
      const room = await createRoom(socket.id, password);
      if (!socket.connected) {
        rooms.delete(room.id);
        return;
      }
      roomId = room.id;
      role = 'host';
      socket.join(room.id);
      ack({ ok: true, roomId: room.id, hostToken: room.hostToken, iceServers, turn: hasTurn(iceServers) });
    } catch (error) {
      console.error('[room:create] falha ao criar sala:', error);
      if (socket.connected) ack({ ok: false, error: 'internal_error' });
    } finally {
      roomPending = false;
    }
  });

  socket.on('room:resume', async (payload: { roomId?: string; hostToken?: string } | undefined, ack?: Ack) => {
    if (typeof ack !== 'function') return;
    if (roomId || role || roomPending) return ack({ ok: false, error: 'already_in_room' });
    const room = typeof payload?.roomId === 'string' ? rooms.get(payload.roomId) : undefined;
    if (!room || !verifyHostToken(room, payload?.hostToken)) return ack({ ok: false, error: 'not_found' });
    roomPending = true;
    if (room.graceTimer) clearTimeout(room.graceTimer);
    room.graceTimer = undefined;
    const previousHostId = room.hostSocketId;
    room.hostSocketId = socket.id;
    room.hostToken = crypto.randomBytes(24).toString('base64url');
    roomId = room.id;
    role = 'host';
    socket.join(room.id);
    if (previousHostId && previousHostId !== socket.id) {
      const previousHost = io.sockets.sockets.get(previousHostId);
      previousHost?.emit('room:replaced');
      previousHost?.disconnect(true);
    }
    io.to(room.id).emit('room:host-online');
    try {
      let iceServers: Awaited<ReturnType<typeof getIceServers>> = [];
      try {
        iceServers = await getIceServers();
      } catch (error) {
        console.error('[room:resume] falha ao obter ICE servers:', error);
      }
      ack({ ok: true, hostToken: room.hostToken, viewers: [...room.viewers.values()], iceServers });
    } catch (error) {
      console.error('[room:resume] falha ao retomar sala:', error);
      if (socket.connected) ack({ ok: false, error: 'internal_error' });
    } finally {
      roomPending = false;
    }
  });

  socket.on(
    'room:join',
    async (payload: { roomId?: string; password?: string; name?: string } | undefined, ack?: Ack) => {
      if (typeof ack !== 'function') return;
      if (roomId || role || roomPending) return ack({ ok: false, error: 'already_in_room' });
      const room = typeof payload?.roomId === 'string' ? rooms.get(payload.roomId) : undefined;
      if (!room) return ack({ ok: false, error: 'not_found' });
      roomPending = true;
      try {
        if (room.passwordHash && !hit(`pw:${ip}`, 8, 60_000)) return ack({ ok: false, error: 'rate_limited' });
        if (typeof payload?.password === 'string' && payload.password.length > 128) return ack({ ok: false, error: 'bad_password' });
        if (!(await verifyPassword(room, payload?.password))) return ack({ ok: false, error: 'bad_password' });
        if (!room.viewers.has(socket.id) && room.viewers.size >= MAX_VIEWERS) return ack({ ok: false, error: 'room_full' });

        const iceServers = await getIceServers();
        if (!socket.connected) return;
        if (!rooms.has(room.id)) return ack({ ok: false, error: 'not_found' });
        if (room.viewers.size >= MAX_VIEWERS) return ack({ ok: false, error: 'room_full' });
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
      } catch (error) {
        console.error('[room:join] falha ao entrar na sala:', error);
        if (socket.connected) ack({ ok: false, error: 'internal_error' });
      } finally {
        roomPending = false;
      }
    },
  );

  // Sinalização WebRTC: o anfitrião sempre faz a oferta; espectadores respondem.
  socket.on('signal:to-viewer', (msg: { to?: string; data?: unknown } | undefined) => {
    const room = currentRoom();
    if (!room || role !== 'host' || room.hostSocketId !== socket.id || typeof msg?.to !== 'string' || !room.viewers.has(msg.to) || !isSignal(msg.data, ['offer', 'candidate'])) return;
    io.to(msg.to).emit('signal', { from: socket.id, data: msg.data });
  });

  socket.on('signal:to-host', (msg: { data?: unknown } | undefined) => {
    const room = currentRoom();
    if (!room || role !== 'viewer' || !room.viewers.has(socket.id) || !room.hostSocketId || !isSignal(msg?.data, ['answer', 'candidate', 'request-offer'])) return;
    io.to(room.hostSocketId).emit('signal', { from: socket.id, data: msg?.data });
  });

  socket.on('room:state', (msg: { state?: string } | undefined) => {
    const room = currentRoom();
    if (!room || role !== 'host' || room.hostSocketId !== socket.id) return;
    if (msg?.state !== 'live' && msg?.state !== 'paused') return;
    room.state = msg.state;
    io.to(room.id).emit('room:state', { state: room.state });
  });

  socket.on('room:end', () => {
    const room = currentRoom();
    if (!room || role !== 'host' || room.hostSocketId !== socket.id) return;
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

function isSignal(value: unknown, allowedTypes: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const signal = value as Record<string, unknown>;
  if (signal.type === 'request-offer') return allowedTypes.includes('request-offer') && Object.keys(signal).length === 1;
  if (signal.type === 'offer' || signal.type === 'answer') {
    return allowedTypes.includes(signal.type) && typeof signal.sdp === 'string' && signal.sdp.length > 0 && signal.sdp.length <= 64_000;
  }
  if (signal.type === 'candidate' && allowedTypes.includes('candidate')) {
    const candidate = signal.candidate;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const candidateText = (candidate as Record<string, unknown>).candidate;
    return typeof candidateText === 'string' && candidateText.length <= 4096;
  }
  return false;
}

export async function startServer(options: { port?: number; host?: string; log?: boolean } = {}): Promise<void> {
  const port = options.port ?? PORT;
  const host = options.host ?? HOST;
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
  const turn = hasTurn(await getIceServers());
  if (options.log !== false) {
    console.log(`\n  Lume rodando em http://localhost:${port}`);
    console.log(
      turn
        ? '  TURN: configurado (conexões atrás de NAT/CGNAT podem usar relay)'
        : '  TURN: NÃO configurado — entre redes diferentes a conexão de vídeo pode travar em "estabelecendo conexão" (veja o README)',
    );
    console.log(`  Frontend compilado: ${fs.existsSync(clientDist) ? 'sim' : 'não (use npm run dev)'}\n`);
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  startServer().catch((error) => {
    console.error('Falha ao iniciar o Lume:', error);
    process.exitCode = 1;
  });
}
