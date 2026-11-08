// Scoring track: angle matching, grades, lives, flow, traps, tempo tier, move deck. See SCORING.md.
import { config } from "../config";
import { JOINTS, type GameEvent, type Joint, type Move, type MoveDef, type PlayerFrame, type PlayerState } from "../types";
import type { Scoring } from "../game/scoringApi";
import { REST_POSE } from "../game/pose";

// ponytail: hardcoded because static hosting can't list a folder; add the id here when a move file is added.
const MOVE_IDS = ["chicken", "disco", "double_bi", "right_biceps", "right_knee", "six_seven", "sumo_squat", "supermen", "t_pose", "y_pose"];

/** The 3 MediaPipe landmarks each joint angle uses (SPEC "Joint angles"). */
const JOINT_LANDMARKS: Record<Joint, [number, number, number]> = {
  leftElbow: [11, 13, 15], rightElbow: [12, 14, 16],
  leftShoulder: [23, 11, 13], rightShoulder: [24, 12, 14],
  leftHip: [11, 23, 25], rightHip: [12, 24, 26],
  leftKnee: [23, 25, 27], rightKnee: [24, 26, 28],
};

export async function loadMoves(): Promise<MoveDef[]> {
  const moves = await Promise.all(MOVE_IDS.map((id) =>
    fetch(`assets/moves/${id}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  return moves.filter((m): m is MoveDef => !!m);
}

/** Weighted mean angle error over visible joints, or null if too few joints are visible. */
export function frameError(f: PlayerFrame, target: Record<Joint, number>): number | null {
  let sum = 0, wsum = 0, n = 0;
  for (const j of JOINTS) {
    const w = config.jointWeights[j];
    if (!w) continue;
    const vis = Math.min(...JOINT_LANDMARKS[j].map((i) => f.landmarks[i]?.visibility ?? 0));
    if (vis < config.minJointVisibility) continue;
    sum += w * Math.abs(f.angles[j] - target[j]);
    wsum += w;
    n++;
  }
  return n < config.minVisibleJoints ? null : sum / wsum;
}

export function grade(error: number | null): "perfect" | "good" | "miss" {
  if (error === null) return "miss";
  return error <= config.perfectMaxErrorDeg ? "perfect" : error <= config.goodMaxErrorDeg ? "good" : "miss";
}

/** `rand` is injectable so the test can make deck and trap choices deterministic. */
export function createScoring(moves: MoveDef[], rand: () => number = Math.random): Scoring {
  const fresh = () => [0, 1].map(() => ({
    score: 0, combo: 0, flow: 0, lives: config.startingLives, alive: true,
  })) as [PlayerState, PlayerState];
  // Frames older than one window plus one beat at the slowest tier can never be scored again.
  const keepSec = config.scoreWindowMs / 1000 + 60 / Math.min(...config.tempoTiers.map((t) => t.bpm));
  const frames: PlayerFrame[][] = [[], []];
  let state = fresh();
  let champion: 0 | 1 | null = null;
  let moveCount = 0;
  let tier = 0;
  let deck: MoveDef[] = [];
  let lastId = "";
  // A player who stands still must survive every trap, so moves that standing still already (nearly) matches are never traps.
  const still = { angles: REST_POSE, landmarks: Array(33).fill({ visibility: 1 }) } as unknown as PlayerFrame;
  const trappable = new Set(moves.filter((m) => frameError(still, m.target)! > config.goodMaxErrorDeg + config.trapRestMarginDeg).map((m) => m.id));

  const deal = (): MoveDef => {
    if (!deck.length) {
      deck = [...moves];
      for (let i = deck.length - 1; i > 0; i--) {
        const k = Math.floor(rand() * (i + 1));
        [deck[i], deck[k]] = [deck[k], deck[i]];
      }
      // Never the move just played, across a reshuffle.
      if (deck.length > 1 && deck[deck.length - 1].id === lastId) [deck[0], deck[deck.length - 1]] = [deck[deck.length - 1], deck[0]];
    }
    const def = deck.pop()!;
    lastId = def.id;
    return def;
  };

  return {
    get state() { return state; },

    addFrame(f) {
      const buf = frames[f.id];
      buf.push(f);
      while (buf.length && buf[0].t < f.t - keepSec) buf.shift();
    },

    nextMove(beat) {
      const def = deal();
      const trap = moveCount >= config.noTrapsBeforeMove && trappable.has(def.id) && rand() < config.trapChance;
      moveCount++;
      return { id: def.id, beat, target: def.target, cue: trap ? "trap" : "sing" };
    },

    scoreMove(move: Move, beatTime: number) {
      const events: GameEvent[] = [];
      const win = config.scoreWindowMs / 1000;
      let anyOut = false;
      for (const id of [0, 1] as const) {
        const s = state[id];
        if (!s.alive) continue;
        let best: number | null = null;
        for (const f of frames[id]) {
          if (Math.abs(f.t - beatTime) > win) continue;
          const e = frameError(f, move.target);
          if (e !== null && (best === null || e < best)) best = e;
        }
        const g = grade(best);
        if (move.cue === "trap") {
          if (g === "miss") continue; // safe: nothing changes
          s.alive = false;
          events.push({ type: "trapFail", player: id, grade: g }, { type: "eliminated", player: id });
        } else if (g === "miss") {
          s.lives--;
          s.combo = 0;
          s.flow = Math.max(0, s.flow - config.flowLossOnMiss);
          events.push({ type: "miss", player: id, grade: g });
          if (s.lives <= 0) {
            s.alive = false;
            events.push({ type: "eliminated", player: id });
          }
        } else {
          s.score += config.points[g];
          s.combo++;
          s.flow = Math.min(1, s.flow + config.flowGain[g]);
          events.push({ type: "hit", player: id, grade: g });
        }
        if (!s.alive) anyOut = true;
      }
      if (anyOut) {
        // Same rule as game's endRound: last one standing, else higher score, else the champion keeps it.
        const [a, b] = state;
        const winner: 0 | 1 = a.alive !== b.alive ? (a.alive ? 0 : 1)
          : a.score !== b.score ? (a.score > b.score ? 0 : 1)
          : champion ?? 0;
        events.push({ type: "champion", player: winner });
      }
      return events;
    },

    tempoBpm() {
      const leader = Math.max(0, ...state.filter((s) => s.alive).map((s) => s.flow));
      let target = 0;
      config.tempoTiers.forEach((t, i) => { if (t.minFlow <= leader) target = i; });
      tier += Math.sign(target - tier);
      return config.tempoTiers[tier].bpm;
    },

    reset(championId) {
      state = fresh();
      champion = championId;
      frames[0] = [];
      frames[1] = [];
      moveCount = 0;
      tier = 0;
      deck = [];
      lastId = "";
    },
  };
}
