import WebSocket from 'ws';
import { z } from 'zod';

const empty = z.object({}).strict();
const InitSchema = z.object({ type: z.literal('conversation_initiation_client_data'), conversation_config_override: z.object({ agent: empty.optional(), tts: empty.optional(), conversation: z.object({ text_only: z.literal(false).optional() }).strict().optional() }).strict().optional(), source_info: z.object({ source: z.literal('js_sdk'), version: z.string().max(30) }).strict().optional() }).strict();
const ClientMessageSchema = z.union([
  InitSchema,
  z.object({ user_audio_chunk: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(16384) }).strict(),
  z.object({ type: z.literal('pong'), event_id: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('user_activity') }).strict(),
  z.object({ type: z.enum(['contextual_update', 'user_message']), text: z.string().max(60000) }).strict()
]);
const events = new Set(['conversation_initiation_metadata', 'audio', 'interruption', 'ping', 'agent_response', 'user_transcript', 'vad_score', 'asr_initiation_metadata', 'agent_chat_response_part', 'internal_tentative_agent_response', 'mcp_tool_call', 'mcp_connection_status', 'agent_tool_request', 'agent_tool_response']);

/** One bounded server socket owns the signed URL; clients cannot reuse or extend it. */
export function relayAgent(client: WebSocket, signedUrl: string, maxSeconds: number, signal: AbortSignal, disabled: () => Promise<boolean>, connect = (value: string, origin?: string) => new WebSocket(value, ['convai'], { maxPayload: 1_000_000, ...(origin ? { origin } : {}) }), origin?: string) {
  const upstream = connect(signedUrl, origin); let stopped = false; let initialized = false; let audioBytes = 0; let contextBytes = 0; let questions = 0; let updates = 0; let rateAt = Date.now(); let messages = 0; let outputBytes = 0; const pending: string[] = [];
  const stop = (message?: string) => {
    if (stopped) return; stopped = true; clearTimeout(timer); clearInterval(killCheck); signal.removeEventListener('abort', cancelled);
    if (message && client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'error', error_event: { error_type: 'bounded_relay', message } }));
    client.close(1000, 'Bounded Agent session ended'); upstream.close();
    const terminate = setTimeout(() => { client.terminate(); upstream.terminate(); }, 500); terminate.unref();
  };
  const cancelled = () => stop(); const timer = setTimeout(() => stop('Server voice duration limit reached. Reconnect deliberately.'), Math.min(120, maxSeconds) * 1000);
  const killCheck = setInterval(() => { void disabled().then(value => { if (value) stop('Live usage is disabled.'); }).catch(() => stop('Live usage configuration could not be verified.')); }, 1000); killCheck.unref();
  signal.addEventListener('abort', cancelled, { once: true }); if (signal.aborted) stop();
  client.on('message', (raw, binary) => {
    if (stopped) return;
    try {
      if (binary) throw new Error('Binary messages are unsupported.');
      const data = ClientMessageSchema.parse(JSON.parse(raw.toString())); const now = Date.now();
      if (now - rateAt >= 1000) { rateAt = now; messages = 0; } if (++messages > 40) throw new Error('Message rate exceeded.');
      if ('type' in data && data.type === 'conversation_initiation_client_data') { if (initialized) throw new Error('Repeated initialization.'); initialized = true; }
      else if (!initialized) throw new Error('Initialization is required.');
      if ('user_audio_chunk' in data) { audioBytes += Buffer.from(data.user_audio_chunk, 'base64').length; if (audioBytes > 96000 * Math.min(120, maxSeconds)) throw new Error('Audio bound exceeded.'); }
      if ('text' in data) { contextBytes += Buffer.byteLength(data.text); if (contextBytes > 512000) throw new Error('Context bound exceeded.'); }
      if ('type' in data && (data.type === 'user_message' && ++questions > 16 || data.type === 'contextual_update' && ++updates > 16)) throw new Error('Grounded turn bound exceeded.');
      if (upstream.bufferedAmount > 512000) throw new Error('Backpressure bound exceeded.');
      // Do not permit client configuration overrides, including model/prompt/duration changes.
      const message = JSON.stringify('type' in data && data.type === 'conversation_initiation_client_data' ? { type: data.type, ...(data.source_info ? { source_info: data.source_info } : {}) } : data);
      if (upstream.readyState === WebSocket.OPEN) upstream.send(message); else if (pending.length < 20 && upstream.readyState === WebSocket.CONNECTING) pending.push(message); else throw new Error('Agent is unavailable.');
    } catch { stop('Invalid or excessive Agent input. Stop and reconnect deliberately.'); }
  });
  upstream.on('open', () => { if (stopped) { upstream.close(); return; } for (const message of pending) upstream.send(message); pending.length = 0; });
  upstream.on('message', (raw, binary) => {
    if (stopped || client.readyState !== WebSocket.OPEN) return;
    try {
      if (binary) throw new Error('Unexpected provider binary message.');
      outputBytes += Buffer.byteLength(raw.toString()); if (outputBytes > 20_000_000 || client.bufferedAmount > 2_000_000) throw new Error('Output bound exceeded.');
      const data = JSON.parse(raw.toString()) as { type?: unknown };
      if (data.type === 'error') { stop('ElevenAgents failed or reached a provider limit. Reconnect deliberately.'); return; }
      if (typeof data.type !== 'string' || !events.has(data.type)) throw new Error('Unsupported provider event.');
      client.send(raw.toString());
    } catch { stop('Unexpected or excessive ElevenAgents response.'); }
  });
  upstream.on('error', () => stop('ElevenAgents connection failed. Reconnect deliberately.')); upstream.on('close', () => stop()); client.on('error', () => stop()); client.on('close', () => stop());
  return stop;
}
