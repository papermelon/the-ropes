import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { relayAgent } from '../src/agent-relay';

test('Agent relay bounds duration and rejects configuration overrides while preserving SDK events', async () => {
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await new Promise<void>(resolve => upstream.once('listening', resolve)); const upstreamAddress = upstream.address(); assert.ok(upstreamAddress && typeof upstreamAddress !== 'string');
  const server = createServer(); const peers = new WebSocketServer({ server }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  let upstreamClosed = 0; const forwarded: string[] = [];
  upstream.on('connection', socket => { socket.on('message', raw => { forwarded.push(raw.toString()); socket.send(JSON.stringify({ type: 'agent_response', agent_response_event: { agent_response: 'Synthetic Agent fixture.' } })); }); socket.on('close', () => { upstreamClosed++; }); });
  peers.on('connection', client => relayAgent(client, 'server-only-signed-fixture', 0.2, new AbortController().signal, async () => false, () => new WebSocket(`ws://127.0.0.1:${upstreamAddress.port}`, ['convai'])));
  const open = () => new Promise<WebSocket>((resolve, reject) => { const client = new WebSocket(`ws://127.0.0.1:${address.port}`, ['convai']); client.once('open', () => resolve(client)); client.once('error', reject); });
  const clients: WebSocket[] = [];
  try {
    const client = await open(); clients.push(client); const messages: string[] = []; client.on('message', raw => messages.push(raw.toString())); const closed = new Promise<void>(resolve => client.once('close', () => resolve()));
    client.send(JSON.stringify({ type: 'conversation_initiation_client_data', conversation_config_override: { agent: {}, tts: {}, conversation: {} } })); client.send(JSON.stringify({ type: 'user_message', text: 'Ask my grounded question.' })); client.send(JSON.stringify({ user_audio_chunk: 'AAAAAA==' })); await closed;
    assert.match(messages.join(''), /Synthetic Agent fixture/); assert.match(messages.join(''), /Server voice duration limit/); assert.equal(JSON.parse(forwarded[0]).conversation_config_override, undefined); assert.doesNotMatch(messages.join(''), /server-only-signed-fixture/);
    const invalid = await open(); clients.push(invalid); const rejected: string[] = []; invalid.on('message', raw => rejected.push(raw.toString())); const invalidClosed = new Promise<void>(resolve => invalid.once('close', () => resolve())); const before = forwarded.length;
    invalid.send(JSON.stringify({ type: 'conversation_initiation_client_data', conversation_config_override: { conversation: { max_duration_seconds: 600 } } })); await invalidClosed; assert.match(rejected.join(''), /Invalid or excessive Agent input/); assert.equal(forwarded.length, before, 'a duration override never reaches ElevenLabs');
    await new Promise<void>(resolve => setTimeout(resolve, 20)); assert.equal(upstreamClosed, 2);
  } finally { clients.forEach(client => client.terminate()); for (const socket of upstream.clients) socket.terminate(); await new Promise<void>(resolve => upstream.close(() => resolve())); for (const socket of peers.clients) socket.terminate(); await new Promise<void>(resolve => peers.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve())); }
});
