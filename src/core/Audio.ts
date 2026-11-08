// High-fidelity Golf Audio Engine supporting authentic recorded audio samples
// with procedural synthesis fallback and looping forest ambience.

class GolfAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  public isAmbientMuted: boolean = false;
  public isSfxMuted: boolean = false;

  // Cached audio buffers for authentic recorded sounds
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private isPreloading: boolean = false;
  private ambientSource: AudioBufferSourceNode | null = null;
  private ambientPlaying: boolean = false;

  constructor() {
    // Lazy preload once page is interactive
    if (typeof window !== 'undefined') {
      window.addEventListener('click', () => this.handleFirstInteraction(), { once: true });
      window.addEventListener('keydown', () => this.handleFirstInteraction(), { once: true });
      window.addEventListener('pointerdown', () => this.handleFirstInteraction(), { once: true });
    }
  }

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.isSfxMuted ? 0 : 0.65;
      this.masterGain.connect(this.ctx.destination);

      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.value = this.isAmbientMuted ? 0 : 0.28; // Subtle relaxing background level
      this.ambientGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  private handleFirstInteraction() {
    this.initContext();
    this.preloadAudioSamples();
    if (!this.isAmbientMuted) {
      this.startAmbientLoop();
    }
  }

  /**
   * Preloads user-provided audio samples:
   * - driver_hit_01.mp3
   * - golf_hit_generic_01.mp3
   * - putter_hit_01.mp3
   * - hole_01.mp3
   * - ambient_forest_sounds_01.mp3
   */
  public async preloadAudioSamples() {
    if (this.isPreloading) return;
    this.isPreloading = true;
    this.initContext();

    const files = [
      { key: 'driver', url: '/audio/driver_hit_01.mp3' },
      { key: 'generic_hit', url: '/audio/golf_hit_generic_01.mp3' },
      { key: 'putter', url: '/audio/putter_hit_01.mp3' },
      { key: 'hole', url: '/audio/hole_01.mp3' },
      { key: 'ambient', url: '/audio/ambient_forest_sounds_01.mp3' }
    ];

    for (const item of files) {
      try {
        const resp = await fetch(item.url);
        if (resp.ok) {
          const arrayBuf = await resp.arrayBuffer();
          if (this.ctx) {
            const audioBuf = await this.ctx.decodeAudioData(arrayBuf);
            this.audioBuffers.set(item.key, audioBuf);
          }
        }
      } catch (e) {
        console.warn(`Failed loading audio sample: ${item.url}`, e);
      }
    }

    if (!this.ambientPlaying && !this.isAmbientMuted) {
      this.startAmbientLoop();
    }
  }

  public startAmbientLoop() {
    this.initContext();
    if (!this.ctx || !this.ambientGain || this.isAmbientMuted || this.ambientPlaying) return;

    const buf = this.audioBuffers.get('ambient');
    if (!buf) {
      // Retry shortly once buffer finishes decoding
      setTimeout(() => {
        if (!this.ambientPlaying && !this.isAmbientMuted) this.startAmbientLoop();
      }, 500);
      return;
    }

    try {
      if (this.ambientSource) {
        try { this.ambientSource.stop(); } catch { /* ignore */ }
      }
      this.ambientSource = this.ctx.createBufferSource();
      this.ambientSource.buffer = buf;
      this.ambientSource.loop = true;
      this.ambientSource.connect(this.ambientGain);
      this.ambientSource.start(0);
      this.ambientPlaying = true;
    } catch (e) {
      console.warn('Error starting ambient loop:', e);
    }
  }

  public stopAmbientLoop() {
    if (this.ambientSource) {
      try { this.ambientSource.stop(); } catch { /* ignore */ }
      this.ambientSource = null;
    }
    this.ambientPlaying = false;
  }

  /** Toggle ambient background forest sounds mute */
  public toggleAmbientMute(): boolean {
    this.initContext();
    this.isAmbientMuted = !this.isAmbientMuted;
    if (this.ambientGain) {
      this.ambientGain.gain.value = this.isAmbientMuted ? 0 : 0.28;
    }
    if (!this.isAmbientMuted && !this.ambientPlaying) {
      this.startAmbientLoop();
    } else if (this.isAmbientMuted && this.ambientPlaying) {
      this.stopAmbientLoop();
    }
    return this.isAmbientMuted;
  }

  /** Toggle sound effects (hits, ball cup, deflections) mute */
  public toggleSfxMute(): boolean {
    this.initContext();
    this.isSfxMuted = !this.isSfxMuted;
    if (this.masterGain) {
      this.masterGain.gain.value = this.isSfxMuted ? 0 : 0.65;
    }
    return this.isSfxMuted;
  }

  /** Legacy master mute toggle (mutes/unmutes both) */
  public toggleMute(): boolean {
    const nextState = !this.isSfxMuted;
    this.isSfxMuted = nextState;
    this.isAmbientMuted = nextState;
    if (this.masterGain) this.masterGain.gain.value = nextState ? 0 : 0.65;
    if (this.ambientGain) this.ambientGain.gain.value = nextState ? 0 : 0.28;
    if (!nextState && !this.ambientPlaying) {
      this.startAmbientLoop();
    } else if (nextState && this.ambientPlaying) {
      this.stopAmbientLoop();
    }
    return nextState;
  }

  private playBuffer(key: string, volume = 1.0, playbackRate = 1.0): boolean {
    this.initContext();
    if (!this.ctx || !this.masterGain || this.isSfxMuted) return false;

    const buf = this.audioBuffers.get(key);
    if (!buf) return false;

    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = playbackRate;

      const gain = this.ctx.createGain();
      gain.gain.value = Math.max(0.1, Math.min(1.8, volume));

      src.connect(gain);
      gain.connect(this.masterGain);
      src.start(0);
      return true;
    } catch (e) {
      console.warn('playBuffer error:', e);
      return false;
    }
  }

  public playSwingWhoosh(speedPercent = 1.0) {
    this.initContext();
    if (!this.ctx || !this.masterGain || this.isSfxMuted) return;

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

  /**
   * Plays club impact sound:
   * - Driver uses driver_hit_01
   * - Putter uses putter_hit_01
   * - Irons, Wedges, and Fairway Woods use golf_hit_generic_01
   */
  public playClubImpact(category: 'wood' | 'iron' | 'wedge' | 'putter', power = 1.0, isDriver = false) {
    this.initContext();
    if (this.isSfxMuted) return;

    if (category === 'putter') {
      const vol = Math.max(0.4, Math.min(1.2, power * 1.4));
      if (this.playBuffer('putter', vol, 0.98 + (Math.random() - 0.5) * 0.04)) {
        return;
      }
    } else if (isDriver) {
      const vol = Math.max(0.6, Math.min(1.5, power * 1.1));
      if (this.playBuffer('driver', vol, 0.99 + (Math.random() - 0.5) * 0.03)) {
        return;
      }
    } else {
      // Irons, Wedges, Fairway Woods
      const vol = Math.max(0.5, Math.min(1.4, power * 1.15));
      if (this.playBuffer('generic_hit', vol, 0.98 + (Math.random() - 0.5) * 0.05)) {
        return;
      }
    }

    // Procedural fallback if buffer has not finished loading
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    if (category === 'wood' || isDriver) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(3800, now);
      osc.frequency.exponentialRampToValueAtTime(1800, now + 0.08);

      const oscGain = this.ctx.createGain();
      oscGain.gain.setValueAtTime(0.7 * power, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      const thud = this.ctx.createOscillator();
      thud.type = 'triangle';
      thud.frequency.setValueAtTime(280, now);
      thud.frequency.exponentialRampToValueAtTime(70, now + 0.09);

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
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1100, now);
      osc.frequency.exponentialRampToValueAtTime(600, now + 0.03);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.4 * Math.min(1.0, power * 2), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.05);
    }
  }

  public playBounce(surface: 'green' | 'fairway' | 'rough' | 'sand', intensity = 1.0) {
    this.initContext();
    if (!this.ctx || !this.masterGain || this.isSfxMuted) return;
    const now = this.ctx.currentTime;
    const vol = Math.min(1.0, Math.max(0.1, intensity));

    if (surface === 'sand') {
      // Soft sand deadening "THUD"
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.15, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(320, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.8 * vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      src.start(now);
      src.stop(now + 0.15);

    } else {
      // Grass bounce / tap
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      const freq = surface === 'green' ? 240 : (surface === 'fairway' ? 200 : 160);
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(50, now + 0.04);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.45 * vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.06);
    }
  }

  /**
   * Sound of golf ball going into the cup / hole
   * Uses user-provided hole_01.mp3
   */
  public playCupDrop() {
    this.initContext();
    if (this.isSfxMuted) return;

    if (this.playBuffer('hole', 1.2, 1.0)) {
      return;
    }

    // Procedural fallback
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
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

  /**
   * Ball deflection sound when striking a solid tree trunk
   */
  public playTreeHit(speedPercent = 1.0) {
    this.initContext();
    if (!this.ctx || !this.masterGain || this.isSfxMuted) return;
    const now = this.ctx.currentTime;
    const vol = Math.min(1.3, Math.max(0.3, speedPercent * 1.1));

    // Hard wood "THWACK-KNOCK"
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(460, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.07);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.9 * vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  /**
   * Foliage / branch brush sound when ball enters tree canopy
   */
  public playBranchDeflection() {
    this.initContext();
    if (!this.ctx || !this.masterGain || this.isSfxMuted) return;
    const now = this.ctx.currentTime;

    const bufferSize = Math.floor(this.ctx.sampleRate * 0.22);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(600, now + 0.18);
    filter.Q.value = 2.0;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.20);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.22);
  }

  public playWaterSplash() {
    this.initContext();
    if (!this.ctx || !this.masterGain || this.isSfxMuted) return;
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

  /**
   * Subtle tactile ratchet sound effect when adjusting shot aim arrow heading
   */
  public playAimTick() {
    this.initContext();
    if (!this.ctx || !this.masterGain || this.isSfxMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2400, now);
      filter.Q.setValueAtTime(4.2, now);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1750, now);
      osc.frequency.exponentialRampToValueAtTime(550, now + 0.024);

      gain.gain.setValueAtTime(0.048, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.024);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.026);
    } catch {
      // AudioContext not unlocked yet
    }
  }
}

export const soundFx = new GolfAudioEngine();
