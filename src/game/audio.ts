/** Minimal procedural audio for VANTA. No external samples. */

type Ctx = AudioContext;

export class AudioEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambientOn = false;
  muted = false;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.16;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 2.2);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = last * 0.97 + white * 0.03;
        data[i] = last * 3.2;
      }
      this.noiseBuffer = buf;
    } catch {
      this.ctx = null;
    }
  }

  setMuted(value: boolean) {
    this.muted = value;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(value ? 0 : 0.16, this.ctx.currentTime, 0.08);
    }
  }

  startAmbient() {
    this.unlock();
    if (!this.ctx || !this.master || this.ambientOn) return;
    this.ambientOn = true;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Two very low, slightly detuned drones.
    [41.5, 62.3, 83.4].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 2 ? "sine" : "triangle";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.value = i === 2 ? 0.055 : 0.14;
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 180 + i * 40;
      osc.connect(filt);
      filt.connect(gain);
      gain.connect(this.master!);
      osc.start(now);

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.035 + i * 0.017;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.045;
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);
      lfo.start(now);
    });

    // Filtered air / dripping cave wash.
    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 520;
      const gain = ctx.createGain();
      gain.gain.value = 0.055;
      src.connect(filt);
      filt.connect(gain);
      gain.connect(this.master);
      src.start(now);
    }
  }

  private blip(
    freq: number,
    endFreq: number,
    duration: number,
    volume: number,
    type: OscillatorType = "sine",
    delay = 0,
  ) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.03);
  }

  private noiseBurst(duration: number, volume: number, frequency: number, type: BiquadFilterType = "highpass") {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filt);
    filt.connect(gain);
    gain.connect(this.master);
    src.start(t);
    src.stop(t + duration);
  }

  scan() {
    this.blip(1680, 380, 0.34, 0.1, "sine");
    this.blip(880, 220, 0.5, 0.05, "triangle", 0.04);
    this.noiseBurst(0.16, 0.035, 1800);
  }

  pickup() {
    this.blip(523, 523, 0.22, 0.08, "sine");
    this.blip(784, 784, 0.38, 0.07, "sine", 0.14);
    this.blip(1174, 1046, 0.5, 0.04, "triangle", 0.28);
  }

  interactDenied() {
    this.blip(140, 84, 0.18, 0.07, "square");
  }

  doorOpen() {
    this.blip(70, 210, 1.4, 0.07, "sawtooth");
    this.noiseBurst(1.1, 0.045, 320, "lowpass");
  }

  step(water = false) {
    if (water) {
      this.noiseBurst(0.11, 0.025, 900);
      this.blip(240, 120, 0.08, 0.015, "sine");
    } else {
      this.noiseBurst(0.055, 0.018, 1600);
    }
  }

  heartbeat(intensity: number) {
    const v = 0.025 + intensity * 0.1;
    this.blip(61, 42, 0.16, v, "sine");
    this.blip(55, 38, 0.2, v * 0.8, "sine", 0.19);
  }

  whisper() {
    this.noiseBurst(0.9, 0.05, 700, "bandpass");
    this.blip(190, 96, 1.1, 0.026, "sawtooth");
  }

  death() {
    if (!this.ctx || !this.master) return;
    this.noiseBurst(1.3, 0.2, 560, "lowpass");
    this.blip(320, 28, 1.7, 0.16, "sawtooth");
    this.blip(1800, 140, 0.8, 0.07, "square", 0.05);
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 29;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.16, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.2);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 2.3);
  }

  win() {
    this.blip(261, 261, 0.6, 0.05, "sine");
    this.blip(392, 392, 0.9, 0.05, "sine", 0.22);
    this.blip(523, 523, 1.4, 0.05, "sine", 0.46);
    this.noiseBurst(1.4, 0.03, 900);
  }

  dispose() {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.master = null;
      this.ambientOn = false;
    }
  }
}
