import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { makeServer } from '../src/server';
import { trainingReport } from '../src/domain';

test('five-minute voice configuration is clamped, reserved proportionally and returned without provider credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apprentice-long-voice-api-'));
  const values = { ANTHROPIC_API_KEY: 'test-only-claude', ELEVENLABS_API_KEY: 'test-only-elevenlabs', ELEVENLABS_AGENT_ID: 'agent_test', LIVE_USAGE_APPROVED: 'true', LIVE_USAGE_DISABLED: 'false', PROVIDER_TOTAL_CAP_USD: '10', MAX_LIVE_VOICE_SECONDS: '999', BUDGET_KILL_SWITCH_PATH: join(directory, 'disabled') };
  const old = Object.keys(values).map(key => process.env[key]); Object.entries(values).forEach(([key, value]) => { process.env[key] = value; });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input); if (!url.startsWith('https://api.elevenlabs.io/')) return originalFetch(input, init);
    if (url.includes('get-signed-url')) return Response.json({ signed_url: 'wss://TEST.invalid' });
    if (url.includes('single-use-token')) return Response.json({ token: 'TEST_FAKE_SCRIBE' });
    return Response.json({ platform_settings: { auth: { enable_auth: true, allowlist: [] } }, conversation_config: { tts: { model_id: 'eleven_v3_conversational', expressive_mode: true }, conversation: { max_duration_seconds: 300 } } });
  };
  const server = makeServer({ ledgerPath: join(directory, 'budget.json'), initializeBudget: true });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string) => fetch(base + path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: path === '/api/session' ? JSON.stringify({ mode: 'live', consent: true }) : '{}' });
    const { id } = await (await post('/api/session')).json();
    const credentials = await (await post(`/api/session/${id}/voice`)).json(); assert.equal(credentials.maxSeconds, 300); assert.doesNotMatch(JSON.stringify(credentials), /TEST_FAKE_SCRIBE|TEST.invalid/);
    const status = await (await fetch(base + '/api/status')).json(); assert.equal(status.maxVoiceSeconds, 300); assert.equal(status.committedUSD, 4.3); assert.equal(status.remainingUSD, 5.7); assert.equal(status.liveRequests, 1); assert.equal(status.maxRequests, 8);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); globalThis.fetch = originalFetch;
    Object.keys(values).forEach((key, i) => { if (old[i] === undefined) delete process.env[key]; else process.env[key] = old[i]; }); await rm(directory, { recursive: true, force: true });
  }
});

