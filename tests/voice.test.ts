import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation } from '@elevenlabs/client';
import { LiveVoice, type VoiceState } from '../src/voice';

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function microphone() {
  const track = new class extends EventTarget { readyState = 'live'; stopped = 0; stop() { this.readyState = 'ended'; this.stopped++; } }();
  return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream };
}
function conversation() {
  const session = { ended: 0, endSession: async () => { session.ended++; }, sendContextualUpdate: () => {}, sendUserMessage: () => {}, sendUserActivity: () => {} };
  return session;
}
function browser(t: TestContext, getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>, options: { sampleRate?: number; resume?: () => Promise<void> } = {}) {
  const sockets: Socket[] = []; const contexts: Context[] = [];
  class Context {
    state = 'running'; sampleRate = options.sampleRate ?? 16000; destination = {}; closed = 0;
    constructor(public settings: AudioContextOptions) { contexts.push(this); }
    resume() { return options.resume?.() ?? Promise.resolve(); }
    async close() { this.closed++; this.state = 'closed'; }
    createMediaStreamSource() { return { connect: () => {}, disconnect: () => {} }; }
    createScriptProcessor() { return { onaudioprocess: null, connect: () => {}, disconnect: () => {} }; }
  }
  class Socket {
    static OPEN = 1; readyState = 1; closed = 0;
    onmessage?: (event: { data: string }) => void; onerror?: () => void; onclose?: () => void;
    constructor(public url: string) { sockets.push(this); }
    send() {} close() { this.closed++; this.readyState = 3; }
  }
  const replacements = { navigator: { mediaDevices: { getUserMedia } }, AudioContext: Context, WebSocket: Socket, location: { protocol: 'https:', host: 'demo.example' } };
  const originals = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  return { sockets, contexts };
}
const credentials = { agentPath: '/api/session/test-ticket/agent', scribePath: '/api/session/test-ticket/scribe', maxSeconds: 120 };
const voice = (states: VoiceState[] = [], transcripts: string[] = [], failures: string[] = []) => new LiveVoice(state => states.push(state), text => transcripts.push(text), text => failures.push(text), () => {});
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

test('microphone permission and 16 kHz compatibility are checked before any provider connection', async t => {
  let connections = 0;
  t.mock.method(Conversation, 'startSession', async () => { connections++; return conversation(); });
  const mic = microphone(); let permitted = false; const options = { sampleRate: 16000 };
  const surfaces = browser(t, async constraints => {
    assert.deepEqual(constraints, { audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true } });
    if (!permitted) throw new DOMException('TEST permission denied', 'NotAllowedError');
    return mic.stream;
  }, options);
  const first = voice(); await assert.rejects(first.prepareMicrophone(), /permission denied/);
  assert.equal(connections, 0); assert.equal(surfaces.sockets.length, 0); assert.equal(first.stream, undefined);
  permitted = true; options.sampleRate = 48000;
  const second = voice(); await assert.rejects(second.prepareMicrophone(), /16 kHz/);
  assert.equal(mic.track.readyState, 'ended'); assert.equal(surfaces.contexts[0].closed, 1); assert.equal(connections, 0); assert.equal(surfaces.sockets.length, 0);
});

test('cancelling a pending microphone permission request stops tracks returned after cancellation', async t => {
  const pending = deferred<MediaStream>(); const mic = microphone();
  const surfaces = browser(t, () => pending.promise); const adapter = voice();
  const preparing = adapter.prepareMicrophone(); const rejected = assert.rejects(preparing, /cancelled/);
  await nextTurn(); await adapter.stop(); pending.resolve(mic.stream); await rejected;
  assert.equal(mic.track.readyState, 'ended'); assert.equal(adapter.stream, undefined); assert.equal(adapter.gate.active, false);
  assert.equal(surfaces.sockets.length, 0); assert.equal(surfaces.contexts.length, 0);
});

test('stop releases capture synchronously and late cleanup cannot close replacement session handles', async () => {
  const adapter = voice(); const oldMic = microphone(); const newMic = microphone(); const closing = deferred<void>();
  const oldConversation = conversation(); const replacement = conversation();
  let replacementContextClosed = 0;
  adapter.gate.begin(); adapter.stream = oldMic.stream;
  adapter.context = { state: 'running', close: () => closing.promise } as unknown as AudioContext;
  adapter.conversation = oldConversation as unknown as Awaited<ReturnType<typeof Conversation.startSession>>;
  const stopped = adapter.stop();
  assert.equal(oldMic.track.readyState, 'ended'); assert.equal(adapter.stream, undefined); assert.equal(adapter.context, undefined); assert.equal(adapter.conversation, undefined);
  adapter.gate.begin(); adapter.stream = newMic.stream;
  const context = { state: 'running', close: async () => { replacementContextClosed++; } } as unknown as AudioContext;
  adapter.context = context; adapter.conversation = replacement as unknown as Awaited<ReturnType<typeof Conversation.startSession>>;
  closing.resolve(); await stopped;
  assert.equal(oldConversation.ended, 1); assert.equal(replacement.ended, 0); assert.equal(replacementContextClosed, 0);
  assert.equal(newMic.track.readyState, 'live'); assert.equal(adapter.context, context);
  await adapter.stop();
});

