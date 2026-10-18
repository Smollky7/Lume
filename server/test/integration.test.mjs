import assert from 'node:assert/strict';
import test from 'node:test';
import { io } from 'socket.io-client';
import { command } from '../../scripts/register-discord-command.mjs';

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
  const activity = await connect(url);
  const host = await connect(url);
  const viewer = await connect(url);
  clients.push(activity, host, viewer);

  const instanceId = 'test-instance-123';
  const joined = await emitAck(activity, 'activity:join', instanceId);
  assert.equal(joined.ok, true);
  assert.deepEqual(joined.streams, []);

  const room = await emitAck(host, 'room:create', {});
  assert.equal(room.ok, true);
  assert.match(room.roomId, /^[\w-]+$/);

  const streamUpdate = new Promise((resolve) => activity.once('activity:streams', resolve));
  const published = await emitAck(host, 'activity:publish', { instanceId, roomId: room.roomId });
  assert.equal(published.ok, true);
  assert.deepEqual(await streamUpdate, [{ roomId: room.roomId, title: 'Tela 1' }]);

  const viewerJoined = new Promise((resolve) => host.once('viewer:joined', resolve));
  const watch = await emitAck(viewer, 'room:join', { roomId: room.roomId, name: 'Convidado' });
  assert.equal(watch.ok, true);
  assert.equal((await viewerJoined).name, 'Convidado');

  const relayed = new Promise((resolve) => viewer.once('signal', resolve));
  host.emit('signal:to-viewer', { to: viewer.id, data: { type: 'candidate', candidate: { candidate: 'test' } } });
  assert.deepEqual((await relayed).data, { type: 'candidate', candidate: { candidate: 'test' } });

  const removed = new Promise((resolve) => activity.once('activity:streams', resolve));
  host.emit('room:end');
  assert.deepEqual(await removed, []);
});
