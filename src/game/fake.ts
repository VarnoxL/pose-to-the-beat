// MOCK DATA ONLY: fake players and a stand-in scoring so a full round plays before the
// vision and scoring tracks are merged. Replace in main.ts; delete once the real pieces land.
import { config } from "../config";
import { JOINTS, type GameEvent, type Joint, type Move, type MoveDef, type PlayerFrame, type PlayerState } from "../types";
import type { Upcoming } from "./game";
import { REST_POSE, poseToLandmarks } from "./pose";
import type { Scoring } from "./scoringApi";

const pose = (o: Partial<Record<Joint, number>>): Record<Joint, number> => ({ ...REST_POSE, ...o });

/** Placeholder moves until content records the real ones into public/assets/moves/. */
export const FAKE_MOVES: MoveDef[] = [
  { id: "arms_up", name: "Arms up", target: pose({ leftShoulder: 170, rightShoulder: 170 }) },
  { id: "t_pose", name: "T pose", target: pose({ leftShoulder: 90, rightShoulder: 90, leftElbow: 175, rightElbow: 175 }) },
  { id: "left_up", name: "Left up", target: pose({ leftShoulder: 165 }) },
  { id: "right_up", name: "Right up", target: pose({ rightShoulder: 165 }) },
  { id: "flex", name: "Flex", target: pose({ leftShoulder: 90, rightShoulder: 90, leftElbow: 75, rightElbow: 75 }) },
  { id: "disco", name: "Disco", target: pose({ leftShoulder: 145, rightShoulder: 25, rightElbow: 100 }) },
  { id: "knee_up", name: "Knee up", target: pose({ leftHip: 100, leftKnee: 90, leftShoulder: 60, rightShoulder: 60 }) },
  { id: "squat", name: "Squat", target: pose({ leftHip: 130, rightHip: 130, leftKnee: 110, rightKnee: 110, leftShoulder: 90, rightShoulder: 90 }) },
];

// Bot tuning (mock only)
const BOT_REACT_SEC = 0.45; // bots start moving this long before the beat
const BOT_SPEED = 14; // pose lerp rate per second
const BOT_NOISE_DEG = 14; // max per-joint error when a bot copies a move
const BOT_FPS = 30;

type Bot = { skill: number; gullible: number; pose: Record<Joint, number>; plan: Map<number, Record<Joint, number>> };
const newBot = (skill = 0.8 + Math.random() * 0.15): Bot => ({ skill, gullible: 0.25, pose: { ...REST_POSE }, plan: new Map() });

/** Two bots that copy the character's moves, with mistakes. Emits PlayerFrames like vision does. */
export function startFakeVision(onFrame: (f: PlayerFrame) => void, now: () => number, upcoming: () => Upcoming) {
  const bots = [newBot(0.93), newBot(0.88)];
  let last = now();

  const decide = (bot: Bot, move: Move) => {
    const copies = Math.random() < (move.cue === "sing" ? bot.skill : bot.gullible);
    if (!copies) return { ...REST_POSE };
    const out = {} as Record<Joint, number>;
    for (const j of JOINTS) out[j] = Math.max(0, Math.min(180, move.target[j] + (Math.random() * 2 - 1) * BOT_NOISE_DEG));
    return out;
  };

  const loop = () => {
    requestAnimationFrame(loop);
    const t = now();
    const dt = t - last;
    if (dt < 1 / BOT_FPS) return; // also stops while the AudioContext is suspended
    last = t;
    const up = upcoming();
    bots.forEach((bot, i) => {
      const id = i as 0 | 1;
      let goal = bot.pose;
      if (up && up.beatTime - t < BOT_REACT_SEC) {
        if (!bot.plan.has(up.move.beat)) bot.plan.set(up.move.beat, decide(bot, up.move));
        goal = bot.plan.get(up.move.beat)!;
      }
      const k = 1 - Math.exp(-Math.min(dt, 0.1) * BOT_SPEED);
      for (const j of JOINTS) bot.pose[j] += (goal[j] - bot.pose[j]) * k;
      const hipX = (id === 0 ? 0.73 : 0.27) + Math.sin(t * 2 + id) * 0.01; // raw x; screen x = 1 - x
      onFrame({ id, t, angles: { ...bot.pose }, landmarks: poseToLandmarks(bot.pose, hipX, 0.6, 0.7, 16 / 9), confidence: 0.95 });
    });
  };
  loop();

  return {
    newChallenger(side: 0 | 1) { bots[side] = newBot(); },
  };
}

