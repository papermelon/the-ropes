import type { Conversation } from '@elevenlabs/client';
import { PrivacyGate, type VoiceEvent } from './domain';

export type VoiceState = 'listening' | 'processing' | 'speaking' | 'paused' | 'off-record' | 'disconnected';
export class LiveVoice {
  gate = new PrivacyGate();
  conversation?: Awaited<ReturnType<typeof Conversation.startSession>>;
  socket?: WebSocket; stream?: MediaStream; context?: AudioContext; processor?: ScriptProcessorNode;
  timer?: ReturnType<typeof setTimeout>; source?: MediaStreamAudioSourceNode;
  constructor(private state: (state: VoiceState) => void, private transcript: (text: string) => void, private failure: (message: string) => void, private activity: () => void, private audit: (event: Omit<VoiceEvent, 'at' | 'segmentId'>) => void = () => {}) {}
  // Check local permission and format before the server reserves paid voice credentials.
  async prepareMicrophone() {
    const stopping = this.stop(); const epoch = this.gate.epoch;
    await stopping;
    if (this.gate.epoch !== epoch) throw new Error('Microphone preparation cancelled.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true } });
    if (this.gate.epoch !== epoch) { stream.getTracks().forEach(t => t.stop()); throw new Error('Microphone preparation cancelled.'); }
    this.stream = stream;
    try {
      this.context = new AudioContext({ sampleRate: 16000 });
      if (this.context.sampleRate !== 16000) throw new Error('Device does not support 16 kHz capture for this Scribe adapter. Use text or another device.');
      await this.context.resume();
      if (this.gate.epoch !== epoch) throw new Error('Microphone preparation cancelled.');
    } catch (error) { if (this.gate.epoch === epoch) await this.stop(); throw error; }
  }
  async start(credentials: { agentPath: string; scribePath: string; maxSeconds: number }) {
    if (!/^\/api\/session\/[A-Za-z0-9_-]+\/agent$/.test(credentials.agentPath) || !/^\/api\/session\/[A-Za-z0-9_-]+\/scribe$/.test(credentials.scribePath) || !Number.isFinite(credentials.maxSeconds) || credentials.maxSeconds <= 0) throw new Error('Invalid voice transport configuration.');
    if (!this.stream || !this.context || !this.stream.getAudioTracks().some(t => t.readyState === 'live')) await this.prepareMicrophone();
    const epoch = this.gate.begin();
    const accept = () => this.gate.accepts(epoch);
    this.timer = setTimeout(() => { if (accept()) { this.failure('Voice duration limit reached. Your pending answer is retained; reconnect deliberately.'); void this.stop(); } }, Math.min(120, credentials.maxSeconds) * 1000);
    try {
      const { Conversation } = await import('@elevenlabs/client');
      if (!accept()) return;
      const conversation = await Conversation.startSession({ signedUrl: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${credentials.agentPath}`, connectionType: 'websocket',
        onConnect: ({ conversationId }) => { if (accept()) this.audit({ type: 'connected', conversationId }); },
        onModeChange: ({ mode }) => { if (accept()) { this.state(mode === 'speaking' ? 'speaking' : 'listening'); this.audit({ type: mode === 'speaking' ? 'speaking' : 'listening' }); } },
        onMessage: ({ source, message }) => { if (accept() && source === 'ai') this.audit({ type: 'agent-text', text: message.slice(0, 1500) }); },
        onInterruption: () => { if (accept()) this.audit({ type: 'interrupted' }); },
        onError: () => { if (accept()) { this.failure('ElevenAgents connection failed. Reconnect deliberately.'); void this.stop(); } },
        onDisconnect: () => { if (accept()) { this.audit({ type: 'disconnected' }); this.state('disconnected'); this.failure('ElevenAgents disconnected. Reconnect deliberately.'); void this.stop(); } }
      });
      if (!accept()) { await conversation.endSession(); return; }
      this.conversation = conversation;
      const stream = this.stream!;
      stream.getTracks().forEach(t => t.addEventListener('ended', () => { if (accept()) { this.failure('Microphone stopped. Reconnect deliberately.'); void this.stop(); } }));
      this.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${credentials.scribePath}`);
      this.socket.onmessage = (event) => {
        if (!accept()) return;
        try {
          const data = JSON.parse(event.data) as { message_type: string; text?: string };
          if (data.message_type === 'partial_transcript') this.activity();
          if (data.message_type === 'committed_transcript' && data.text) this.transcript(data.text);
          if (data.message_type === 'warning') this.failure('Scribe reported a retention/configuration warning. Check provider settings; do not assume zero retention.');
          if (data.message_type.endsWith('_error') || ['error', 'rate_limited', 'quota_exceeded', 'throttled', 'queue_overflow', 'resource_exhausted', 'unaccepted_terms', 'session_time_limit_exceeded'].includes(data.message_type)) { this.failure('Scribe failed or reached a limit. Reconnect deliberately.'); void this.stop(); }
        } catch { this.failure('Malformed Scribe response.'); void this.stop(); }
      };
      this.socket.onerror = () => { if (accept()) { this.failure('Scribe connection failed.'); void this.stop(); } };
      this.socket.onclose = () => { if (accept()) { this.failure('Scribe disconnected. Reconnect deliberately.'); void this.stop(); } };
      this.source = this.context!.createMediaStreamSource(stream);
      // ponytail: ScriptProcessor is a small, bounded prototype adapter; upgrade to AudioWorklet for production scheduling.
      this.processor = this.context!.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = (event) => {
        if (!accept() || this.socket?.readyState !== WebSocket.OPEN) return;
        const samples = event.inputBuffer.getChannelData(0); const bytes = new Uint8Array(samples.length * 2); const view = new DataView(bytes.buffer);
        let energy = 0;
        for (let i = 0; i < samples.length; i++) { const sample = Math.max(-1, Math.min(1, samples[i])); view.setInt16(i * 2, sample * (sample < 0 ? 32768 : 32767), true); energy += sample * sample; }
        if (Math.sqrt(energy / samples.length) > 0.025) this.activity();
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        this.socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: btoa(binary), sample_rate: 16000 }));
      };
      this.source.connect(this.processor); this.processor.connect(this.context!.destination);
      this.state('listening');
    } catch (e) { if (accept()) await this.stop(); throw e; }
  }
  update(text: string) { if (this.gate.active) this.conversation?.sendContextualUpdate(text); }
  ask(text: string) { if (this.gate.active) this.conversation?.sendUserMessage(`Please ask only this grounded question, then wait: ${text}`); }
  teachBack(text: string) { if (this.gate.active) this.ask(`Here is my proposed understanding: ${text} Does this reflect your judgment, or should I correct it?`); }
  userActivity() { if (this.gate.active) this.conversation?.sendUserActivity(); }
  async stop() {
    this.gate.stop(); clearTimeout(this.timer);
    // Detach every old handle before any await. A late cleanup cannot close a deliberate reconnect.
    const { processor, source, socket, stream, context, conversation } = this;
    this.processor = undefined; this.source = undefined; this.socket = undefined; this.stream = undefined; this.context = undefined; this.conversation = undefined; this.timer = undefined;
    if (processor) { processor.onaudioprocess = null; processor.disconnect(); }
    source?.disconnect(); socket?.close(); stream?.getTracks().forEach(t => t.stop());
    await Promise.allSettled([context && context.state !== 'closed' ? context.close() : Promise.resolve(), conversation?.endSession()]);
  }
}
