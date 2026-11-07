// Every feel value lives here. Tune by playing, not by digging through code.

export const config = {
  // Round
  roundSeconds: 45, // at the cap, higher score wins
  startingLives: 2, // a miss costs 1, a trap fail is instant elimination

  // Beat structure
  beatsPerMove: 2, // a new move every N beats
  previewBeats: 1, // the character shows the move this many beats before it's scored
  trapChance: 0.15, // per move, once traps are allowed
  noTrapsBeforeMove: 3, // moves with index < 3 (0-based, per round) are never traps

  // Scoring (mean absolute angle error in degrees, over visible joints)
  scoreWindowMs: 150, // best match within ±window around the beat counts
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
    { bpm: 100, minFlow: 0 },
    { bpm: 115, minFlow: 0.35 },
    { bpm: 130, minFlow: 0.6 },
    { bpm: 145, minFlow: 0.85 },
  ],

  // Vision
  oneEuro: { minCutoff: 1.0, beta: 0.007, dCutoff: 1.0 },

  // Sync: camera + speaker latency. Hidden L screen overrides this via localStorage.
  lagOffsetMsDefault: 120,
  lagOffsetStorageKey: "ptb.lagOffsetMs",
} as const;