test('local API enforces consent, origin, active tickets, validation and explicit mock/live separation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apprentice-server-'));
  const server = makeServer({ ledgerPath: join(directory, 'budget.json'), initializeBudget: true }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  async function post(path: string, data: unknown, origin = base) { return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(data) }); }
  try {
    assert.equal((await post('/api/session', { mode: 'mock', consent: false })).status, 400);
    assert.equal((await post('/api/session', { mode: 'mock', consent: true }, 'https://evil.example')).status, 403);
    const response = await post('/api/session', { mode: 'mock', consent: true }); const { id } = await response.json();
    const input = { frame: 'data:image/jpeg;base64,/9j/2Q==', report: trainingReport, topic: 'delivery', previous: [] };
    assert.equal((await post(`/api/session/${id}/reason`, input)).status, 200);
    const quote = 'I need evidence.';
    const map = { rules: [{ id: 'rule-test', topic: 'delivery', title: 'Evidence', decision: quote, conditions: '', exceptions: '', rationale: quote, guardrail: '', citations: [{ id: 'citation-test', transcriptId: 'transcript-test', frameId: '', start: 0, end: quote.length, quote, phase: 'capture' }] }] };
    const mapped = await (await post(`/api/session/${id}/map`, map)).json(); assert.equal(mapped.mode, 'mock-extractive'); assert.equal(mapped.rules[0].decision.text, quote); assert.equal(mapped.rules[0].decision.citations[0], 'citation-test');
    assert.equal((await post(`/api/session/${id}/map`, { ...map, oversized: 'x'.repeat(200000) })).status, 400);
    assert.equal((await post(`/api/session/${id}/reason`, { ...input, expectedAnswer: 'secret oracle' })).status, 400);
    assert.equal((await post(`/api/session/${id}/voice`, {})).status, 400);
    const report = await (await post(`/api/session/${id}/case`, { topic: 'delivery' })).json(); assert.equal(report.initiative, 'Neighbourhood access trial'); assert.equal(report.expectedAnswer, undefined);
    assert.equal((await post(`/api/session/${id}/revoke`, {})).status, 200);
    assert.equal((await post(`/api/session/${id}/reason`, input)).status, 409);
    const diagnostics = await (await fetch(base + '/api/status')).text(); assert.doesNotMatch(diagnostics, /sk-ant-|xi-api-key|sutkn_/);
    // Provider calls are intercepted even if the developer has real keys in .env.
    const originalFetch = globalThis.fetch;
    const fields = ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID', 'LIVE_USAGE_APPROVED', 'PROVIDER_TOTAL_CAP_USD'] as const;
    const oldEnv = fields.map(field => process.env[field]);
    ['test-only-claude', 'test-only-elevenlabs', 'agent_test', 'true', '3'].forEach((value, i) => { process.env[fields[i]] = value; });
    let expressive = false; let duration = 600; let signedCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith('https://api.elevenlabs.io/')) return originalFetch(input, init);
      if (url.includes('get-signed-url')) { signedCalls++; return Response.json({ detail: { status: 'missing_permissions', message: 'Requires convai_write. PRIVATE_PROVIDER_BODY' } }, { status: 401 }); }
      return Response.json({ platform_settings: { auth: { enable_auth: true, allowlist: [] } }, conversation_config: { tts: { model_id: 'eleven_v3_conversational', expressive_mode: expressive }, conversation: { max_duration_seconds: duration } } });
    };
    try {
      const live = await (await post('/api/session', { mode: 'live', consent: true })).json();
      const disabled = await (await post(`/api/session/${live.id}/voice`, {})).json(); assert.match(disabled.error, /Enable Expressive mode/); assert.equal(signedCalls, 0);
      expressive = true;
      const tooLong = await (await post(`/api/session/${live.id}/voice`, {})).json(); assert.match(tooLong.error, /Max conversation duration/); assert.equal(signedCalls, 0);
      duration = 120;
      const before = await (await fetch(base + '/api/status')).json();
      const denied = await (await post(`/api/session/${live.id}/voice`, {})).json(); assert.match(denied.error, /ElevenAgents Write/); assert.doesNotMatch(denied.error, /PRIVATE_PROVIDER_BODY/); assert.equal(signedCalls, 1);
      const after = await (await fetch(base + '/api/status')).json();
      assert.equal(after.reservedUSD, before.reservedUSD, 'failed credentials cannot start billable audio');
      assert.equal(after.liveRequests, before.liveRequests + 1, 'failed credentials still consume the request bound');
    } finally {
      globalThis.fetch = originalFetch; fields.forEach((field, i) => { if (oldEnv[i] === undefined) delete process.env[field]; else process.env[field] = oldEnv[i]; });
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

test('Agent and Scribe credentials stay server-side; relays reject cross-origin/replay and revoke or kill closes provider sockets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apprentice-relay-'));
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await new Promise<void>(resolve => upstream.once('listening', resolve));
  const upstreamAddress = upstream.address(); assert.ok(upstreamAddress && typeof upstreamAddress !== 'string'); const upstreamURL = `ws://127.0.0.1:${upstreamAddress.port}`;
  let received = ''; let receivedAgent = ''; let upstreamClosed = false; let agentClosed = false;
  upstream.on('connection', (socket, req) => {
    const isAgent = req.url === '/agent';
    socket.on('message', raw => { if (isAgent) { receivedAgent = raw.toString(); socket.send(JSON.stringify({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { conversation_id: 'fixture', agent_output_audio_format: 'pcm_16000', user_input_audio_format: 'pcm_16000' } })); } else { received = raw.toString(); socket.send(JSON.stringify({ message_type: 'committed_transcript', text: 'Synthetic relay fixture.' })); } });
    socket.on('close', () => { if (isAgent) agentClosed = true; else upstreamClosed = true; });
  });
  const values = { ANTHROPIC_API_KEY: 'test-only-claude', ELEVENLABS_API_KEY: 'test-only-elevenlabs', ELEVENLABS_AGENT_ID: 'agent_test', LIVE_USAGE_APPROVED: 'true', PROVIDER_TOTAL_CAP_USD: '3', BUDGET_KILL_SWITCH_PATH: join(directory, 'disabled') };
  const old = Object.keys(values).map(key => process.env[key]); Object.entries(values).forEach(([key, value]) => { process.env[key] = value; }); const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input); if (!url.startsWith('https://api.elevenlabs.io/')) return originalFetch(input, init);
    if (url.includes('get-signed-url')) return Response.json({ signed_url: 'wss://fixture.example/agent?token=private-agent-fixture' });
    if (url.includes('single-use-token')) return Response.json({ token: 'private-scribe-fixture' });
    return Response.json({ platform_settings: { auth: { enable_auth: true, allowlist: [] } }, conversation_config: { tts: { model_id: 'eleven_v3_conversational', expressive_mode: true }, conversation: { max_duration_seconds: 120 } } });
  };
  const server = makeServer({ ledgerPath: join(directory, 'budget.json'), initialHeldUSD: 0, knownHistoricalUSD: 0, initializeBudget: true, scribeConnect: token => { assert.equal(token, 'private-scribe-fixture'); return new WebSocket(upstreamURL); }, agentConnect: (signed, forwardedOrigin) => { assert.match(signed, /private-agent-fixture/); assert.match(forwardedOrigin || '', /^http:\/\/127\.0\.0\.1:\d+$/); return new WebSocket(upstreamURL + '/agent', ['convai']); } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, data: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(data) });
  let client: WebSocket | undefined; let agentClient: WebSocket | undefined;
  try {
    const { id } = await (await post('/api/session', { mode: 'live', consent: true })).json(); const credentials = await (await post(`/api/session/${id}/voice`, {})).json(); assert.equal(credentials.scribeToken, undefined); assert.equal(credentials.signedUrl, undefined); assert.doesNotMatch(JSON.stringify(credentials), /private-(scribe|agent)-fixture/); assert.equal(credentials.scribePath, `/api/session/${id}/scribe`); assert.equal(credentials.agentPath, `/api/session/${id}/agent`);
    const connect = (path: string, origin: string, isAgent = false) => new Promise<WebSocket>((resolve, reject) => { const socket = new WebSocket(base.replace('http:', 'ws:') + path, isAgent ? ['convai'] : [], { origin }); socket.once('open', () => resolve(socket)); socket.once('error', reject); });
    await assert.rejects(connect(credentials.agentPath, 'https://evil.example', true), /403/); await assert.rejects(connect(credentials.agentPath, base), /403/);
    const agentPath = credentials.agentPath + '?source=js_sdk&version=0.15.2'; const attempts = await Promise.allSettled([connect(agentPath, base, true), connect(agentPath, base, true)]); assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1); const accepted = attempts.find(result => result.status === 'fulfilled'); assert.ok(accepted && accepted.status === 'fulfilled'); agentClient = accepted.value; await assert.rejects(connect(agentPath, base, true), /403/);
    const metadata = new Promise<string>(resolve => agentClient!.once('message', raw => resolve(raw.toString()))); agentClient.send(JSON.stringify({ type: 'conversation_initiation_client_data', conversation_config_override: { agent: {}, tts: {}, conversation: {} } })); assert.equal(JSON.parse(await metadata).type, 'conversation_initiation_metadata'); assert.equal(JSON.parse(receivedAgent).conversation_config_override, undefined);
    await assert.rejects(connect(credentials.scribePath, 'https://evil.example'), /403/); client = await connect(credentials.scribePath, base); await assert.rejects(connect(credentials.scribePath, base), /403/);
    const transcript = new Promise<string>(resolve => client!.once('message', raw => resolve(raw.toString()))); client.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: 'AAAAAA==', sample_rate: 16000 })); assert.equal(JSON.parse(await transcript).text, 'Synthetic relay fixture.'); assert.doesNotMatch(received, /private-scribe-fixture/);
    const closed = new Promise<void>(resolve => client!.once('close', () => resolve())); const closedAgent = new Promise<void>(resolve => agentClient!.once('close', () => resolve())); await post(`/api/session/${id}/revoke`, {}); await Promise.all([closed, closedAgent]);
    await new Promise<void>(resolve => setTimeout(resolve, 20)); assert.equal(upstreamClosed, true); assert.equal(agentClosed, true); assert.equal((await (await fetch(base + '/api/status')).json()).reservedUSD, 1, 'revoke retains unknown actual voice charge');
    const next = await (await post('/api/session', { mode: 'live', consent: true })).json(); const nextCredentials = await (await post(`/api/session/${next.id}/voice`, {})).json(); agentClosed = false; agentClient = await connect(nextCredentials.agentPath, base, true);
    const killed = new Promise<void>(resolve => agentClient!.once('close', () => resolve())); agentClient.send(JSON.stringify({ type: 'conversation_initiation_client_data' })); await writeFile(values.BUDGET_KILL_SWITCH_PATH, 'Disabled deliberately for test.'); await killed;
    await new Promise<void>(resolve => setTimeout(resolve, 20)); assert.equal(agentClosed, true); assert.equal((await post('/api/session', { mode: 'live', consent: true })).status, 400); assert.equal((await (await fetch(base + '/api/status')).json()).reservedUSD, 2, 'kill never invents an actual provider refund');
  } finally {
    client?.terminate(); agentClient?.terminate(); for (const socket of upstream.clients) socket.terminate(); await new Promise<void>(resolve => upstream.close(() => resolve())); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); globalThis.fetch = originalFetch;
    Object.keys(values).forEach((key, i) => { if (old[i] === undefined) delete process.env[key]; else process.env[key] = old[i]; }); await rm(directory, { recursive: true, force: true });
  }
});

