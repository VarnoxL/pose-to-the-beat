// What game needs from scoring. Scoring track: implement this (adjust and tell game if needed).
import type { GameEvent, Move, PlayerFrame, PlayerState } from "../types";

export interface Scoring {
  addFrame(f: PlayerFrame): void;
  /** Called once per move, `previewBeats` before it's scored. Scoring picks the move and whether it's a trap. */
  nextMove(beatIndex: number): Move;
  /**
   * Called once the move's window has closed (now() > beatTime + scoreWindowMs).
   * `beatTime` is in the same clock as PlayerFrame.t (audio seconds). Game passes it because tempo
   * changes make beat index -> time non-linear, so scoring can't work it out alone.
   */
  scoreMove(move: Move, beatTime: number): GameEvent[];
  /** Called once per measure boundary (and at beat 0). Applies the one-step tier rule, returns the bpm to use. */
  tempoBpm(): number;
  readonly state: [PlayerState, PlayerState];
  /** New round. championId is null before the first champion exists. */
  reset(championId: 0 | 1 | null): void;
}
