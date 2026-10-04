import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { relayScribe } from '../src/scribe-relay';

test('Scribe relay enforces server duration and kills both sockets without retaining audio', async () => {
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await new Promise<void>(resolve => upstream.once('listening', resolve)); const upstreamAddress = upstream.address(); assert.ok(upstreamAddress && typeof upstreamAddress !== 'string');
  const server = createServer(); const peers = new WebSocketServer({ server }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  let closedUpstream = false; upstream.on('connection', socket => socket.on('close', () => { closedUpstream = true; }));
  peers.on('connection', client => relayScribe(client, 'server-only-fixture', 0.15, new AbortController().signal, async () => false, () => new WebSocket(`ws://127.0.0.1:${upstreamAddress.port}`)));
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`); const messages: string[] = []; client.on('message', raw => messages.push(raw.toString()));
  try { await new Promise<void>((resolve, reject) => { client.once('close', () => resolve()); client.once('error', reject); }); assert.match(messages.join(''), /Server voice duration limit/); await new Promise<void>(resolve => setTimeout(resolve, 20)); assert.equal(closedUpstream, true); assert.doesNotMatch(messages.join(''), /server-only-fixture/); }
  finally { client.terminate(); for (const socket of upstream.clients) socket.terminate(); await new Promise<void>(resolve => upstream.close(() => resolve())); for (const socket of peers.clients) socket.terminate(); await new Promise<void>(resolve => peers.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve())); }
});
