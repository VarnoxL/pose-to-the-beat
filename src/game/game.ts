// Game track: screens, round loop, drawing, HUD and the hidden lag screen.
// All timing comes from the AudioContext clock.
import { config } from "../config";
import { JOINTS, type GameEvent, type Joint, type Move, type PlayerFrame } from "../types";
import { BeatTrack, Music, loadLagSec, saveLagMs } from "./audio";
import { REST_POSE, drawSkeleton, mirrored, poseToLandmarks, type Rect } from "./pose";
import type { Scoring } from "./scoringApi";
import { frameError } from "../scoring";

type Screen = "title" | "round" | "eliminated" | "champion" | "challenger" | "lag";
/** `best` is for the D debug readout: each player's lowest error within ±1 s of the beat, and when it happened. */
type Pending = { move: Move; previewTime: number; scored: boolean; best: ({ err: number; dt: number } | null)[] };
type Popup = { player: 0 | 1 | null; text: string; color: string; time: number };
export type Upcoming = { move: Move; beatTime: number } | null;

const COLORS = ["#2de2e6", "#ff3cac"] as const;
export type Mode = "duo" | "bot"; // duo = 1v1 humans (main mode); bot = one human (left) vs a bot (right)
const GOLD = "#ffd23f";
const RED = "#ff5555";
const IDS = [0, 1] as const;