test('temporary public access opens without credentials, preserves paid gates and restores login at expiry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apprentice-open-demo-'));
  const expires = Date.now() + 86400000;
  const values = { PUBLIC_DEMO: 'true', DEMO_OPEN_UNTIL: new Date(expires).toISOString(), ALLOWED_HOSTS: 'demo.example', ALLOWED_ORIGINS: 'https://demo.example', DEMO_ACCESS_USER: 'judge', DEMO_ACCESS_PASSWORD: 'test-only-strong-password', BUDGET_LEDGER_PATH: join(directory, 'budget.json'), BUDGET_INITIALIZE_ALLOWED: 'true', BUDGET_KILL_SWITCH_PATH: join(directory, 'disabled'), PROVIDER_TOTAL_CAP_USD: '10', LIVE_USAGE_APPROVED: 'true', LIVE_USAGE_DISABLED: 'false', MAX_API_REQUESTS_PER_MINUTE: '60' };
  const old = Object.keys(values).map(key => process.env[key]); Object.entries(values).forEach(([key, value]) => { process.env[key] = value; });
  const realNow = Date.now; let server: ReturnType<typeof makeServer> | undefined;
  try {
    process.env.DEMO_OPEN_UNTIL = 'forever'; assert.throws(() => makeServer(), /ISO expiry/);
    process.env.DEMO_OPEN_UNTIL = '2026-10-12'; assert.throws(() => makeServer(), /ISO expiry/);
    process.env.DEMO_OPEN_UNTIL = values.DEMO_OPEN_UNTIL;
    server = makeServer(); await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
    const headers = { Host: 'demo.example', 'X-Forwarded-Proto': 'https', Origin: 'https://demo.example', 'Content-Type': 'application/json' };
    const call = (path: string, body?: unknown, overrides: Record<string, string> = {}) => new Promise<Response>((resolve, reject) => {
      const req = request(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...overrides } }, response => {
        let text = ''; response.on('data', chunk => { text += chunk; }); response.on('end', () => resolve(new Response(text, { status: response.statusCode })));
      }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    assert.equal((await call('/')).status, 200);
    const before = await (await call('/api/status')).json(); assert.equal(before.openAccessUntil, values.DEMO_OPEN_UNTIL); assert.equal(before.liveRequests, 0);
    assert.equal((await call('/api/status', undefined, { Host: 'evil.example' })).status, 403);
    assert.equal((await call('/api/status', undefined, { 'X-Forwarded-Proto': 'http' })).status, 403);
    assert.equal((await call('/api/session', { mode: 'mock', consent: true }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await call('/api/session', { mode: 'mock', consent: false })).status, 400);
    const mock = await (await call('/api/session', { mode: 'mock', consent: true })).json();
    assert.equal((await call(`/api/session/${mock.id}/case`, { topic: 'delivery' })).status, 200);
    assert.equal((await call(`/api/session/${mock.id}/voice`, {})).status, 400);
    const live = await (await call('/api/session', { mode: 'live', consent: true })).json(); assert.ok(live.id);
    await writeFile(values.BUDGET_KILL_SWITCH_PATH, 'Disabled deliberately for test.');
    assert.equal((await call(`/api/session/${live.id}/reason`, { frame: 'data:image/jpeg;base64,/9j/2Q==', report: trainingReport, topic: 'delivery', previous: [] })).status, 400);
    const after = await (await call('/api/status')).json(); assert.equal(after.liveRequests, 0); assert.equal(after.committedUSD, before.committedUSD); assert.equal(after.approved, false);
    Date.now = () => expires;
    assert.equal((await call('/')).status, 401); assert.equal((await call('/api/status')).status, 401);
    assert.equal((await call(`/api/session/${mock.id}/revoke`, {})).status, 401);
    const loggedIn = await call('/api/status', undefined, { Authorization: `Basic ${Buffer.from('judge:test-only-strong-password').toString('base64')}` });
    assert.equal(loggedIn.status, 200); assert.equal((await loggedIn.json()).openAccessUntil, null);
  } finally {
    Date.now = realNow;
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    Object.keys(values).forEach((key, i) => { if (old[i] === undefined) delete process.env[key]; else process.env[key] = old[i]; }); await rm(directory, { recursive: true, force: true });
  }
});