/** Stand-in scoring that follows SPEC "Scoring" closely enough to drive the game. Skips per-joint visibility. */
export function createFakeScoring(): Scoring {
  const fresh = (): [PlayerState, PlayerState] => [0, 1].map(() => ({
    score: 0, combo: 0, flow: 0, lives: config.startingLives, alive: true,
  })) as [PlayerState, PlayerState];
  const frames: PlayerFrame[][] = [[], []];
  let state = fresh();
  let moveCount = 0;
  let tier = 0;
  let lastId = "";

  const error = (f: PlayerFrame, move: Move) => {
    let sum = 0, wsum = 0;
    for (const j of JOINTS) {
      const w = config.jointWeights[j];
      sum += w * Math.abs(f.angles[j] - move.target[j]);
      wsum += w;
    }
    return wsum ? sum / wsum : Infinity;
  };

  return {
    get state() { return state; },
    addFrame(f) {
      const buf = frames[f.id];
      buf.push(f);
      while (buf.length && buf[0].t < f.t - 3) buf.shift();
    },
    nextMove(beat) {
      const pool = FAKE_MOVES.filter((m) => m.id !== lastId);
      const def = pool[Math.floor(Math.random() * pool.length)];
      lastId = def.id;
      const trap = moveCount >= config.noTrapsBeforeMove && Math.random() < config.trapChance;
      moveCount++;
      return { id: def.id, beat, target: def.target, cue: trap ? "trap" : "sing" };
    },
    scoreMove(move, beatTime) {
      const events: GameEvent[] = [];
      const win = config.scoreWindowMs / 1000;
      for (const id of [0, 1] as const) {
        const s = state[id];
        if (!s.alive) continue;
        let best = Infinity;
        for (const f of frames[id]) if (Math.abs(f.t - beatTime) <= win) best = Math.min(best, error(f, move));
        const grade = best <= config.perfectMaxErrorDeg ? "perfect" : best <= config.goodMaxErrorDeg ? "good" : "miss";
        if (move.cue === "trap") {
          if (grade !== "miss") {
            s.alive = false;
            events.push({ type: "trapFail", player: id, grade }, { type: "eliminated", player: id });
          }
        } else if (grade === "miss") {
          s.lives--;
          s.combo = 0;
          s.flow = Math.max(0, s.flow - config.flowLossOnMiss);
          events.push({ type: "miss", player: id, grade });
          if (s.lives <= 0) {
            s.alive = false;
            events.push({ type: "eliminated", player: id });
          }
        } else {
          s.score += config.points[grade];
          s.combo++;
          s.flow = Math.min(1, s.flow + config.flowGain[grade]);
          events.push({ type: "hit", player: id, grade });
        }
      }
      return events;
    },
    tempoBpm() {
      const leader = Math.max(0, ...state.filter((s) => s.alive).map((s) => s.flow));
      let target = 0;
      config.tempoTiers.forEach((tt, i) => { if (tt.minFlow <= leader) target = i; });
      tier += Math.sign(target - tier);
      return config.tempoTiers[tier].bpm;
    },
    reset() {
      state = fresh();
      frames[0] = [];
      frames[1] = [];
      moveCount = 0;
      tier = 0;
      lastId = "";
    },
  };
}
