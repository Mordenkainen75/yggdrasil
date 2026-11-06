// Every sound is synthesised, so there are no audio files to ship.
export class Sound {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private lastCrunch = 0;
  private lastTick = 0;
  muted = false;

  /** Browsers only allow audio after a user gesture, so this runs on first touch. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext();
      const noise = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.noise = noise;
    } catch {
      this.ctx = null;
    }
  }

  private burst(freq: number, seconds: number, volume: number): void {
    const { ctx, noise } = this;
    if (!ctx || !noise || this.muted) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.6 + Math.random() * 0.8;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + seconds);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(now, Math.random() * 0.2, seconds);
  }

  private tone(from: number, to: number, seconds: number, volume: number, type: OscillatorType): void {
    const { ctx } = this;
    if (!ctx || this.muted) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(to, now + seconds);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + seconds);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + seconds);
  }

  /** One drill hit: a tiny tick, so slow blocks still feel like work. */
  tick(): void {
    const now = performance.now();
    if (now - this.lastTick < 60) return;
    this.lastTick = now;
    this.burst(1800 + Math.random() * 700, 0.03, 0.025);
  }

  /** A block breaking: short and rounded, like popping bubble wrap. */
  pop(): void {
    const now = performance.now();
    if (now - this.lastCrunch < 50) return;
    this.lastCrunch = now;
    const pitch = 520 + Math.random() * 300;
    this.tone(pitch, pitch * 0.45, 0.07, 0.09, 'sine');
    this.burst(1100, 0.04, 0.05);
  }

  /** The collapse ring passing outward; pitch climbs as it spreads. */
  wave(progress: number): void {
    const pitch = 220 * 2 ** (progress * 2);
    this.tone(pitch, pitch * 0.7, 0.1, 0.07, 'triangle');
  }

  rank(): void {
    this.tone(330, 660, 0.25, 0.1, 'triangle');
    this.tone(495, 990, 0.35, 0.08, 'triangle');
  }

  gold(): void {
    this.tone(660 + Math.random() * 220, 1100, 0.12, 0.05, 'triangle');
  }

  blast(): void {
    this.burst(220, 0.3, 0.22);
    this.tone(140, 40, 0.3, 0.12, 'sine');
  }

  core(): void {
    this.burst(120, 0.4, 0.4);
    this.tone(180, 26, 1.2, 0.3, 'sine');
    this.tone(90, 22, 1.4, 0.2, 'sawtooth');
  }

  berserk(): void {
    // A war horn: two low, rough notes rising together.
    this.tone(110, 165, 0.5, 0.14, 'sawtooth');
    this.tone(165, 247, 0.5, 0.08, 'sawtooth');
  }

  buy(): void {
    this.tone(420, 620, 0.07, 0.04, 'square');
  }

  carve(): void {
    // A chisel tap, then the rune answering.
    this.burst(2400, 0.05, 0.1);
    this.tone(520, 780, 0.25, 0.06, 'triangle');
  }
}
