// Procedural Web Audio synthesizer for crisp, low-latency golf audio effects

class GolfAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isMuted: boolean = false;

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.masterGain) {
      this.masterGain.gain.value = this.isMuted ? 0 : 0.5;
    }
    return this.isMuted;
  }

  public playSwingWhoosh(speedPercent = 1.0) {
    this.initContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;

    const bufferSize = this.ctx.sampleRate * 0.4;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    const now = this.ctx.currentTime;
    filter.frequency.setValueAtTime(200, now);
    filter.frequency.exponentialRampToValueAtTime(1200 * speedPercent, now + 0.15);
    filter.frequency.exponentialRampToValueAtTime(150, now + 0.35);
    filter.Q.value = 3.0;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.4 * speedPercent, now + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(now);
    noise.stop(now + 0.4);
  }

  public playClubImpact(category: 'wood' | 'iron' | 'wedge' | 'putter', power = 1.0) {
    this.initContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;

    if (category === 'wood') {
      // Crisp driver "PING" + solid resonance
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(4200, now);
      osc.frequency.exponentialRampToValueAtTime(2400, now + 0.08);

      const oscGain = this.ctx.createGain();
      oscGain.gain.setValueAtTime(0.6 * power, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      // Metallic body thud
      const thud = this.ctx.createOscillator();
      thud.type = 'triangle';
      thud.frequency.setValueAtTime(320, now);
      thud.frequency.exponentialRampToValueAtTime(80, now + 0.09);

      const thudGain = this.ctx.createGain();
      thudGain.gain.setValueAtTime(0.8 * power, now);
      thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      osc.connect(oscGain);
      thud.connect(thudGain);
      oscGain.connect(this.masterGain);
      thudGain.connect(this.masterGain);

      osc.start(now);
      thud.start(now);
      osc.stop(now + 0.15);
      thud.stop(now + 0.15);

    } else if (category === 'iron') {
      // Solid steel "THWACK"
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(950, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.06);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.9 * power, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.1);

    } else if (category === 'wedge') {
      // Crisp blade compression "CLICK-CHIP"
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1800, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.05);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.7 * power, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.08);

    } else {
      // Putter: Pure subtle hollow "TICK"
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1100, now);
      osc.frequency.exponentialRampToValueAtTime(600, now + 0.03);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.3 * Math.min(1.0, power * 2), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.05);
    }
  }

  public playBounce(surface: 'green' | 'fairway' | 'rough' | 'sand', intensity = 1.0) {
    this.initContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;
    const vol = Math.min(1.0, Math.max(0.1, intensity));

    if (surface === 'sand') {
      // Low sand splash "THUFF"
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.2, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.7 * vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      src.start(now);
      src.stop(now + 0.2);

    } else {
      // Grass bounce / tap
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      const freq = surface === 'green' ? 240 : 180;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.04);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.4 * vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.06);
    }
  }

  public playCupDrop() {
    this.initContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;

    // Plastic cup bottom hit + flagstick rattle
    [
      { freq: 880, delay: 0.0, vol: 0.7 },
      { freq: 1100, delay: 0.04, vol: 0.5 },
      { freq: 720, delay: 0.09, vol: 0.4 },
      { freq: 1320, delay: 0.14, vol: 0.3 }
    ].forEach(note => {
      const t = now + note.delay;
      const osc = this.ctx!.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, t);
      osc.frequency.exponentialRampToValueAtTime(note.freq * 0.8, t + 0.05);

      const gain = this.ctx!.createGain();
      gain.gain.setValueAtTime(note.vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.09);
    });
  }

  public playWaterSplash() {
    this.initContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;

    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.4);
    filter.Q.value = 1.5;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.5);
  }
}

export const soundFx = new GolfAudioEngine();
