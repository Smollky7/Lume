import assert from 'node:assert/strict';
import test from 'node:test';
import { io } from 'socket.io-client';
import { command } from '../../scripts/register-discord-command.mjs';
import { clientIpFromHeaders } from '../dist/client-ip.js';
import { getIceServers, hasTurn, normalizeIceServers } from '../dist/config.js';

test('IP encaminhado só é confiável na quantidade configurada de proxies', () => {
  assert.equal(clientIpFromHeaders('10.0.0.2', '198.51.100.77, 203.0.113.8', 1), '203.0.113.8');
  assert.equal(clientIpFromHeaders('10.0.0.2', '198.51.100.77', 0), '10.0.0.2');
  assert.equal(clientIpFromHeaders('10.0.0.2', 'forged, also-forged', 1), '10.0.0.2');
  assert.equal(clientIpFromHeaders('10.0.0.2', '198.51.100.77', 2), '10.0.0.2');
});

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${event}`)), 3000);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['websocket'], timeout: 3000, reconnection: false });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

test('payload do Primary Entry Point é compatível com Discord Activities', () => {
  assert.deepEqual(command, {
    name: 'iniciar',
    description: 'Abrir o Lume na chamada',
    type: 4,
    handler: 2,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  });
});

test('respostas ICE são validadas e TURN só é considerado configurado com credenciais', () => {
  const stun = normalizeIceServers([{ urls: ['stun:stun.example:53', 'stun:stun.example:3478'] }]);
  assert.deepEqual(stun, [{ urls: 'stun:stun.example:3478' }]);
  assert.equal(hasTurn(stun), false);

  const turn = normalizeIceServers({
    iceServers: [{ urls: 'turn:turn.example:3478?transport=udp', username: 'temporary', credential: 'secret' }],
  });
  assert.equal(hasTurn(turn), true);
  assert.throws(() => normalizeIceServers([{ urls: 'turn:turn.example:3478' }]), /TURN credentials/);
  assert.throws(() => normalizeIceServers([{ urls: 'not-an-ice-url' }]), /invalid ICE server URL/);
  assert.throws(() => normalizeIceServers([]), /invalid ICE server response/);
});

test('credenciais ICE externas são compartilhadas entre chamadas e nunca reutilizadas após expirar', async () => {
  const keys = ['ICE_API_URL', 'CF_TURN_KEY_ID', 'CF_TURN_API_TOKEN', 'STUN_URLS', 'TURN_URLS', 'TURN_SECRET', 'TURN_USERNAME', 'TURN_CREDENTIAL'];
  const savedEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let fetchCount = 0;
  const now = Date.now();

  for (const key of keys) delete process.env[key];
  process.env.ICE_API_URL = 'https://ice.example/credentials';
  Date.now = () => now;
  globalThis.fetch = async () => {
    fetchCount++;
    return {
      ok: true,
      json: async () => [{ urls: 'turn:turn.example:3478?transport=udp', username: 'temporary', credential: 'secret' }],
    };
  };

  try {
    const [first, concurrent] = await Promise.all([getIceServers(), getIceServers()]);
    assert.equal(fetchCount, 1);
    assert.equal(hasTurn(first), true);
    assert.equal(hasTurn(concurrent), true);

    Date.now = () => now + 3_600_001;
    globalThis.fetch = async () => {
      fetchCount++;
      throw new Error('provider unavailable');
    };
    const expired = await getIceServers();
    assert.equal(fetchCount, 2);
    assert.equal(hasTurn(expired), false);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    for (const key of keys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
});

test('sala é publicada automaticamente na Activity e aceita sinalização', async (t) => {
  const iceEnvKeys = ['ICE_API_URL', 'CF_TURN_KEY_ID', 'CF_TURN_API_TOKEN', 'STUN_URLS', 'TURN_URLS', 'TURN_SECRET', 'TURN_USERNAME', 'TURN_CREDENTIAL'];
  const savedIceEnv = Object.fromEntries(iceEnvKeys.map((key) => [key, process.env[key]]));
  for (const key of iceEnvKeys) delete process.env[key];
  const { io: ioServer, server, startServer } = await import('../dist/index.js');
  const clients = [];
  t.after(async () => {
    clients.forEach((socket) => socket.disconnect());
    await new Promise((resolve) => ioServer.close(resolve));
    for (const key of iceEnvKeys) {
      if (savedIceEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedIceEnv[key];
    }
  });
  await startServer({ port: 0, host: '127.0.0.1', log: false });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  const url = `http://127.0.0.1:${port}`;

  const health = await fetch(`${url}/api/health`);
  assert.equal(health.ok, true);
  assert.deepEqual(await health.json(), { ok: true });
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.match(health.headers.get('content-security-policy'), /frame-ancestors/);
  assert.match(health.headers.get('content-security-policy'), new RegExp(`connect-src 'self' ws://127\\.0\\.0\\.1:${port}`));
  assert.doesNotMatch(health.headers.get('content-security-policy'), /connect-src[^;]*\bwss?:\s/);
  const foreignOrigin = io(url, {
    transports: ['websocket'],
    timeout: 3000,
    reconnection: false,
    extraHeaders: { Origin: 'https://untrusted.example' },
  });
  const rejectedOrigin = await new Promise((resolve) => {
    foreignOrigin.once('connect_error', resolve);
    foreignOrigin.once('connect', () => resolve(null));
  });
  foreignOrigin.disconnect();
  assert.ok(rejectedOrigin);

  const activity = await connect(url);
  const host = await connect(url);
  const secondHost = await connect(url);
  const replacementHost = await connect(url);
  const thirdHost = await connect(url);
  const viewer = await connect(url);
  const secondViewer = await connect(url);
  const raceViewer = await connect(url);
  const passwordViewer = await connect(url);
  const capacityHosts = await Promise.all([connect(url), connect(url), connect(url), connect(url), connect(url)]);
  clients.push(activity, host, secondHost, replacementHost, thirdHost, viewer, secondViewer, raceViewer, passwordViewer, ...capacityHosts);

  const instanceId = 'test-instance-123';
  const joined = await emitAck(activity, 'activity:join', instanceId);
  assert.equal(joined.ok, true);
  assert.deepEqual(joined.streams, []);

  const room = await emitAck(host, 'room:create', {});
  assert.equal(room.ok, true);
  assert.match(room.roomId, /^[\w-]+$/);
  assert.equal((await emitAck(host, 'room:create', {})).error, 'already_in_room');
  const secondRoom = await emitAck(secondHost, 'room:create', {});
  assert.equal(secondRoom.ok, true);
  const protectedRoom = await emitAck(thirdHost, 'room:create', { password: 'test-password' });
  assert.equal(protectedRoom.ok, true);

  const streamUpdate = new Promise((resolve) => activity.once('activity:streams', resolve));
  const published = await emitAck(host, 'activity:publish', { instanceId, roomId: room.roomId });
  assert.equal(published.ok, true);
  assert.deepEqual(await streamUpdate, [{ roomId: room.roomId, title: 'Tela 1' }]);
  const secondStreamUpdate = new Promise((resolve) => activity.once('activity:streams', resolve));
  assert.equal((await emitAck(secondHost, 'activity:publish', { instanceId, roomId: secondRoom.roomId })).ok, true);
  assert.deepEqual(await secondStreamUpdate, [
    { roomId: room.roomId, title: 'Tela 1' },
    { roomId: secondRoom.roomId, title: 'Tela 2' },
  ]);
  const capacityRooms = await Promise.all(capacityHosts.map((socket) => emitAck(socket, 'room:create', {})));
  assert.ok(capacityRooms.every((result) => result.ok));
  for (let index = 0; index < 4; index++) {
    assert.equal(
      (await emitAck(capacityHosts[index], 'activity:publish', { instanceId: 'capacity-room-123', roomId: capacityRooms[index].roomId })).ok,
      true,
    );
  }
  assert.equal(
    (await emitAck(capacityHosts[4], 'activity:publish', { instanceId: 'capacity-room-123', roomId: capacityRooms[4].roomId })).error,
    'activity_full',
  );
  const raceJoinNotice = new Promise((resolve) => {
    host.once('viewer:joined', resolve);
    secondHost.once('viewer:joined', resolve);
  });
  const concurrentJoins = await Promise.all([
    emitAck(raceViewer, 'room:join', { roomId: room.roomId }),
    emitAck(raceViewer, 'room:join', { roomId: secondRoom.roomId }),
  ]);
  assert.equal(concurrentJoins.filter((result) => result.ok).length, 1);
  assert.equal(concurrentJoins.find((result) => !result.ok).error, 'already_in_room');
  assert.equal((await raceJoinNotice).id, raceViewer.id);

  const viewerJoined = new Promise((resolve) => host.once('viewer:joined', resolve));
  const watch = await emitAck(viewer, 'room:join', { roomId: room.roomId, name: 'Convidado' });
  assert.equal(watch.ok, true);
  assert.equal((await viewerJoined).name, 'Convidado');
  const secondViewerJoined = new Promise((resolve) => host.once('viewer:joined', resolve));
  assert.equal((await emitAck(secondViewer, 'room:join', { roomId: room.roomId })).ok, true);
  assert.equal((await secondViewerJoined).id, secondViewer.id);
  assert.equal((await emitAck(viewer, 'room:join', { roomId: secondRoom.roomId })).error, 'already_in_room');
  assert.equal((await emitAck(passwordViewer, 'room:join', { roomId: protectedRoom.roomId, password: 'wrong' })).error, 'bad_password');
  assert.equal((await emitAck(passwordViewer, 'room:join', { roomId: protectedRoom.roomId, password: 'test-password' })).ok, true);

  let viewerReceivedStateChange = false;
  viewer.on('room:state', () => { viewerReceivedStateChange = true; });
  viewer.emit('room:state', { state: 'paused' });
  viewer.emit('room:end');
  assert.equal((await emitAck(viewer, 'activity:publish', { instanceId, roomId: room.roomId })).error, 'not_host');
  assert.equal((await emitAck(viewer, 'room:create', {})).error, 'already_in_room');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(viewerReceivedStateChange, false);
  assert.equal((await fetch(`${url}/api/rooms/${room.roomId}`).then((r) => r.json())).exists, true);

  let signalCount = 0;
  viewer.on('signal', () => signalCount++);
  const relayed = new Promise((resolve) => viewer.once('signal', resolve));
  host.emit('signal:to-viewer', { to: viewer.id, data: { type: 'answer', sdp: 'not-an-offer' } });
  host.emit('signal:to-viewer', { to: viewer.id, data: { type: 'candidate', candidate: { candidate: 'test' } } });
  assert.deepEqual((await relayed).data, { type: 'candidate', candidate: { candidate: 'test' } });
  assert.equal(signalCount, 1);

  const paused = new Promise((resolve) => viewer.once('room:state', resolve));
  host.emit('room:state', { state: 'paused' });
  await paused;
  const resumed = await emitAck(replacementHost, 'room:resume', { roomId: room.roomId, hostToken: room.hostToken });
  assert.equal(resumed.ok, true);
  assert.notEqual(resumed.hostToken, room.hostToken);
  const staleHost = await connect(url);
  clients.push(staleHost);
  assert.equal((await emitAck(staleHost, 'room:resume', { roomId: room.roomId, hostToken: room.hostToken })).error, 'not_found');
  host.emit('room:end');
  assert.equal((await fetch(`${url}/api/rooms/${room.roomId}`).then((r) => r.json())).exists, true);

  const firstRemoved = new Promise((resolve) => activity.once('activity:streams', resolve));
  replacementHost.emit('room:end');
  assert.deepEqual(await firstRemoved, [{ roomId: secondRoom.roomId, title: 'Tela 2' }]);
  const removed = new Promise((resolve) => activity.once('activity:streams', resolve));
  secondHost.emit('room:end');
  thirdHost.emit('room:end');
  assert.deepEqual(await removed, []);

  assert.equal((await emitAck(activity, 'activity:join', 'capacity-room-123')).ok, true);
  const firstCapacityRemoval = new Promise((resolve) => activity.once('activity:streams', resolve));
  capacityHosts[0].emit('room:end');
  assert.deepEqual(await firstCapacityRemoval, [
    { roomId: capacityRooms[1].roomId, title: 'Tela 2' },
    { roomId: capacityRooms[2].roomId, title: 'Tela 3' },
    { roomId: capacityRooms[3].roomId, title: 'Tela 4' },
  ]);
  for (let index = 1; index < 4; index++) {
    const remaining = Array.from({ length: 3 - index }, (_, offset) => ({
      roomId: capacityRooms[index + offset + 1].roomId,
      title: `Tela ${index + offset + 2}`,
    }));
    const removal = new Promise((resolve) => activity.once('activity:streams', resolve));
    capacityHosts[index].emit('room:end');
    assert.deepEqual(await removal, remaining);
  }
  capacityHosts[4].emit('room:end');

  const rateLimitedJoiner = await connect(url);
  clients.push(rateLimitedJoiner);
  const joinAttempts = await Promise.all(
    Array.from({ length: 65 }, () => emitAck(rateLimitedJoiner, 'room:join', { roomId: 'missing-room' })),
  );
  assert.ok(joinAttempts.some((result) => result.error === 'rate_limited'));

  const resumeAttempts = await Promise.all(
    Array.from({ length: 25 }, () =>
      emitAck(staleHost, 'room:resume', { roomId: room.roomId, hostToken: 'invalid-host-token-value-000000' }),
    ),
  );
  assert.ok(resumeAttempts.some((result) => result.error === 'rate_limited'));
});
