import WebSocket from 'ws';
import { z } from 'zod';

const AudioSchema = z.object({ message_type: z.literal('input_audio_chunk'), audio_base_64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(16384), sample_rate: z.literal(16000), commit: z.boolean().optional() }).strict();

/** Audio is streamed, never written. Single-use token remains server-side. */
export function relayScribe(client: WebSocket, token: string, maxSeconds: number, signal: AbortSignal, disabled: () => Promise<boolean>, connect = (value: string) => new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000&commit_strategy=vad&token=${encodeURIComponent(value)}`, { maxPayload: 65536 })) {
  const upstream = connect(token); let stopped = false; let bytes = 0; let rateAt = Date.now(); let chunks = 0; const pending: string[] = [];
  const stop = (message?: string) => {
    if (stopped) return; stopped = true; clearTimeout(timer); clearInterval(killCheck); signal.removeEventListener('abort', cancelled);
    if (message && client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ message_type: 'error', text: message }));
    client.close(1000, 'Bounded Scribe session ended'); upstream.close();
    const terminate = setTimeout(() => { client.terminate(); upstream.terminate(); }, 500); terminate.unref();
  };
  const cancelled = () => stop(); const timer = setTimeout(() => stop('Server voice duration limit reached. Reconnect deliberately.'), Math.min(120, maxSeconds) * 1000);
  const killCheck = setInterval(() => { void disabled().then(value => { if (value) stop('Live usage is disabled.'); }).catch(() => stop('Live usage configuration could not be verified.')); }, 1000); killCheck.unref();
  signal.addEventListener('abort', cancelled, { once: true }); if (signal.aborted) stop();
  client.on('message', (raw, binary) => {
    if (stopped) return;
    try {
      if (binary) throw new Error('Binary audio is not supported.');
      const data = AudioSchema.parse(JSON.parse(raw.toString())); const now = Date.now();
      if (now - rateAt >= 1000) { rateAt = now; chunks = 0; }
      if (++chunks > 8) throw new Error('Audio rate exceeded.');
      bytes += Buffer.from(data.audio_base_64, 'base64').length;
      if (bytes > 32000 * Math.min(120, maxSeconds) || upstream.bufferedAmount > 160000) throw new Error('Audio bound exceeded.');
      const message = JSON.stringify(data);
      if (upstream.readyState === WebSocket.OPEN) upstream.send(message); else if (pending.length < 8 && upstream.readyState === WebSocket.CONNECTING) pending.push(message); else throw new Error('Scribe is unavailable.');
    } catch { stop('Invalid or excessive audio input. Stop and reconnect deliberately.'); }
  });
  upstream.on('open', () => { if (stopped) { upstream.close(); return; } for (const message of pending) upstream.send(message); pending.length = 0; });
  upstream.on('message', raw => {
    if (stopped || client.readyState !== WebSocket.OPEN) return;
    try {
      const data = JSON.parse(raw.toString()) as { message_type?: unknown; text?: unknown };
      if (typeof data.message_type !== 'string') throw new Error('Malformed transcript.');
      if (['partial_transcript', 'committed_transcript'].includes(data.message_type)) {
        if (typeof data.text !== 'string' || data.text.length > 12000) throw new Error('Unbounded transcript.');
        client.send(JSON.stringify({ message_type: data.message_type, text: data.text }));
      } else if (data.message_type === 'session_started') client.send(JSON.stringify({ message_type: 'session_started' }));
      else if (data.message_type === 'warning') client.send(JSON.stringify({ message_type: 'warning', text: 'Check provider retention/configuration; do not assume zero retention.' }));
      else if (data.message_type.endsWith('_error') || ['error', 'rate_limited', 'quota_exceeded', 'throttled', 'queue_overflow', 'resource_exhausted', 'unaccepted_terms', 'session_time_limit_exceeded'].includes(data.message_type)) stop('Scribe failed or reached a provider limit. Reconnect deliberately.');
    } catch { stop('Malformed Scribe response.'); }
  });
  upstream.on('error', () => stop('Scribe connection failed. Reconnect deliberately.')); upstream.on('close', () => stop());
  client.on('error', () => stop()); client.on('close', () => stop());
  return stop;
}
