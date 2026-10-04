import { PrivacyGate } from './domain';

export class ScreenCapture {
  gate = new PrivacyGate();
  stream?: MediaStream;
  video = document.createElement('video');
  canvas = document.createElement('canvas');
  timer?: ReturnType<typeof setInterval>;
  constructor(private onStopped: () => void) { this.video.muted = true; this.video.playsInline = true; }
  async select(): Promise<string> {
    this.stop(); const epoch = this.gate.begin();
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1, width: { max: 1280 }, height: { max: 900 } }, audio: false });
    if (!this.gate.accepts(epoch)) { stream.getTracks().forEach(t => t.stop()); throw new Error('Screen selection was cancelled.'); }
    this.stream = stream;
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (this.gate.accepts(epoch)) { this.stop(); this.onStopped(); } });
    this.video.srcObject = stream;
    await this.video.play();
    if (!this.gate.accepts(epoch)) throw new Error('Screen selection was cancelled.');
    // Preview acquisition is consented, but it is never recorded or transmitted.
    return this.snapshot();
  }
  snapshot(): string {
    if (!this.gate.active || !this.stream?.getVideoTracks().some(t => t.readyState === 'live') || !this.video.videoWidth) throw new Error('Sharing stopped. Select the synthetic workspace again.');
    const scale = Math.min(1, 1280 / this.video.videoWidth);
    this.canvas.width = Math.round(this.video.videoWidth * scale); this.canvas.height = Math.round(this.video.videoHeight * scale);
    this.canvas.getContext('2d')!.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    return this.canvas.toDataURL('image/jpeg', 0.65);
  }
  sample(callback: (image: string) => void) {
    const epoch = this.gate.epoch;
    this.timer = setInterval(() => { if (this.gate.accepts(epoch)) { try { callback(this.snapshot()); } catch { this.stop(); this.onStopped(); } } }, 2000);
  }
  stop() {
    this.gate.stop(); clearInterval(this.timer); this.timer = undefined;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = undefined;
    this.video.pause(); this.video.srcObject = null;
    this.canvas.width = 0; this.canvas.height = 0;
  }
}
export class SpeechActivity {
  stream?: MediaStream; context?: AudioContext; analyser?: AnalyserNode; timer?: ReturnType<typeof setInterval>;
  gate = new PrivacyGate();
  async start(onActivity: () => void, onFailure: () => void) {
    this.stop(); const epoch = this.gate.begin();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!this.gate.accepts(epoch)) { stream.getTracks().forEach(t => t.stop()); return; }
    this.stream = stream; this.context = new AudioContext(); this.analyser = this.context.createAnalyser();
    this.context.createMediaStreamSource(stream).connect(this.analyser); this.analyser.fftSize = 512;
    stream.getTracks().forEach(t => t.addEventListener('ended', () => { if (this.gate.accepts(epoch)) { this.stop(); onFailure(); } }));
    const data = new Float32Array(512);
    this.timer = setInterval(() => {
      if (!this.gate.accepts(epoch)) return;
      this.analyser?.getFloatTimeDomainData(data);
      if (Math.sqrt(data.reduce((sum, n) => sum + n * n, 0) / data.length) > 0.025) onActivity();
    }, 100);
  }
  stop() { this.gate.stop(); clearInterval(this.timer); this.stream?.getTracks().forEach(t => t.stop()); this.stream = undefined; void this.context?.close(); this.context = undefined; }
}
