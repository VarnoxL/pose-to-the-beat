// Shared data shapes. Every track builds against these.
// Change only via a PR to main that all track owners have seen (see CLAUDE.md).

export const JOINTS = [
  "leftElbow", "rightElbow",
  "leftShoulder", "rightShoulder",
  "leftHip", "rightHip",
  "leftKnee", "rightKnee",
] as const;
export type Joint = (typeof JOINTS)[number];

/** One MediaPipe landmark. x, y normalized 0..1 in the RAW (unmirrored) camera image. */
export type Point = { x: number; y: number; z: number; visibility: number };

/** One tracked player at one instant. id 0 = left half of the SCREEN (mirrored view). */
export type PlayerFrame = {
  id: 0 | 1;
  t: number; // seconds: audioCtx.currentTime - lagOffsetMs / 1000
  angles: Record<Joint, number>; // degrees, 0..180, smoothed
  landmarks: Point[]; // all 33 MediaPipe landmarks, smoothed
  confidence: number; // 0..1, mean visibility of the landmarks the 8 joints use
};

export type Move = {
  id: string;
  beat: number; // beat index the move is scored on
  target: Record<Joint, number>;
  cue: "sing" | "trap"; // trap = the character didn't sing the line
};

export type BeatClock = { bpm: number; beatIndex: number; msToNextBeat: number };

export type GameEvent = {
  type: "hit" | "miss" | "trapFail" | "eliminated" | "champion";
  player: 0 | 1;
  grade?: "perfect" | "good" | "miss";
};

/** Live per-player state owned by scoring, read by game for the HUD. */
export type PlayerState = {
  score: number;
  combo: number;
  flow: number; // 0..1
  lives: number;
  alive: boolean;
};

/** A saved move file in public/assets/moves/<id>.json. */
export type MoveDef = { id: string; name: string; target: Record<Joint, number> };
