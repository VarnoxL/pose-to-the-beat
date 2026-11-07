// MOCK: stand-in scoring that follows SPEC "Scoring" closely enough to drive the game.
// Delete once the scoring track merges (swap createFakeScoring() for createScoring() in main.ts).
import { config } from "../config";
import { JOINTS, type GameEvent, type Move, type MoveDef, type PlayerFrame, type PlayerState } from "../types";
import type { Scoring } from "./scoringApi";

// The real scoring owns move loading; this list just mirrors public/assets/moves/ for now.
const MOVE_IDS = ["chicken", "disco", "double_bi", "right_biceps", "right_knee", "six_seven", "sumo_squat", "supermen", "t_pose", "y_pose"];

export async function loadMoves(): Promise<MoveDef[]> {
  const moves = await Promise.all(MOVE_IDS.map((id) => fetch(`assets/moves/${id}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  return moves.filter((m): m is MoveDef => !!m);
}

/** Stand-in scoring that follows SPEC "Scoring" closely enough to drive the game. Skips per-joint visibility. */
export function createFakeScoring(moves: MoveDef[]): Scoring {
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
      const pool = moves.filter((m) => m.id !== lastId);
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
