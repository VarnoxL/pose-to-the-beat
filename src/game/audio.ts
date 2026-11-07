// Audio clock, beat schedule and music. Everything is timed to AudioContext.currentTime.
import { config } from "../config";
import type { BeatClock } from "../types";

export function loadLagSec(): number {
  try {
    const v = localStorage.getItem(config.lagOffsetStorageKey);
    if (v !== null && Number.isFinite(+v)) return +v / 1000;
  } catch { /* storage blocked: use default */ }
  return config.lagOffsetMsDefault / 1000;
}

export function saveLagMs(ms: number) {
  try { localStorage.setItem(config.lagOffsetStorageKey, String(Math.round(ms))); } catch { /* ignore */ }
}

/**
 * Beat times computed one at a time, just ahead of the audio clock. The bpm of a measure is
 * picked (via pickBpm) when its first beat is scheduled, so tier changes land on measure boundaries.
 */
export class BeatTrack {
  times: number[] = [];
  bpms: number[] = []; // bpm of the interval starting at beat i

  constructor(
    private start: number,
    private pickBpm: (beat: number) => number,
    private onBeat: (beat: number, time: number, bpm: number, bpmChanged: boolean) => void,
  ) {}

  extendTo(until: number) {
    while (!this.times.length || this.times[this.times.length - 1] <= until) {
      const b = this.times.length;
      const prevBpm = this.bpms[b - 1];
      const t = b === 0 ? this.start : this.times[b - 1] + 60 / prevBpm;
      const bpm = b % config.beatsPerMeasure === 0 ? this.pickBpm(b) : prevBpm;
      this.times.push(t);
      this.bpms.push(bpm);
      this.onBeat(b, t, bpm, bpm !== prevBpm);
    }
  }

  /** Beat clock at time t (before beat 0: beatIndex -1). */
  at(t: number): BeatClock {
    let i = this.times.length - 1;
    while (i >= 0 && this.times[i] > t) i--;
    const bpm = this.bpms[Math.max(i, 0)] ?? config.tempoTiers[0].bpm;
    const next = this.times[i + 1] ?? (i >= 0 ? this.times[i] + 60 / bpm : this.start);
    return { bpm, beatIndex: i, msToNextBeat: Math.max(0, (next - t) * 1000) };
  }
}

/** Songs per tempo tier (public/assets/audio/song_<bpm>.ogg), voice lines, and a click track fallback. */
export class Music {
  private songs = new Map<number, AudioBuffer>();
  private voices = new Map<string, AudioBuffer | null>();
  private source: AudioBufferSourceNode | null = null;
  private out: GainNode;

  constructor(private ctx: AudioContext) {
    this.out = ctx.createGain();
    this.out.gain.value = config.musicGain;
    this.out.connect(ctx.destination);
  }

  async load() {
    await Promise.all(config.tempoTiers.map(async ({ bpm }) => {
      const buf = await this.fetchBuffer(`assets/audio/song_${bpm}.ogg`);
      if (buf) this.songs.set(bpm, buf);
    }));
  }

  hasSong(bpm: number) { return this.songs.has(bpm); }

  /** Switch to the song for `bpm` at `when`, positioned as if it had been playing since beat 0. */
  playSong(bpm: number, when: number, beatIndex: number) {
    this.stop(when);
    const buf = this.songs.get(bpm);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.out);
    src.start(when, ((beatIndex * 60) / bpm) % buf.duration);
    this.source = src;
  }

  stop(when = this.ctx.currentTime) {
    try { this.source?.stop(when); } catch { /* already stopped */ }
    this.source = null;
  }

  /** Click track: used for the lag screen, and in rounds while a tier has no song yet. */
  click(when: number, accent: boolean) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(0.4, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    osc.connect(g).connect(this.out);
    osc.start(when);
    osc.stop(when + 0.06);
  }

  /** Sung line for a move (public/assets/audio/voice/<moveId>.ogg). Silently skipped if missing. */
  async voice(moveId: string, when: number) {
    if (!this.voices.has(moveId)) this.voices.set(moveId, await this.fetchBuffer(`assets/audio/voice/${moveId}.ogg`));
    const buf = this.voices.get(moveId);
    if (!buf || when < this.ctx.currentTime) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    src.start(when);
  }

  private async fetchBuffer(url: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
}
