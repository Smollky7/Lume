import assert from 'node:assert/strict';
import test from 'node:test';
import { io } from 'socket.io-client';
import { command } from '../../scripts/register-discord-command.mjs';
import { clientIpFromHeaders } from '../dist/client-ip.js';

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

test('sala é publicada automaticamente na Activity e aceita sinalização', async (t) => {
  const { io: ioServer, server, startServer } = await import('../dist/index.js');
  await startServer({ port: 0, host: '127.0.0.1', log: false });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  const url = `http://127.0.0.1:${port}`;
  const clients = [];
  t.after(() => {
    clients.forEach((socket) => socket.disconnect());
    return new Promise((resolve) => ioServer.close(resolve));
  });

  const health = await fetch(`${url}/api/health`);
  assert.equal(health.ok, true);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.match(health.headers.get('content-security-policy'), /frame-ancestors/);
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
  clients.push(activity, host, secondHost, replacementHost, thirdHost, viewer, secondViewer, raceViewer, passwordViewer);

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
});