export function createGame(canvas: HTMLCanvasElement, scoring: Scoring, opts: { onNewChallenger?: (side: 0 | 1, mode: Mode) => void; spaceMode?: Mode } = {}) {
  const spaceMode = opts.spaceMode ?? "duo"; // what SPACE starts on the title (?bot makes it "bot")
  const ctx = canvas.getContext("2d")!;
  const audio = new AudioContext();
  const music = new Music(audio);
  void music.load();
  let lagSec = loadLagSec();
  /** Audio-clock seconds minus lag: the clock PlayerFrame.t uses. */
  const now = () => audio.currentTime - lagSec;
  const resume = () => void audio.resume();
  addEventListener("pointerdown", resume);

  let screen: Screen = "title";
  let mode: Mode = "duo";
  let status = ""; // shown on the title screen (camera errors etc.)
  const NAMES = () => (mode === "bot" ? ["YOU", "BOT"] : ["P1", "P2"]);
  const verb = (id: number, they: string, you: string) => (mode === "bot" && id === 0 ? you : they);
  let screenUntil = 0;
  let champion: 0 | 1 | null = null;
  let crownKept = false;
  let video: HTMLVideoElement | null = null;
  const latest: (PlayerFrame | null)[] = [null, null];
  let debug = false; // key D
  const fps = [0, 0], fpsCount = [0, 0];
  let fpsAt = 0;

  // Round state
  let track: BeatTrack | null = null;
  let roundEnd = 0;
  let pending: Pending[] = [];
  let popups: Popup[] = [];
  let out: [boolean, boolean] = [false, false];
  let endReason: "out" | "time" = "time";
  let winner: 0 | 1 = 0;
  const charPose: Record<Joint, number> = { ...REST_POSE };
  let lastFrameTime = 0;

  // Hidden lag screen
  let lagReturn: Screen = "title";
  let lagBeats: number[] = [];
  let lagCam: number[] = [];
  let lagTap: number[] = [];
  let lagDone = false;
  let lagResult = "";
  const raised = [false, false];

  // ---------- Round ----------

  const isMoveBeat = (b: number) => b >= config.leadInBeats && (b - config.leadInBeats) % config.beatsPerMove === 0;

  async function startRound() {
    await audio.resume();
    scoring.reset(champion);
    pending = [];
    popups = [];
    out = [false, false];
    Object.assign(charPose, REST_POSE);
    const t0 = audio.currentTime + config.startDelaySec;
    roundEnd = t0 + config.roundSeconds;
    track = new BeatTrack(t0, () => scoring.tempoBpm(), onBeat);
    screen = "round";
  }

  function onBeat(b: number, t: number, bpm: number, changed: boolean) {
    if (changed) music.playSong(bpm, t, b); // stops the old song; plays nothing if this tier has no song yet
    if (!music.hasSong(bpm)) music.click(t, b % config.beatsPerMeasure === 0);
    const mb = b + config.previewBeats;
    if (isMoveBeat(mb) && t < roundEnd) {
      const move = scoring.nextMove(mb);
      pending.push({ move, previewTime: t, scored: false, best: [null, null] });
      if (move.cue === "sing") void music.voice(move.id, t);
    }
  }

  function updateRound() {
    track!.extendTo(audio.currentTime + config.scheduleAheadSec);
    const n = now();
    for (const p of pending) {
      if (p.scored) continue;
      const bt = track!.times[p.move.beat];
      if (bt === undefined || n <= bt + config.scoreWindowMs / 1000) continue;
      p.scored = true;
      if (p.move.cue === "trap") popup(null, "NO SONG = DON'T MOVE", GOLD);
      handleEvents(scoring.scoreMove(p.move, bt));
      if (screen !== "round") return;
    }
    if (audio.currentTime >= roundEnd) endRound("time", null);
  }

  function popup(player: 0 | 1 | null, text: string, color: string) {
    popups.push({ player, text, color, time: audio.currentTime });
  }

  function handleEvents(events: GameEvent[]) {
    let champ: 0 | 1 | null = null;
    for (const e of events) {
      if (e.type === "hit") popup(e.player, e.grade === "perfect" ? "PERFECT" : "GOOD", e.grade === "perfect" ? GOLD : "#7cfc00");
      else if (e.type === "miss") popup(e.player, "MISS", RED);
      else if (e.type === "trapFail") popup(e.player, "TRAPPED!", RED);
      else if (e.type === "eliminated") out[e.player] = true;
      else if (e.type === "champion") champ = e.player;
    }
    if (out[0] || out[1] || champ !== null) endRound("out", champ);
  }

  function endRound(reason: "out" | "time", champ: 0 | 1 | null) {
    const st = scoring.state;
    if (champ !== null) winner = champ;
    else if (out[0] !== out[1]) winner = out[0] ? 1 : 0;
    else if (st[0].score !== st[1].score) winner = st[0].score > st[1].score ? 0 : 1;
    else winner = champion ?? 0; // tie: the champion keeps the crown (first round: P1)
    endReason = reason;
    music.stop();
    screen = "eliminated";
    screenUntil = audio.currentTime + config.eliminatedScreenSec;
  }

  function updateScreens() {
    if (audio.currentTime < screenUntil) return;
    if (screen === "eliminated") {
      crownKept = champion === winner;
      champion = winner;
      screen = "champion";
      screenUntil = audio.currentTime + config.championScreenSec;
    } else if (screen === "champion") {
      screen = "challenger";
      opts.onNewChallenger?.((1 - winner) as 0 | 1, mode);
    }
  }

  /** The move the character is showing now (most recent preview), with its beat time. */
  function shownMove(): { p: Pending; beatTime: number } | null {
    if (!track) return null;
    let p: Pending | undefined;
    for (const q of pending) if (q.previewTime <= audio.currentTime) p = q;
    if (!p) return null;
    const bpm = track.at(audio.currentTime).bpm;
    return { p, beatTime: track.times[p.move.beat] ?? p.previewTime + (config.previewBeats * 60) / bpm };
  }

  // ---------- Lag calibration (hidden, key L) ----------

  async function startLag() {
    await audio.resume();
    if (screen !== "lag") lagReturn = screen;
    music.stop();
    screen = "lag";
    lagBeats = [];
    lagCam = [];
    lagTap = [];
    lagDone = false;
    lagResult = "";
    const spb = 60 / config.lagCalibrationBpm;
    const t0 = audio.currentTime + 1;
    const countIn = config.beatsPerMeasure;
    for (let i = 0; i < countIn + config.lagCalibrationBeats; i++) {
      const t = t0 + i * spb;
      music.click(t, i < countIn);
      if (i >= countIn) lagBeats.push(t);
    }
  }

  /** `raw` = audio time the action actually happened (no lag correction). */
  function lagSample(raw: number, into: number[]) {
    if (lagDone || !lagBeats.length) return;
    const spb = 60 / config.lagCalibrationBpm;
    const nearest = lagBeats.reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a));
    if (Math.abs(raw - nearest) < spb / 2) into.push(raw - nearest);
  }

  function updateLag() {
    if (lagDone || !lagBeats.length) return;
    if (audio.currentTime < lagBeats[lagBeats.length - 1] + 60 / config.lagCalibrationBpm) return;
    lagDone = true;
    const samples = lagCam.length >= config.lagCalibrationMinSamples ? lagCam : lagTap;
    const source = samples === lagCam ? "camera" : "SPACE taps";
    if (samples.length < config.lagCalibrationMinSamples) {
      lagResult = `Only ${samples.length} samples. Press SPACE to retry.`;
      return;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const ms = sorted[Math.floor(sorted.length / 2)] * 1000;
    saveLagMs(ms);
    lagSec = ms / 1000;
    lagResult = `Saved ${Math.round(ms)} ms (median of ${samples.length}, from ${source}). SPACE to redo, ESC to leave.`;
  }

  // ---------- Input ----------

  addEventListener("keydown", (e) => {
    resume();
    if (e.repeat) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (screen === "title") {
        mode = spaceMode;
        champion = null;
      }
      if (screen === "title" || screen === "challenger") void startRound();
      else if (screen === "lag") lagDone ? void startLag() : lagSample(audio.currentTime, lagTap);
    } else if (e.code === "KeyB" && screen === "title") {
      mode = "bot";
      champion = null;
      void startRound();
    } else if (e.code === "KeyD") {
      debug = !debug;
    } else if (e.code === "KeyL" && (screen === "title" || screen === "challenger")) {
      void startLag();
    } else if (e.code === "Escape") {
      music.stop();
      if (screen !== "lag") champion = null; // back to the menu: fresh crown
      screen = screen === "lag" ? lagReturn : "title";
    }
  });

  function onFrame(f: PlayerFrame) {
    latest[f.id] = f;
    scoring.addFrame(f);
    fpsCount[f.id]++;
    if (debug && track) {
      for (const p of pending) {
        const bt = track.times[p.move.beat];
        if (bt === undefined || Math.abs(f.t - bt) > 1) continue;
        const err = frameError(f, p.move.target);
        const b = p.best[f.id];
        if (err !== null && (!b || err < b.err)) p.best[f.id] = { err, dt: f.t - bt };
      }
    }
    if (screen === "lag") {
      const lm = f.landmarks;
      const up = lm[15].y < lm[0].y || lm[16].y < lm[0].y; // a wrist above the nose
      if (up && !raised[f.id]) lagSample(f.t + lagSec, lagCam);
      raised[f.id] = up;
    }
  }

  // ---------- Drawing ----------

  function text(s: string, x: number, y: number, size: number, color = "#eee", align: CanvasTextAlign = "center") {
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(3, size / 8);
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    const maxW = canvas.width * 0.94;
    ctx.strokeText(s, x, y, maxW);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y, maxW);
  }

  function cameraRect(W: number, H: number): Rect {
    if (!video || !video.videoWidth) return { x: 0, y: 0, w: W, h: H };
    const s = Math.max(W / video.videoWidth, H / video.videoHeight); // cover
    const w = video.videoWidth * s, h = video.videoHeight * s;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  function drawStage(W: number, H: number, inRound: boolean) {
    const cam = cameraRect(W, H);
    const n = now();
    mirrored(ctx, () => {
      if (video && video.readyState >= 2) {
        ctx.drawImage(video, cam.x, cam.y, cam.w, cam.h);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, W, H);
      }
      for (const id of IDS) {
        const f = latest[id];
        if (!f || n - f.t > config.playerGoneSec) continue;
        drawSkeleton(ctx, f.landmarks, cam, inRound && out[id] ? "#555" : COLORS[id], Math.max(4, H / 120));
      }
    });
    if (inRound) {
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      ctx.beginPath();
      ctx.moveTo(W / 2, 0);
      ctx.lineTo(W / 2, H);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawCharacter(W: number, H: number, dt: number) {
    const shown = shownMove();
    const goal = shown ? shown.p.move.target : REST_POSE;
    const k = 1 - Math.exp(-dt * config.characterPoseLerp);
    for (const j of JOINTS) charPose[j] += (goal[j] - charPose[j]) * k;

    const h = H * 0.5, w = h * 0.8;
    const rect: Rect = { x: (W - w) / 2, y: H * 0.12, w, h };
    const cx = W / 2, cy = rect.y + h * 0.55;

    // Stage disc
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.ellipse(cx, rect.y + h * 0.92, w * 0.45, h * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();

    // Timing ring: shrinks onto the character as the scored beat arrives
    if (shown && track) {
      const spb = 60 / track.at(audio.currentTime).bpm;
      const until = shown.beatTime - audio.currentTime;
      const r0 = h * 0.42;
      if (until > 0) {
        ctx.strokeStyle = shown.p.move.cue === "sing" ? "rgba(255,210,63,0.8)" : "rgba(255,255,255,0.35)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, r0 * (1 + 1.5 * Math.min(1, until / (config.previewBeats * spb))), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Beat count under the character: 1 · 2 · 3 · POSE!
    if (shown && track) {
      const spb = 60 / track.at(audio.currentTime).bpm;
      const until = shown.beatTime - audio.currentTime;
      const left = Math.round(until / spb);
      if (left >= 1) text(String(config.previewBeats - left + 1), cx, rect.y + h + H * 0.05, Math.round(H / 16), "#fff");
      else if (until > -spb / 2) text("POSE!", cx, rect.y + h + H * 0.05, Math.round(H / 14), GOLD);
    }

    const lm = poseToLandmarks(charPose, 0.5, 0.62, 0.7, w / h);
    mirrored(ctx, () => drawSkeleton(ctx, lm, rect, "#fff", Math.max(6, H / 70)));

    // Sung line: bubble with the move's name. A trap shows the move with no bubble (no singing).
    if (shown && shown.p.move.cue === "sing" && audio.currentTime < shown.beatTime + 0.3) {
      const label = `♪ ${shown.p.move.id.replace(/_/g, " ").toUpperCase()} ♪`;
      text(label, cx, rect.y - H * 0.02, Math.round(H / 18), GOLD);
    }
  }

  function drawHud(W: number, H: number) {
    const st = scoring.state;
    const size = Math.round(H / 22);
    for (const id of IDS) {
      const s = st[id];
      const x = id === 0 ? W * 0.18 : W * 0.82;
      const name = `${NAMES()[id]}${champion === id ? " 👑" : ""}`;
      text(name, x, H * 0.05, size, COLORS[id]);
      text(String(s.score), x, H * 0.11, size * 1.4);
      text(s.combo > 1 ? `x${s.combo} combo` : "", x, H * 0.17, size * 0.7, "#ccc");
      let hearts = "";
      for (let i = 0; i < config.startingLives; i++) hearts += i < s.lives ? "♥" : "♡";
      text(hearts, x, H * 0.22, size, RED);
      // Flow bar
      const bw = W * 0.2, bh = H * 0.018, bx = x - bw / 2, by = H * 0.26;
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = COLORS[id];
      ctx.fillRect(bx, by, bw * Math.max(0, Math.min(1, s.flow)), bh);
      text("FLOW", bx - 8, by + bh / 2, size * 0.45, "#aaa", "right");
      if (out[id]) text("OUT", x, H * 0.55, size * 2.2, RED);
    }

    // Timer, tempo, beat pulse
    if (track) {
      const left = Math.max(0, roundEnd - audio.currentTime);
      text(`0:${String(Math.ceil(left)).padStart(2, "0")}`, W / 2, H * 0.04, size);
      const bc = track.at(audio.currentTime);
      text(`${bc.bpm} BPM`, W / 2 + size * 3, H * 0.04, size * 0.5, "#aaa", "left");
      const phase = bc.beatIndex < 0 ? 0 : bc.msToNextBeat / 1000 / (60 / bc.bpm); // 1 at the beat, 0 just before the next
      ctx.fillStyle = bc.beatIndex % config.beatsPerMeasure === 0 ? GOLD : "#fff";
      ctx.globalAlpha = 0.3 + 0.7 * phase;
      ctx.beginPath();
      ctx.arc(W / 2 - size * 3, H * 0.04, (size / 3) * (0.6 + 0.4 * phase), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (bc.beatIndex < config.leadInBeats - config.previewBeats) {
        text(bc.beatIndex < 0 ? "GET READY" : String(config.leadInBeats - config.previewBeats - bc.beatIndex), W / 2, H * 0.72, size * 1.6, GOLD);
      }
    }

    // Grade popups
    popups = popups.filter((p) => audio.currentTime - p.time < config.popupSec);
    for (const p of popups) {
      const age = (audio.currentTime - p.time) / config.popupSec;
      const x = p.player === null ? W / 2 : p.player === 0 ? W * 0.25 : W * 0.75;
      const y = (p.player === null ? H * 0.72 : H * 0.45) - age * H * 0.06;
      ctx.globalAlpha = 1 - age * age;
      text(p.text, x, y, size * (p.player === null ? 1 : 1.6), p.color);
      ctx.globalAlpha = 1;
    }
  }

  function drawOverlay(lines: [string, number, string?][], W: number, H: number) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);
    const total = lines.reduce((s, [, k]) => s + k * 1.5, 0) * (H / 20);
    let y = H / 2 - total / 2;
    for (const [s, k, c] of lines) {
      const size = (H / 20) * k;
      y += (size * 1.5) / 2;
      text(s, W / 2, y, size, c);
      y += (size * 1.5) / 2;
    }
  }

  function draw() {
    if (canvas.width !== innerWidth || canvas.height !== innerHeight) {
      canvas.width = innerWidth;
      canvas.height = innerHeight;
    }
    const W = canvas.width, H = canvas.height;
    const t = audio.currentTime;
    const dt = Math.min(0.1, Math.max(0, t - lastFrameTime));
    lastFrameTime = t;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, W, H);

    const inRound = screen === "round" || screen === "eliminated";
    drawStage(W, H, inRound);
    if (inRound) {
      drawCharacter(W, H, dt);
      drawHud(W, H);
    }

    const st = scoring.state;
    const scores = `${NAMES()[0]} ${st[0].score}  —  ${NAMES()[1]} ${st[1].score}`;
    if (screen === "title") {
      drawOverlay([
        ["POSE TO THE BEAT", 2.4, GOLD],
        ["Keep the flow. Don't break the beat.", 0.9, "#ccc"],
        ["", 0.5],
        ["Copy the move when the character SINGS it.", 0.8],
        ["No song? Don't move. That's a trap.", 0.8, RED],
        ["", 0.5],
        spaceMode === "bot" ? ["SPACE or B  ·  you vs the bot", 1.1, "#fff"] : ["SPACE  ·  1v1, two players side by side", 1.1, "#fff"],
        spaceMode === "bot" ? ["", 0.9] : ["B  ·  you vs the bot (stand on the left)", 0.9, "#ccc"],
        ["D  ·  debug readout   ·   L  ·  lag calibration", 0.6, "#888"],
        [status, 0.6, RED],
      ], W, H);
    } else if (screen === "eliminated") {
      const head = endReason === "time" ? "TIME!" : out[0] && out[1] ? "BOTH OUT" : `${NAMES()[out[0] ? 0 : 1]} ${verb(out[0] ? 0 : 1, "IS", "ARE")} OUT`;
      drawOverlay([[head, 2.4, endReason === "time" ? GOLD : RED], [scores, 1]], W, H);
    } else if (screen === "champion") {
      drawOverlay([
        [`${NAMES()[winner]} ${crownKept ? verb(winner, "KEEPS", "KEEP") : verb(winner, "TAKES", "TAKE")} THE CROWN`, 2, COLORS[winner]],
        ["👑", 3],
        [scores, 1],
      ], W, H);
    } else if (screen === "challenger" && mode === "bot") {
      drawOverlay([
        ["REMATCH?", 2.2, GOLD],
        [winner === 1 ? "The bot keeps the crown. Take it back!" : "A new bot steps up.", 1, COLORS[1]],
        ["", 0.5],
        ["SPACE to play  ·  ESC for menu", 1.1],
      ], W, H);
    } else if (screen === "challenger") {
      const side = winner === 0 ? "RIGHT" : "LEFT";
      drawOverlay([
        ["NEW CHALLENGER!", 2.2, GOLD],
        [`${NAMES()[1 - winner]}: step into the ${side} side`, 1, COLORS[1 - winner]],
        [`${NAMES()[winner]} (champion) stays put`, 0.8, COLORS[winner]],
        ["", 0.5],
        ["Press SPACE when ready", 1.2],
      ], W, H);
    } else if (screen === "lag") {
      const beatsLeft = lagBeats.filter((b) => b > t).length;
      drawOverlay([
        ["LAG CALIBRATION", 1.6, GOLD],
        ["Raise an arm above your head on every click (or tap SPACE on it).", 0.8],
        [lagDone ? lagResult : beatsLeft === lagBeats.length ? "Count-in..." : `${beatsLeft} clicks left`, 0.9, lagDone ? GOLD : "#fff"],
        [`camera ${lagCam.length} · taps ${lagTap.length} · current offset ${Math.round(lagSec * 1000)} ms`, 0.6, "#aaa"],
        ["ESC to leave", 0.6, "#888"],
      ], W, H);
    }
  }

  /** Per-player "step back" hint, and the D debug readout. Drawn on top of everything. */
  function drawHints(W: number, H: number) {
    const t = audio.currentTime, n = now();
    if (t - fpsAt >= 1) {
      for (const id of IDS) (fps[id] = fpsCount[id] / Math.max(1e-3, t - fpsAt)), (fpsCount[id] = 0);
      fpsAt = t;
    }
    if (screen !== "title" && screen !== "round") return;
    const shown = shownMove();
    const size = Math.round(H / 40);
    for (const id of IDS) {
      if (mode === "bot" && id === 1) continue; // the bot is always in view
      const f = latest[id];
      const x = id === 0 ? W * 0.25 : W * 0.75;
      const fresh = f && n - f.t <= config.playerGoneSec;
      // frameError is null when too few joints are usable: the scorer can't see enough of this player.
      if (fresh && frameError(f, REST_POSE) === null) text("STEP BACK: show both arms and your hips", x, H * 0.9, size, GOLD);
      if (!debug) continue;
      const lines = [`P${id + 1}  ${fps[id].toFixed(0)} frames/s  ${fresh ? "" : "NOT SEEN"}`];
      if (fresh && shown) {
        const e = frameError(f, shown.p.move.target);
        lines.push(`now vs ${shown.p.move.id}: ${e === null ? "too few joints" : `${e.toFixed(0)}°`}`);
      }
      // Last move whose beat has passed: best error within ±1 s and its offset from the beat.
      const last = [...pending].reverse().find((p) => (track?.times[p.move.beat] ?? Infinity) < n);
      const b = last?.best[id];
      if (last) lines.push(b ? `last ${last.move.id}: best ${b.err.toFixed(0)}° at ${b.dt >= 0 ? "+" : ""}${Math.round(b.dt * 1000)} ms (window ±${config.scoreWindowMs})` : `last ${last.move.id}: no usable frame`);
      lines.forEach((s, i) => text(s, x, H * 0.62 + i * size * 1.3, size * 0.8, "#9ef"));
    }
    if (debug) text(`lag offset ${Math.round(lagSec * 1000)} ms · good ≤ ${config.goodMaxErrorDeg}° · perfect ≤ ${config.perfectMaxErrorDeg}° · D to hide`, W / 2, H * 0.97, size * 0.7, "#9ef");
  }

  function loop() {
    requestAnimationFrame(loop);
    if (screen === "round") updateRound();
    else if (screen === "eliminated" || screen === "champion") updateScreens();
    else if (screen === "lag") updateLag();
    draw();
    drawHints(canvas.width, canvas.height);
  }
  loop();

  return {
    now,
    onFrame,
    setVideo: (v: HTMLVideoElement) => void (video = v),
    setStatus: (s: string) => void (status = s),
    get mode() { return mode; },
    /** The next unscored move the character is showing, for fake/bot players. */
    upcoming(): Upcoming {
      if (screen !== "round") return null;
      const shown = shownMove();
      return shown && !shown.p.scored ? { move: shown.p.move, beatTime: shown.beatTime } : null;
    },
  };
}
