// Every feel value lives here. Tune by playing, not by digging through code.

export const config = {
  // Round
  roundSeconds: 45, // at the cap, higher score wins
  startingLives: 2, // a miss costs 1, a trap fail is instant elimination

  // Beat structure
  beatsPerMove: 4, // a new move every N beats: shown on beat 1, posed on beat 4
  previewBeats: 3, // the character shows the move this many beats before it's scored
  trapChance: 0.15, // per move, once traps are allowed
  noTrapsBeforeMove: 3, // moves with index < 3 (0-based, per round) are never traps
  trapRestMarginDeg: 10, // a move is never a trap if standing still is within goodMaxErrorDeg + this of it

  // Scoring (mean absolute angle error in degrees, over visible joints)
  scoreWindowMs: 200, // best match within ±window around the beat counts (150 was tighter than real camera + detection delay)
  perfectMaxErrorDeg: 15,
  goodMaxErrorDeg: 30, // also the trap threshold: error <= this on a trap = eliminated
  jointWeights: {
    leftElbow: 1, rightElbow: 1,
    leftShoulder: 1, rightShoulder: 1,
    leftHip: 0.5, rightHip: 0.5,
    leftKnee: 0.5, rightKnee: 0.5,
  },
  minJointVisibility: 0.5, // joints below this are skipped
  minVisibleJoints: 4, // fewer visible joints than this = miss
  points: { perfect: 300, good: 100 },

  // Flow meter (per player, 0..1)
  flowGain: { perfect: 0.12, good: 0.06 },
  flowLossOnMiss: 0.3,

  // Tempo tiers follow the LEADER's flow; changes only land on a measure boundary
  beatsPerMeasure: 4,
  tempoTiers: [
    { bpm: 78, minFlow: 0 },
    { bpm: 86, minFlow: 0.2 },
    { bpm: 100, minFlow: 0.4 },
    { bpm: 107, minFlow: 0.6 },
    { bpm: 132, minFlow: 0.8 },
  ],

  // Vision
  // beta is per unit of speed in normalized image coords (0..1/s). 0.007 left a ~1 Hz low-pass that lagged a pose by 230-430 ms.
  oneEuro: { minCutoff: 1.0, beta: 4, dCutoff: 1.0 },

  // Game: screens and timing
  leadInBeats: 3, // first move is scored on beat index 3 = the 4th beat of the first measure
  startDelaySec: 0.3, // gap between pressing start and beat 0, so audio can be scheduled
  scheduleAheadSec: 0.2, // audio lookahead; tempo for a measure is decided this early
  eliminatedScreenSec: 2,
  championScreenSec: 3,
  popupSec: 0.8, // how long PERFECT / GOOD / MISS stays up
  playerGoneSec: 0.5, // no frame for this long = player left (skeleton hidden; bot mode lets a lone right-side player in)
  characterPoseLerp: 12, // per second; how fast the character eases into the next pose
  musicGain: 0.8,
  lagCalibrationBpm: 100,
  lagCalibrationBeats: 8,
  lagCalibrationMinSamples: 4,

  // Bot opponent (key B on the title screen)
  bot: {
    skillMin: 0.8, // chance to copy a sung move; each new bot rolls between min and max
    skillMax: 0.95,
    trapGullibility: 0.25, // chance to copy a trap move
    reactSec: 0.45, // starts moving this long before the beat
    speed: 14, // pose ease rate per second
    noiseDeg: 14, // max per-joint error when it copies
    fps: 30,
  },

  // Sync: camera + speaker latency. Hidden L screen overrides this via localStorage.
  lagOffsetMsDefault: 120,
  lagOffsetStorageKey: "ptb.lagOffsetMs",
} as const;