test('public demo fails closed and enforces HTTPS, exact hosts/origins, access control, rate limits and kill switch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apprentice-public-'));
  const values = { PUBLIC_DEMO: 'true', ALLOWED_HOSTS: 'demo.example', ALLOWED_ORIGINS: 'https://demo.example', DEMO_ACCESS_USER: 'judge', DEMO_ACCESS_PASSWORD: 'test-only-strong-password', BUDGET_LEDGER_PATH: join(directory, 'budget.json'), BUDGET_INITIALIZE_ALLOWED: 'true', BUDGET_KILL_SWITCH_PATH: join(directory, 'disabled'), PROVIDER_TOTAL_CAP_USD: '3', LIVE_USAGE_APPROVED: 'true', MAX_API_REQUESTS_PER_MINUTE: '2' };
  const old = Object.keys(values).map(key => process.env[key]); Object.entries(values).forEach(([key, value]) => { process.env[key] = value; });
  let server: ReturnType<typeof makeServer> | undefined;
  try {
    process.env.DEMO_ACCESS_PASSWORD = ''; assert.throws(() => makeServer(), /Public demo requires/); process.env.DEMO_ACCESS_PASSWORD = values.DEMO_ACCESS_PASSWORD;
    server = makeServer(); await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
    const headers = { Host: 'demo.example', 'X-Forwarded-Proto': 'https', Origin: 'https://demo.example', Authorization: `Basic ${Buffer.from('judge:test-only-strong-password').toString('base64')}`, 'Content-Type': 'application/json' };
    const publicFetch = (path: string, init: { headers: Record<string, string>; method?: string; body?: string }) => new Promise<Response>((resolve, reject) => { const req = request(base + path, { method: init.method || 'GET', headers: init.headers }, response => { let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve(new Response(body, { status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }))); }); req.on('error', reject); req.end(init.body); });
    assert.equal((await publicFetch('/api/health', { headers: { Host: 'demo.example', 'X-Forwarded-Proto': 'https' } })).status, 200);
    const unauthorized = await publicFetch('/api/status', { headers: { ...headers, Authorization: '' } }); assert.equal(unauthorized.status, 401); assert.match(unauthorized.headers.get('www-authenticate') || '', /Basic/);
    for (let attempt = 0; attempt < 9; attempt++) assert.equal((await publicFetch('/api/status', { headers: { ...headers, Authorization: '' } })).status, 401);
    assert.equal((await publicFetch('/api/status', { headers: { ...headers, Authorization: '' } })).status, 429);
    assert.equal((await publicFetch('/api/status', { headers: { ...headers, Host: 'evil.example' } })).status, 403);
    assert.equal((await publicFetch('/api/status', { headers: { ...headers, 'X-Forwarded-Proto': 'http' } })).status, 403);
    const status = await (await publicFetch('/api/status', { headers })).json(); assert.equal(status.approvedCapUSD, 3); assert.equal(status.reservedUSD, 1.8); assert.equal(status.remainingUSD, 1.2); assert.equal(status.maxRequests, 8); assert.equal(status.maxVoiceSeconds, 120);
    const post = (origin = headers.Origin) => publicFetch('/api/session', { method: 'POST', headers: { ...headers, Origin: origin }, body: JSON.stringify({ mode: 'mock', consent: true }) });
    assert.equal((await post('https://evil.example')).status, 403); assert.equal((await post()).status, 200); assert.equal((await post()).status, 200); assert.equal((await post()).status, 429);
    await writeFile(values.BUDGET_KILL_SWITCH_PATH, 'Disabled deliberately for test.');
    const disabled = await (await publicFetch('/api/status', { headers })).json(); assert.equal(disabled.approved, false); assert.equal(disabled.disabled, true);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    Object.keys(values).forEach((key, i) => { if (old[i] === undefined) delete process.env[key]; else process.env[key] = old[i]; }); await rm(directory, { recursive: true, force: true });
  }
});
