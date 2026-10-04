import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { resolve, extname, isAbsolute } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { z } from 'zod';
import { analyse, ReasonInputSchema, MapInputSchema, synthesizeMap } from './providers';
import { unseenCase } from './cases';
import { topics, type Mode } from './domain';
import { BudgetLedger, type BudgetSnapshot } from './budget';
import { relayScribe } from './scribe-relay';
import { relayAgent } from './agent-relay';

try { process.loadEnvFile('.env'); } catch { /* Environment-only setup is supported. */ }
type Ticket = { mode: Mode; active: boolean; controllers: Set<AbortController>; voiceControllers: Set<AbortController>; expires: number; voiceReservation?: string; agentUrl?: string; agentUsed?: boolean; scribeToken?: string; scribeUsed?: boolean; voiceExpires?: number; voiceMaxSeconds?: number; voiceStartedAt?: number };
function approvedTotalCap() {
  // Legacy .env held only US$1.20 remaining; migrate without treating that as a fresh allowance.
  const explicit = Number(process.env.PROVIDER_TOTAL_CAP_USD);
  return Number.isFinite(explicit) && explicit > 0 ? explicit : 1.8 + Math.max(0, Number(process.env.PROVIDER_USAGE_CAP_USD) || 0);
}
function readiness(budget: BudgetSnapshot, disabled: boolean) {
  const configuredCap = Number(process.env.PROVIDER_TOTAL_CAP_USD || process.env.PROVIDER_USAGE_CAP_USD);
  return { claude: !!process.env.ANTHROPIC_API_KEY, elevenlabs: !!process.env.ELEVENLABS_API_KEY, agent: !!process.env.ELEVENLABS_AGENT_ID,
    approved: !disabled && process.env.LIVE_USAGE_APPROVED === 'true' && Number.isFinite(configuredCap) && configuredCap > 0,
    disabled, maxRequests: Math.min(8, Math.max(1, Number(process.env.MAX_LIVE_REQUESTS) || 8)), maxVoiceSeconds: Math.min(120, Math.max(10, Number(process.env.MAX_LIVE_VOICE_SECONDS) || 120)),
    ...budget, reservedUSD: budget.committedUSD };
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function json(req: IncomingMessage, maxBytes = 700000): Promise<unknown> {
  let data = ''; let size = 0;
  for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > maxBytes) throw new Error('Request exceeds bounded frame/context size.'); data += chunk; }
  return JSON.parse(data || '{}');
}
async function eleven(path: string, signal: AbortSignal, method = 'GET') {
  const response = await fetch(`https://api.elevenlabs.io${path}`, { method, signal, headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY || '' } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: { status?: string; message?: string } };
    if (body.detail?.status === 'missing_permissions' && body.detail.message?.includes('convai_write')) throw new Error('Signed voice sessions require ElevenAgents Write (convai_write) on the restricted API key. Read alone is insufficient. Update that scope deliberately.');
    throw new Error(`ElevenLabs failed (${response.status}). Check quota, feature access and agent configuration. No simulated fallback.`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}
export function makeServer(options: { ledgerPath?: string; initialHeldUSD?: number; knownHistoricalUSD?: number; initializeBudget?: boolean; scribeConnect?: (token: string) => WebSocket; agentConnect?: (signedUrl: string, origin?: string) => WebSocket } = {}) {
  const publicDemo = process.env.PUBLIC_DEMO === 'true';
  const allowedHosts = (process.env.ALLOWED_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean);
  const accessUser = process.env.DEMO_ACCESS_USER || ''; const accessPassword = process.env.DEMO_ACCESS_PASSWORD || '';
  const ledgerPath = options.ledgerPath || process.env.BUDGET_LEDGER_PATH || resolve('tmp/provider-usage-ledger.json');
  if (publicDemo && (!allowedHosts.length || !allowedOrigins.length || allowedOrigins.some(origin => !origin.startsWith('https://')) || !accessUser || accessPassword.length < 16 || !process.env.BUDGET_LEDGER_PATH || !isAbsolute(ledgerPath))) throw new Error('Public demo requires explicit HTTPS host/origin allowlists, a strong server-side access credential and an absolute persistent-disk budget ledger path.');
  const ledger = new BudgetLedger(ledgerPath, approvedTotalCap, options.initialHeldUSD, options.knownHistoricalUSD, options.initializeBudget ?? process.env.BUDGET_INITIALIZE_ALLOWED === 'true');
  const tickets = new Map<string, Ticket>(); let activeLive = 0;
  const rates = new Map<string, { at: number; count: number }>();
  const maxConcurrency = Math.min(2, Math.max(1, Number(process.env.MAX_LIVE_CONCURRENCY) || 1));
  const rateLimit = Math.min(120, Math.max(1, Number(process.env.MAX_API_REQUESTS_PER_MINUTE) || (publicDemo ? 60 : 120)));
  const expectedAuth = Buffer.from(`Basic ${Buffer.from(`${accessUser}:${accessPassword}`).toString('base64')}`);
  function takeRate(key: string, limit: number) {
    const now = Date.now(); const rate = rates.get(key);
    for (const [name, record] of rates) if (now - record.at > 60000) rates.delete(name);
    if (!rate || now - rate.at > 60000) { rates.set(key, { at: now, count: 1 }); return true; }
    return ++rate.count <= limit;
  }
  async function disabled() { if (process.env.LIVE_USAGE_DISABLED === 'true') return true; try { await access(process.env.BUDGET_KILL_SWITCH_PATH || `${ledgerPath}.disabled`); return true; } catch { return false; } }
  async function currentReadiness() { return readiness(await ledger.snapshot(), await disabled()); }
  async function reserve(kind: 'reason' | 'map' | 'voice', amount: number) {
    const r = await currentReadiness();
    if (!r.approved || !r.claude || !r.elevenlabs || !r.agent) throw new Error('Live mode needs secure keys, agent and approved usage cap; verify the kill switch.');
    return ledger.reserve(kind, amount, r.maxRequests, r.maxVoiceSeconds, maxConcurrency);
  }
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
      if (!(allowedHosts.length ? allowedHosts.includes(host.toLowerCase()) : !publicDemo && localHost)) { send(res, 403, { error: 'Host is not allowlisted.' }); return; }
      const url = new URL(req.url || '/', `http://${host}`);
      if (publicDemo && req.headers['x-forwarded-proto'] !== 'https') { send(res, 403, { error: 'HTTPS is required behind the configured hosting proxy.' }); return; }
      if (url.pathname === '/api/health' && req.method === 'GET') { send(res, 200, { healthy: true }); return; }
      if (publicDemo) {
        const supplied = Buffer.from(req.headers.authorization || '');
        if (supplied.length !== expectedAuth.length || !timingSafeEqual(supplied, expectedAuth)) { if (!takeRate(`auth:${req.socket.remoteAddress || 'unknown'}`, 10)) { send(res, 429, { error: 'Access attempt limit reached. Pause before retrying.' }); return; } res.setHeader('www-authenticate', 'Basic realm="The Ropes private demo", charset="UTF-8"'); send(res, 401, { error: 'Demo access credentials are required.' }); return; }
      }
      const origin = req.headers.origin || '';
      const localOrigins = [`http://${host}`, 'http://localhost:5184', 'http://127.0.0.1:5184'];
      if (url.pathname.startsWith('/api/') && req.method === 'POST' && !(allowedOrigins.length ? allowedOrigins.includes(origin) : !publicDemo && localOrigins.includes(origin))) { send(res, 403, { error: 'Request origin is not allowlisted.' }); return; }
      if (url.pathname.startsWith('/api/') && req.method === 'POST') {
        if (!takeRate(`api:${req.socket.remoteAddress || 'unknown'}`, rateLimit)) { send(res, 429, { error: 'API rate limit reached. Pause before retrying.' }); return; }
      }
      if (url.pathname === '/api/status') { send(res, 200, { ...await currentReadiness(), defaultMode: 'mock', liveVerified: false }); return; }
      if (url.pathname === '/api/session' && req.method === 'POST') {
        const data = z.object({ mode: z.enum(['mock', 'live']), consent: z.literal(true) }).strict().parse(await json(req));
        if (data.mode === 'live' && !(await currentReadiness()).approved) throw new Error('Approve a usage cap in secure local settings before live mode; verify the kill switch.');
        for (const [id, ticket] of tickets) if (ticket.expires < Date.now()) { ticket.controllers.forEach(c => c.abort()); tickets.delete(id); }
        if (tickets.size >= 100) throw new Error('Session limit reached. Restart local server to clear abandoned sessions.');
        const id = crypto.randomUUID();
        tickets.set(id, { mode: data.mode, active: true, controllers: new Set(), voiceControllers: new Set(), expires: Date.now() + 15 * 60 * 1000 });
        send(res, 200, { id }); return;
      }
      const route = url.pathname.match(/^\/api\/session\/([a-f0-9-]+)\/(revoke|reason|map|voice|case)$/);
      if (route && req.method === 'POST') {
        const ticket = tickets.get(route[1]);
        if (!ticket) { send(res, 404, { error: 'Session expired. Reconnect deliberately.' }); return; }
        if (route[2] === 'revoke') { ticket.active = false; ticket.controllers.forEach(c => c.abort()); ticket.controllers.clear(); if (ticket.voiceReservation) await ledger.stopVoice(ticket.voiceReservation); send(res, 200, { revoked: true }); return; }
        if (!ticket.active || ticket.expires < Date.now()) { send(res, 409, { error: 'This segment is off record or expired.' }); return; }
        if (route[2] === 'case') {
          const data = z.object({ topic: z.enum(topics) }).strict().parse(await json(req));
          send(res, 200, unseenCase(data.topic)); return;
        }
        if (ticket.mode === 'live' && activeLive >= maxConcurrency) { send(res, 429, { error: 'A live provider request is already active. Wait for it or cancel the session.' }); return; }
        if (ticket.mode === 'live') activeLive++;
        const controller = new AbortController(); ticket.controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
          let output: unknown;
          if (route[2] === 'reason') {
            const input = ReasonInputSchema.parse(await json(req));
            if (ticket.mode === 'live') await reserve('reason', 0.25);
            output = await analyse(ticket.mode, input, controller.signal);
          } else if (route[2] === 'map') {
            const input = MapInputSchema.parse(await json(req, 200000));
            if (ticket.mode === 'live') await reserve('map', 0.5);
            output = await synthesizeMap(ticket.mode, input, controller.signal);
          } else {
            if (ticket.mode !== 'live') throw new Error('Simulated voice uses local text controls, not provider credentials.');
            if (!process.env.ELEVENLABS_AGENT_ID?.startsWith('agent_')) throw new Error('ELEVENLABS_AGENT_ID must be the existing agent ID (agent_...), not an API Key ID.');
            // Two short-lived provider credentials; only authenticated one-use relay paths leave this server.
            const config = await eleven(`/v1/convai/agents/${encodeURIComponent(process.env.ELEVENLABS_AGENT_ID || '')}`, controller.signal);
            const cc = config.conversation_config as { tts?: { model_id?: string; expressive_mode?: boolean }; conversation?: { max_duration_seconds?: number } } | undefined;
            const platform = config.platform_settings as { auth?: { enable_auth?: boolean; allowlist?: unknown[] } } | undefined;
            if (platform?.auth?.enable_auth !== true || platform.auth.allowlist?.length) throw new Error('Published agent must require signed URL authentication without a public agent allowlist. Verify securely in ElevenLabs.');
            if (cc?.tts?.model_id !== 'eleven_v3_conversational') throw new Error('Agent must use V3 Conversational (Expressive mode). Configure securely in ElevenLabs dashboard.');
            if (cc.tts.expressive_mode !== true) throw new Error('Enable Expressive mode for the published V3 Conversational agent before connecting.');
            const maxSeconds = (await currentReadiness()).maxVoiceSeconds;
            if (!Number.isFinite(cc.conversation?.max_duration_seconds) || Number(cc.conversation?.max_duration_seconds) > maxSeconds || Number(cc.conversation?.max_duration_seconds) < 1) throw new Error(`Published agent Max conversation duration must be at most ${maxSeconds} seconds. Configure Call limits securely in ElevenLabs before connecting.`);
            const reservation = await reserve('voice', 1);
            try {
              const signed = await eleven(`/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(process.env.ELEVENLABS_AGENT_ID || '')}`, controller.signal);
              const scribe = await eleven('/v1/single-use-token/realtime_scribe', controller.signal, 'POST');
              if (typeof signed.signed_url !== 'string' || typeof scribe.token !== 'string') throw new Error('Malformed provider session response.');
              ticket.voiceReservation = reservation;
              ticket.agentUrl = signed.signed_url; ticket.agentUsed = false; ticket.scribeToken = scribe.token; ticket.scribeUsed = false; ticket.voiceExpires = Date.now() + 30000; ticket.voiceMaxSeconds = maxSeconds; ticket.voiceStartedAt = undefined;
              output = { agentPath: `/api/session/${route[1]}/agent`, scribePath: `/api/session/${route[1]}/scribe`, maxSeconds };
            } catch (error) {
              // No relay paths reached the client, so no paid audio session could start.
              // Keep the request count consumed to bound repeated credential failures.
              await ledger.release(reservation);
              throw error;
            }
          }
          if (!ticket.active || controller.signal.aborted) { send(res, 409, { error: 'Discarded late/off-record provider result.' }); return; }
          send(res, 200, output);
        } finally { clearTimeout(timeout); ticket.controllers.delete(controller); if (ticket.mode === 'live') activeLive--; }
        return;
      }
      if (url.pathname.startsWith('/api/')) { send(res, 404, { error: 'Unknown API route.' }); return; }
      const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const root = resolve('dist'); const path = resolve(root, requested);
      if (!path.startsWith(root + '/') && path !== resolve(root, 'index.html')) { send(res, 403, { error: 'Invalid path.' }); return; }
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      let contents: Buffer; let mime = types[extname(path)] || 'application/octet-stream';
      try { contents = await readFile(path); } catch { contents = await readFile(resolve(root, 'index.html')); mime = 'text/html'; }
      res.writeHead(200, { 'content-type': mime, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(self), display-capture=(self)', 'strict-transport-security': 'max-age=31536000', 'cache-control': mime === 'text/html' ? 'no-store' : 'public, max-age=3600' }); res.end(contents);
    } catch (error) {
      // Never echo provider response bodies, credentials or private request contents.
      const message = error instanceof z.ZodError ? 'Invalid request or model output. Correct the data before retrying.' : error instanceof Error && error.name !== 'AbortError' ? error.message : 'Provider timeout or cancelled segment. Reconnect deliberately.';
      send(res, 400, { error: message });
    }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 200000 });
  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const host = req.headers.host || ''; const origin = req.headers.origin || '';
      const hostAllowed = allowedHosts.length ? allowedHosts.includes(host.toLowerCase()) : !publicDemo && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
      const originAllowed = allowedOrigins.length ? allowedOrigins.includes(origin) : !publicDemo && [`http://${host}`, 'http://localhost:5184', 'http://127.0.0.1:5184'].includes(origin);
      const auth = Buffer.from(req.headers.authorization || ''); const authenticated = !publicDemo || auth.length === expectedAuth.length && timingSafeEqual(auth, expectedAuth);
      const pathname = new URL(req.url || '/', `http://${host}`).pathname;
      const route = pathname.match(/^\/api\/session\/([a-f0-9-]+)\/(scribe|agent)$/); const ticket = route && tickets.get(route[1]);
      const isAgent = route?.[2] === 'agent';
      const liveDisabled = await disabled();
      // Mutable single-use flags are checked after the await, then consumed synchronously.
      if (!hostAllowed || !originAllowed || !authenticated || publicDemo && req.headers['x-forwarded-proto'] !== 'https' || !ticket || ticket.mode !== 'live' || !ticket.active || ticket.expires < Date.now() || (ticket.voiceExpires || 0) < Date.now() || isAgent && (!ticket.agentUrl || ticket.agentUsed || req.headers['sec-websocket-protocol'] !== 'convai') || !isAgent && (!ticket.scribeToken || ticket.scribeUsed) || liveDisabled) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
      const credential = isAgent ? ticket.agentUrl! : ticket.scribeToken!;
      if (isAgent) { ticket.agentUsed = true; ticket.agentUrl = undefined; } else { ticket.scribeUsed = true; ticket.scribeToken = undefined; }
      ticket.voiceStartedAt ||= Date.now();
      const seconds = Math.max(0, (ticket.voiceStartedAt + (ticket.voiceMaxSeconds || 120) * 1000 - Date.now()) / 1000);
      sockets.handleUpgrade(req, socket, head, client => {
        const controller = new AbortController(); ticket.controllers.add(controller); ticket.voiceControllers.add(controller);
        if (isAgent) relayAgent(client, credential, seconds, controller.signal, disabled, options.agentConnect, origin); else relayScribe(client, credential, seconds, controller.signal, disabled, options.scribeConnect);
        client.on('close', () => { ticket.controllers.delete(controller); ticket.voiceControllers.delete(controller); ticket.voiceControllers.forEach(c => c.abort()); if (ticket.voiceReservation) void ledger.stopVoice(ticket.voiceReservation).catch(() => {}); });
      });
    })().catch(() => { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); });
  });
  server.on('close', () => { for (const client of sockets.clients) client.terminate(); sockets.close(); });
  return server;
}
if (process.argv[1]?.endsWith('server.ts')) {
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || '127.0.0.1';
  makeServer().listen(port, host, () => console.log(`Apprentice API listening on configured host, port ${port} · simulated providers by default`));
}