test('relay transport is same-host HTTPS and the 120-second clamp stops audio and ignores late transcripts', async t => {
  const mic = microphone(); const states: VoiceState[] = []; const transcripts: string[] = []; const failures: string[] = [];
  const surfaces = browser(t, async () => mic.stream); const session = conversation();
  const events: string[] = []; let interruption: (() => void) | undefined;
  t.mock.method(Conversation, 'startSession', async (options: Parameters<typeof Conversation.startSession>[0]) => {
    assert.equal('signedUrl' in options ? options.signedUrl : undefined, 'wss://demo.example/api/session/test-ticket/agent');
    assert.doesNotMatch(JSON.stringify(options), /api\.elevenlabs|token=|TEST\.invalid/);
    interruption = () => options.onInterruption?.({ event_id: 1 }); return session;
  });
  const adapter = new LiveVoice(state => states.push(state), text => transcripts.push(text), text => failures.push(text), () => {}, event => events.push(event.type)); await adapter.prepareMicrophone();
  assert.equal(surfaces.contexts[0].settings.sampleRate, 16000); assert.equal(surfaces.sockets.length, 0);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await adapter.start({ ...credentials, maxSeconds: 999 });
  assert.equal(surfaces.sockets[0].url, 'wss://demo.example/api/session/test-ticket/scribe');
  assert.doesNotMatch(surfaces.sockets[0].url, /token|elevenlabs/);
  interruption?.(); assert.deepEqual(events, ['interrupted']);
  surfaces.sockets[0].onmessage?.({ data: JSON.stringify({ message_type: 'committed_transcript', text: 'TEST retained speech' }) });
  assert.deepEqual(transcripts, ['TEST retained speech']);
  t.mock.timers.tick(119999); assert.equal(mic.track.readyState, 'live');
  t.mock.timers.tick(1); assert.equal(mic.track.readyState, 'ended'); assert.equal(surfaces.sockets[0].closed, 1);
  surfaces.sockets[0].onmessage?.({ data: JSON.stringify({ message_type: 'committed_transcript', text: 'TEST late speech must be ignored' }) });
  interruption?.(); assert.deepEqual(events, ['interrupted']);
  assert.deepEqual(transcripts, ['TEST retained speech']); assert.match(failures.join(' '), /duration limit/);
  await adapter.stop(); assert.equal(session.ended, 1);
});

test('late failed local audio resume cannot stop a replacement microphone preparation', async t => {
  const firstMic = microphone(); const replacementMic = microphone(); const delayed = deferred<void>(); let preparations = 0; let resumes = 0;
  const surfaces = browser(t, async () => preparations++ ? replacementMic.stream : firstMic.stream, { resume: () => resumes++ ? Promise.resolve() : delayed.promise });
  const adapter = voice(); const preparing = adapter.prepareMicrophone(); const rejection = assert.rejects(preparing, /TEST old audio failure/);
  await nextTurn(); await adapter.stop(); await adapter.prepareMicrophone(); delayed.reject(new Error('TEST old audio failure')); await rejection;
  assert.equal(firstMic.track.readyState, 'ended'); assert.equal(replacementMic.track.readyState, 'live'); assert.equal(adapter.stream, replacementMic.stream);
  assert.equal(surfaces.contexts[1].closed, 0); await adapter.stop();
});

test('late rejected agent startup cannot stop a deliberately connected replacement session', async t => {
  const firstMic = microphone(); const replacementMic = microphone(); const delayed = deferred<Awaited<ReturnType<typeof Conversation.startSession>>>(); let preparations = 0; let starts = 0;
  browser(t, async () => preparations++ ? replacementMic.stream : firstMic.stream);
  const replacement = conversation();
  t.mock.method(Conversation, 'startSession', async () => starts++ ? replacement : delayed.promise);
  const adapter = voice(); await adapter.prepareMicrophone(); const oldStart = adapter.start(credentials); const rejection = assert.rejects(oldStart, /TEST old provider failure/);
  await nextTurn(); await adapter.stop(); await adapter.prepareMicrophone(); await adapter.start(credentials);
  delayed.reject(new Error('TEST old provider failure')); await rejection;
  assert.equal(firstMic.track.readyState, 'ended'); assert.equal(replacementMic.track.readyState, 'live'); assert.equal(adapter.stream, replacementMic.stream);
  assert.equal(replacement.ended, 0); await adapter.stop();
});
