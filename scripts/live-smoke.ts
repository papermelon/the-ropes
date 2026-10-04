// Optional billable component smoke. Never part of npm test/check; never human learning-loop proof.
// Requires an explicit shell opt-in plus the server's approved, retained budget ledger.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { trainingReport } from '../src/domain';
import { AnalysisSchema } from '../src/providers';

if (process.env.SMOKE_APPROVED !== 'true') throw new Error('Synthetic smoke is disabled. Explicit SMOKE_APPROVED=true authorization is required before any network or browser activity.');
try { process.loadEnvFile('.env'); } catch { /* Secure environment-only setup is supported. */ }
function origin(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Smoke URLs must be application origins without credentials, query strings or private paths.');
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Remote smoke origins require HTTPS before credentials or network activity.');
  return url.origin;
}
const base = origin(process.env.SMOKE_API_URL || 'http://127.0.0.1:8787');
const ui = origin(process.env.SMOKE_UI_URL || 'http://127.0.0.1:5184');
const user = process.env.DEMO_ACCESS_USER || ''; const password = process.env.DEMO_ACCESS_PASSWORD || '';
if (!!user !== !!password) throw new Error('Enter both demo access fields securely in local environment settings; never put credentials in the URL or chat.');
const authorization = user && password ? 'Basic ' + Buffer.from(user + ':' + password).toString('base64') : '';
const accessHeaders: Record<string, string> = authorization ? { Authorization: authorization } : {};
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(base + path, { method: 'POST', headers: { ...accessHeaders, 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const data = await response.json(); if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Smoke API failed.'); return data as T;
}
async function status() {
  const response = await fetch(base + '/api/status', { headers: accessHeaders, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Approved retained-ledger diagnostics or demo access are unavailable.');
  return response.json() as Promise<{ approved: boolean; claude: boolean; elevenlabs: boolean; agent: boolean; remainingUSD: number; maxRequests: number; liveRequests: number; reservedUSD: number }>;
}
function relayURL(path: string) {
  const url = new URL(path, base);
  if (url.origin !== base || !/^\/api\/session\/[a-f0-9-]+\/(agent|scribe)$/.test(url.pathname) || url.search || url.hash) throw new Error('Invalid same-origin smoke relay path.');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; return url;
}
function relay(path: string, protocols: string[] = []) {
  return new WebSocket(relayURL(path), protocols, { headers: { ...accessHeaders, Origin: base }, maxPayload: 1_000_000 });
}
type Result = { time: string; evidenceLabel: string; frame: string; reasoning: string; expressive: string; agentAudio: string; scribe: string; errors: string[]; agentEvents?: Record<string, number>; scribeEvents?: Record<string, number>; reservedUSD?: number };
const result: Result = { time: new Date().toISOString(), evidenceLabel: 'Optional synthetic component integration: fictional UI screenshot and machine-generated speech through bounded server relays. No native selected-screen chooser, human microphone, expert teach-back, unseen transfer or human validation.', frame: 'unrun', reasoning: 'unrun', expressive: 'unrun', agentAudio: 'unrun', scribe: 'unrun', errors: [] };
const runDirectory = 'tmp/live-smoke/relay-smoke-' + Date.now();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined; let ticket = '';
try {
  const skipReasoning = process.env.SMOKE_SKIP_REASONING === 'true'; const skipVoice = process.env.SMOKE_SKIP_VOICE === 'true';
  const requests = Number(!skipReasoning) + Number(!skipVoice); const reservation = (skipReasoning ? 0 : 0.25) + (skipVoice ? 0 : 1);
  if (!requests) throw new Error('Both component checks were skipped; no billable smoke is necessary.');
  const configured = await status();
  if (!configured.approved || !configured.claude || !configured.elevenlabs || !configured.agent || !Number.isFinite(configured.remainingUSD) || configured.remainingUSD < reservation || !Number.isFinite(configured.liveRequests) || !Number.isFinite(configured.maxRequests) || configured.liveRequests + requests > configured.maxRequests) throw new Error('Secure providers and sufficient approved retained budget/request allowance are required. No automatic retry or new allowance.');
  // Validate the fixture before creating any metered voice reservation.
  const pcm = skipVoice ? undefined : await readFile('tmp/live-smoke/test-speech.pcm');
  if (pcm && (pcm.length < 64000 || pcm.length > 480000 || pcm.length % 2 || !pcm.some(byte => byte !== 0))) throw new Error('Speech fixture must contain 2–15 seconds of nonempty mono 16 kHz PCM16 machine-generated audio.');
  await mkdir(runDirectory, { recursive: true }); browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...(authorization ? { httpCredentials: { username: user, password, origin: ui } } : {}) });
  const page = await context.newPage(); await page.goto(ui); await page.getByRole('button', { name: 'Begin expert review', exact: true }).click();
  await page.getByRole('region', { name: 'Original initiative submission' }).waitFor();
  const image = await page.locator('.initiative-grid').screenshot({ path: runDirectory + '/synthetic-initiative.jpg', type: 'jpeg', quality: 65 });
  result.frame = 'passed: screenshot of current fictional review UI; automated pixels, not getDisplayMedia or human evidence';
  ticket = (await post<{ id: string }>('/api/session', { mode: 'live', consent: true })).id;
  if (skipReasoning) result.reasoning = 'skipped deliberately; no new live reasoning claim';
  else try {
    const analysis = AnalysisSchema.parse(await post('/api/session/' + ticket + '/reason', { frame: 'data:image/jpeg;base64,' + image.toString('base64'), report: trainingReport, topic: 'delivery', previous: [] }));
    result.reasoning = 'passed: Claude image analysis of a fictional screenshot; structured output validated'; await writeFile(runDirectory + '/analysis.json', JSON.stringify(analysis, null, 2));
  } catch (error) { result.reasoning = 'failed'; throw error; }
  if (skipVoice) result.expressive = 'skipped deliberately; no voice reservation or relay connection';
  else if (pcm) {
    let credentials: { agentPath: string; scribePath: string; maxSeconds: number };
    try {
      credentials = await post('/api/session/' + ticket + '/voice', {});
      if (!Number.isFinite(credentials.maxSeconds) || credentials.maxSeconds <= 0 || credentials.maxSeconds > 120) throw new Error('Invalid bounded relay duration.');
      relayURL(credentials.agentPath); relayURL(credentials.scribePath);
    } catch (error) { result.expressive = 'failed'; throw error; }
    result.expressive = 'passed: server verified authenticated V3 Conversational/Expressive and duration, then issued one-use app relay paths';
    await new Promise<void>((resolve, reject) => {
      const agent = relay(credentials.agentPath, ['convai']); const scribe = relay(credentials.scribePath);
      const agentEvents: Record<string, number> = result.agentEvents = {}; const scribeEvents: Record<string, number> = result.scribeEvents = {};
      let agentText = false; let agentAudio = false; let scribeDone = false; let done = false; let upload: ReturnType<typeof setInterval> | undefined;
      const finish = (error?: Error) => { if (done) return; done = true; clearTimeout(timer); clearInterval(upload); agent.close(); scribe.close(); if (error) reject(error); else resolve(); };
      const complete = () => { if (agentText && agentAudio) result.agentAudio = 'passed: real ElevenAgents text/audio through the one-use server relay; synthetic component test'; if (agentText && agentAudio && scribeDone) finish(); };
      const timer = setTimeout(() => finish(new Error('Combined relay smoke timed out; no automatic retry.')), Math.min(25000, credentials.maxSeconds * 1000));
      agent.on('open', () => { agentEvents.open = 1; agent.send(JSON.stringify({ type: 'conversation_initiation_client_data' })); });
      agent.on('message', raw => {
        try {
          const data = JSON.parse(raw.toString());
          if (typeof data.type === 'string' && /^[a-z_]{1,48}$/.test(data.type)) agentEvents[data.type] = (agentEvents[data.type] || 0) + 1;
          if (data.type === 'ping') agent.send(JSON.stringify({ type: 'pong', event_id: data.ping_event.event_id }));
          if (data.type === 'conversation_initiation_metadata') { agent.send(JSON.stringify({ type: 'contextual_update', text: 'Synthetic component smoke. A fictional initiative has a missing quarterly benchmark and unconfirmed trial dates. No human expert or learner participates.' })); agent.send(JSON.stringify({ type: 'user_message', text: 'Ask one short question about when to stop before generalizing these results, then wait.' })); }
          if (data.type === 'agent_response') agentText = true;
          if (data.type === 'audio' && data.audio_event?.audio_base_64) agentAudio = true;
          if (['error', 'client_error'].includes(data.type)) finish(new Error('Bounded Agent relay rejected the session. Check configuration; no retry.'));
          complete();
        } catch { finish(new Error('Malformed Agent relay event.')); }
      });
      scribe.on('open', () => { scribeEvents.open = 1; });
      scribe.on('message', raw => {
        try {
          const data = JSON.parse(raw.toString());
          if (typeof data.message_type === 'string' && /^[a-z_]{1,48}$/.test(data.message_type)) scribeEvents[data.message_type] = (scribeEvents[data.message_type] || 0) + 1;
          if (data.message_type === 'session_started' && !upload) {
            let offset = 0; const speechAndSilence = Buffer.concat([pcm, Buffer.alloc(64000)]);
            // Five 200 ms chunks/second stay inside the relay's eight-message/second bound; silence lets VAD commit.
            upload = setInterval(() => { if (scribe.readyState !== WebSocket.OPEN) return; const chunk = speechAndSilence.subarray(offset, offset + 6400); offset += chunk.length; if (chunk.length) scribe.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: chunk.toString('base64'), sample_rate: 16000 })); else clearInterval(upload); }, 200);
          }
          if (data.message_type === 'committed_transcript' && data.text) { scribeDone = true; result.scribe = 'passed: Scribe v2 Realtime committed machine-generated speech through the server relay'; complete(); }
          if (typeof data.message_type === 'string' && (data.message_type.endsWith('_error') || ['error', 'quota_exceeded', 'rate_limited', 'throttled', 'commit_throttled', 'queue_overflow', 'resource_exhausted', 'session_time_limit_exceeded', 'unaccepted_terms'].includes(data.message_type))) finish(new Error('Bounded Scribe relay rejected the session. Check configuration; no retry.'));
        } catch { finish(new Error('Malformed Scribe relay event.')); }
      });
      agent.on('error', () => finish(new Error('Agent relay connection failed.'))); scribe.on('error', () => finish(new Error('Scribe relay connection failed.')));
      agent.on('close', code => { agentEvents['close_' + code] = 1; if (!done) finish(new Error('Agent relay closed before combined component checks finished.')); });
      scribe.on('close', code => { scribeEvents['close_' + code] = 1; if (!done) finish(new Error('Scribe relay closed before combined component checks finished.')); });
    }).catch(error => { if (result.agentAudio === 'unrun') result.agentAudio = 'failed'; if (result.scribe === 'unrun') result.scribe = 'failed'; throw error; });
  }
} catch (error) { result.errors.push(error instanceof Error ? error.message : 'Synthetic component smoke failed.'); }
finally {
  if (ticket) await post('/api/session/' + ticket + '/revoke', {}).catch(() => {}); await browser?.close();
  try { result.reservedUSD = (await status()).reservedUSD; } catch { /* Only report verified available ledger diagnostics. */ }
  await mkdir(runDirectory, { recursive: true }); await writeFile(runDirectory + '/result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); if (result.errors.length) process.exitCode = 1;
}
