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

type VoiceClip = { buf: AudioBuffer; start: number; end: number };

/** Where the voice starts and ends in a recording: first/last sample above a fraction of the peak. */
function voiceClip(buf: AudioBuffer): VoiceClip {
  const d = buf.getChannelData(0);
  let peak = 0;
  for (const v of d) peak = Math.max(peak, Math.abs(v));
  const th = peak * config.voiceOnsetThreshold;
  let s = 0, e = d.length - 1;
  while (s < e && Math.abs(d[s]) < th) s++;
  while (e > s && Math.abs(d[e]) < th) e--;
  return { buf, start: Math.max(0, s / buf.sampleRate - config.voicePreRollSec), end: e / buf.sampleRate };
}

/** Songs per tempo tier (public/assets/audio/song_<bpm>.ogg), voice lines, and a click track fallback. */
export class Music {
  private songs = new Map<number, AudioBuffer>();
  private voices = new Map<string, Promise<VoiceClip | null>>();
  private title: AudioBuffer | null = null;
  private titlePlaying = false;
  private game: AudioBuffer | null = null; // the round song, used for every tier without its own song_<bpm>.ogg
  private source: AudioBufferSourceNode | null = null;
  /** Where the round song is: started at `when` from buffer time `offset`, playing at `rate`. */
  private roundSong: { when: number; offset: number; rate: number } | null = null;
  private out: GainNode;
  private songOut: GainNode;
  private voiceOut: GainNode;
  private trapVoiceOut: GainNode; // the decoy voice on trap moves (voice/trap/*): make-up gain at the end of its chain
  private trapVoiceIn: AudioNode; // start of the decoy chain (EQ + compressor)

  constructor(private ctx: AudioContext) {
    this.out = ctx.createGain();
    this.out.gain.value = config.musicGain;
    this.out.connect(ctx.destination);
    this.songOut = ctx.createGain();
    this.songOut.gain.value = config.roundMusicGain;
    this.songOut.connect(ctx.destination);
    this.voiceOut = ctx.createGain();
    this.voiceOut.gain.value = config.voiceGain;
    this.voiceOut.connect(ctx.destination);
    // Decoy voice chain: cut low rumble → lift speech presence → compress the peaks → make-up gain.
    // The compressor is what lets trapVoiceGain go above 1 without the loud syllables clipping.
    const fx = config.trapVoiceFx;
    const highpass = new BiquadFilterNode(ctx, { type: "highpass", frequency: fx.highpassHz });
    const presence = new BiquadFilterNode(ctx, { type: "peaking", frequency: fx.presenceHz, Q: 1, gain: fx.presenceDb });
    const comp = new DynamicsCompressorNode(ctx, { threshold: fx.compThresholdDb, ratio: fx.compRatio, knee: 6, attack: 0.003, release: 0.15 });
    this.trapVoiceOut = ctx.createGain();
    this.trapVoiceOut.gain.value = config.trapVoiceGain;
    highpass.connect(presence).connect(comp).connect(this.trapVoiceOut).connect(ctx.destination);
    this.trapVoiceIn = highpass;
  }

  /** Dip the round song while a voice line speaks (from `when` for `sec`), so the call cuts through. */
  private duckSong(when: number, sec: number) {
    const g = this.songOut.gain, full = config.roundMusicGain, low = full * config.voiceDuck.musicLevel, f = config.voiceDuck.fadeSec;
    g.cancelScheduledValues(Math.max(this.ctx.currentTime, when - f));
    g.setValueAtTime(full, Math.max(this.ctx.currentTime, when - f));
    g.linearRampToValueAtTime(low, when);
    g.setValueAtTime(low, when + sec);
    g.linearRampToValueAtTime(full, when + sec + f);
  }

  async load() {
    await Promise.all([
      ...config.tempoTiers.map(async ({ bpm }) => {
        const buf = await this.fetchBuffer(`assets/audio/song_${bpm}.ogg`);
        if (buf) this.songs.set(bpm, buf);
      }),
      this.fetchBuffer("assets/audio/title.mp3").then((buf) => void (this.title = buf)),
      this.fetchBuffer("assets/audio/game.mp3").then((buf) => void (this.game = buf)),
    ]);
  }

  /** Loop the welcome-screen music. Does nothing if it's already playing or hasn't loaded yet. */
  playTitle() {
    if (this.titlePlaying || !this.title) return;
    this.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = this.title;
    src.loop = true;
    src.connect(this.out);
    src.start();
    this.source = src;
    this.titlePlaying = true;
  }

  hasSong(bpm: number) { return this.songs.has(bpm) || !!this.game; }

  /**
   * Switch to the song for `bpm` at `when`. A per-tier song_<bpm>.ogg wins, positioned as if it had
   * been playing since beat 0. Otherwise the one round song is sped up/slowed down (playbackRate, so
   * pitch follows) so its beats land on ours: one song beat per game beat, or two (half-time) when
   * that keeps the speed closer to normal. On a tempo change it carries on from where it was.
   */
  playSong(bpm: number, when: number, beatIndex: number) {
    const prev = this.roundSong;
    this.stop(when);
    const tierSong = this.songs.get(bpm);
    const buf = tierSong ?? this.game;
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.songOut);
    if (tierSong) {
      src.start(when, ((beatIndex * 60) / bpm) % buf.duration);
    } else {
      const { bpm: songBpm, firstBeatSec } = config.gameSong;
      const perBeat = [1, 2].reduce((a, b) => (Math.abs(Math.log((bpm * b) / songBpm)) < Math.abs(Math.log((bpm * a) / songBpm)) ? b : a));
      const rate = (bpm * perBeat) / songBpm;
      const offset = prev ? prev.offset + (when - prev.when) * prev.rate : firstBeatSec + (beatIndex * perBeat * 60) / songBpm;
      src.playbackRate.value = rate;
      src.start(when, offset % buf.duration);
      this.roundSong = { when, offset, rate };
    }
    this.source = src;
  }

  stop(when = this.ctx.currentTime) {
    try { this.source?.stop(when); } catch { /* already stopped */ }
    this.source = null;
    this.titlePlaying = false;
    this.roundSong = null;
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

  /** Fetch and decode voice clips ahead of time, so the first call of each isn't late. */
  preloadVoices(ids: string[]) {
    for (const id of ids) {
      if (this.voices.has(id)) continue;
      this.voices.set(id, this.fetchBuffer(`assets/audio/voice/${id}.m4a`).then((buf) => buf && voiceClip(buf)));
    }
  }

  /** A move's sung line (<moveId>), with its leading silence cut so the voice itself lands on `when`. Skipped if missing. */
  async voice(id: string, when: number) {
    this.preloadVoices([id]);
    const clip = await this.voices.get(id);
    if (!clip || when < this.ctx.currentTime) return;
    const src = this.ctx.createBufferSource();
    src.buffer = clip.buf;
    src.connect(id.startsWith("trap/") ? this.trapVoiceIn : this.voiceOut);
    this.duckSong(when, clip.end - clip.start);
    src.start(when, clip.start);
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
