/**
 * Procedural sound for the city: rain, wind, traffic hum and helicopter rotors
 * as continuous beds, plus one-shot cues (thunder, sirens, power cuts, news).
 * Everything is synthesised with WebAudio, so there are no audio files.
 * The context starts on the first user gesture, as browsers require.
 */

export type Cue = 'thunder' | 'siren' | 'powerDown' | 'powerUp' | 'news' | 'notice' | 'horn';

export interface Ambience {
  /** 0..1 */
  rain: number;
  /** 0..1 */
  wind: number;
  /** City traffic and life, 0..1 (lower at night and in blackouts). */
  city: number;
  /** Helicopters in the air (0 = silent). */
  helicopters: number;
}

const MUTE_KEY = 'floodsim.muted';
const MASTER = 0.8;
const CUE_GAP_MS: Partial<Record<Cue, number>> = { siren: 9000, news: 2500, notice: 2500, powerDown: 1500, horn: 4000 };

const readMuted = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
};

interface Bed {
  gain: GainNode;
  level: number;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private beds: Partial<Record<'rain' | 'drops' | 'wind' | 'city' | 'heli', Bed>> = {};
  private lastCue = new Map<Cue, number>();
  private listeners = new Set<() => void>();
  muted = readMuted();

  get started(): boolean {
    return this.ctx !== null;
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (typeof window === 'undefined') return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER;
    this.master.connect(ctx.destination);
    this.noise = this.makeNoise(ctx);
    this.buildBeds(ctx);
    this.emit();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Ignore storage errors.
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : MASTER, this.ctx.currentTime, 0.08);
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Fade the continuous beds toward the city's current state. */
  setAmbience(a: Ambience): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const set = (bed: Bed | undefined, v: number, tau = 0.6) => {
      if (!bed || Math.abs(bed.level - v) < 0.002) return;
      bed.level = v;
      bed.gain.gain.setTargetAtTime(v, ctx.currentTime, tau);
    };
    set(this.beds.rain, 0.42 * Math.pow(a.rain, 0.8));
    set(this.beds.drops, 0.16 * Math.min(1, a.rain * 2));
    set(this.beds.wind, 0.3 * a.wind * a.wind + 0.03 * a.rain);
    set(this.beds.city, 0.06 * a.city);
    set(this.beds.heli, a.helicopters > 0 ? Math.min(0.2, 0.1 + 0.035 * a.helicopters) : 0, 1.2);
  }

  cue(name: Cue, power = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const now = performance.now();
    const gap = CUE_GAP_MS[name] ?? 0;
    if (gap && now - (this.lastCue.get(name) ?? -Infinity) < gap) return;
    this.lastCue.set(name, now);
    const t = ctx.currentTime + 0.02;
    switch (name) {
      case 'thunder':
        return this.thunder(ctx, t, power);
      case 'siren':
        return this.siren(ctx, t);
      case 'powerDown':
        return this.sweep(ctx, t, 140, 28, 0.9, 0.22);
      case 'powerUp':
        return this.sweep(ctx, t, 60, 220, 0.6, 0.1);
      case 'news':
        this.tone(ctx, t, 784, 0.16, 0.12);
        this.tone(ctx, t + 0.16, 1046, 0.16, 0.12);
        this.tone(ctx, t + 0.32, 1318, 0.32, 0.1);
        return;
      case 'notice':
        this.tone(ctx, t, 660, 0.12, 0.08);
        this.tone(ctx, t + 0.13, 880, 0.24, 0.07);
        return;
      case 'horn':
        this.tone(ctx, t, 220, 0.7, 0.07, 'sawtooth', 900);
        this.tone(ctx, t, 277, 0.7, 0.05, 'sawtooth', 900);
        return;
    }
  }

  // ---------- building blocks ----------

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 22695477;
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) | 0;
      data[i] = ((seed >>> 8) / 8388608 - 1) * 0.9;
    }
    return buf;
  }

  private noiseSource(ctx: AudioContext, loop = true, offset = 0): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = loop;
    src.start(ctx.currentTime, offset);
    return src;
  }

  private bed(ctx: AudioContext, input: AudioNode): Bed {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    input.connect(gain).connect(this.master as GainNode);
    return { gain, level: 0 };
  }

  private filter(ctx: AudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private buildBeds(ctx: AudioContext): void {
    // Rain: a wide hiss, plus a brighter band for drops on roofs and puddles.
    const rainHp = this.filter(ctx, 'highpass', 900);
    const rainLp = this.filter(ctx, 'lowpass', 7500);
    this.noiseSource(ctx, true, 0).connect(rainHp).connect(rainLp);
    this.beds.rain = this.bed(ctx, rainLp);

    const drops = this.filter(ctx, 'bandpass', 3200, 2.5);
    const flutter = ctx.createOscillator();
    const flutterDepth = ctx.createGain();
    flutter.frequency.value = 7.3;
    flutterDepth.gain.value = 900;
    flutter.connect(flutterDepth).connect(drops.frequency);
    flutter.start();
    this.noiseSource(ctx, true, 1.1).connect(drops);
    this.beds.drops = this.bed(ctx, drops);

    // Wind: low band whose centre drifts, so gusts swell and fade.
    const wind = this.filter(ctx, 'bandpass', 420, 0.9);
    const gust = ctx.createOscillator();
    const gustDepth = ctx.createGain();
    gust.frequency.value = 0.13;
    gustDepth.gain.value = 260;
    gust.connect(gustDepth).connect(wind.frequency);
    gust.start();
    this.noiseSource(ctx, true, 2.0).connect(wind);
    this.beds.wind = this.bed(ctx, wind);

    // City: distant traffic rumble.
    const city = this.filter(ctx, 'lowpass', 180, 0.5);
    this.noiseSource(ctx, true, 0.6).connect(city);
    this.beds.city = this.bed(ctx, city);

    // Helicopter: low noise chopped by a ~13 Hz rotor pulse.
    const rotor = this.filter(ctx, 'lowpass', 340, 1.2);
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    const blade = ctx.createOscillator();
    blade.type = 'square';
    blade.frequency.value = 12.8;
    const bladeDepth = ctx.createGain();
    bladeDepth.gain.value = 0.5;
    blade.connect(bladeDepth).connect(chop.gain);
    blade.start();
    this.noiseSource(ctx, true, 1.7).connect(rotor).connect(chop);
    this.beds.heli = this.bed(ctx, chop);
  }

  private envelope(ctx: AudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master as GainNode);
    return g;
  }

  private tone(ctx: AudioContext, t: number, freq: number, dur: number, peak: number, type: OscillatorType = 'sine', lowpass?: number): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const env = this.envelope(ctx, t, peak, 0.01, dur);
    if (lowpass) osc.connect(this.filter(ctx, 'lowpass', lowpass)).connect(env);
    else osc.connect(env);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private sweep(ctx: AudioContext, t: number, from: number, to: number, dur: number, peak: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    osc.connect(this.envelope(ctx, t, peak, 0.01, dur));
    osc.start(t);
    osc.stop(t + dur + 0.1);
    const click = this.noiseSource(ctx, false, 0.3);
    click.connect(this.filter(ctx, 'highpass', 2000)).connect(this.envelope(ctx, t, peak * 0.6, 0.002, 0.06));
    click.stop(t + 0.1);
  }

  private thunder(ctx: AudioContext, t: number, power: number): void {
    const crack = this.noiseSource(ctx, false, 0.2);
    crack.connect(this.filter(ctx, 'bandpass', 1800, 0.6)).connect(this.envelope(ctx, t, 0.25 * power, 0.005, 0.35));
    crack.stop(t + 0.5);
    const rumbleLen = 2.8 + 2 * power;
    const rumble = this.noiseSource(ctx, false, 0.9);
    const lp = this.filter(ctx, 'lowpass', 260, 0.8);
    lp.frequency.setValueAtTime(420, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + rumbleLen);
    rumble.connect(lp).connect(this.envelope(ctx, t + 0.05, 0.75 * power, 0.12, rumbleLen));
    rumble.stop(t + rumbleLen + 0.3);
  }

  private siren(ctx: AudioContext, t: number): void {
    // Two-tone hi-lo siren passing by: rises in, falls away.
    const dur = 4.2;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 1.6;
    const depth = ctx.createGain();
    depth.gain.value = 110;
    osc.frequency.setValueAtTime(760, t);
    osc.frequency.linearRampToValueAtTime(690, t + dur);
    lfo.connect(depth).connect(osc.frequency);
    const lp = this.filter(ctx, 'lowpass', 1600);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 1.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(lp).connect(g).connect(this.master as GainNode);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.1);
    lfo.stop(t + dur + 0.1);
  }
}

export const sound = new SoundEngine();
