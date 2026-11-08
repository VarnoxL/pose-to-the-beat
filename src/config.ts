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
    { bpm: 78, minFlow: 0 },
    { bpm: 86, minFlow: 0.2 },
    { bpm: 100, minFlow: 0.4 },
    { bpm: 107, minFlow: 0.6 },
    { bpm: 132, minFlow: 0.8 },
  ],

  // Vision
  oneEuro: { minCutoff: 1.0, beta: 0.007, dCutoff: 1.0 },

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
  voiceGain: 0.55, // sung move names, a bit under the music
  gameSong: { bpm: 100, firstBeatSec: 0.39 }, // assets/audio/game.mp3: measured tempo and first beat; rounds play it sped up/slowed down to the tier
  voiceOnsetThreshold: 0.1, // voice clips: the voice "starts" at the first sample above this fraction of the clip's peak
  voicePreRollSec: 0.04, // keep this much before the onset so consonants aren't clipped
  lagCalibrationBpm: 100,
  lagCalibrationBeats: 8,
  lagCalibrationMinSamples: 4,

  // Images popping in and out at random spots, only during a round
  popFx: {
    roundFadeSec: 0.6, // fade in at round start, out at round end
    notes: {
      copies: 8, // how many copies cycle (staggered)
      showSec: 2.2, // each appearance lasts this long, including its fade in and out
      gapSec: 1, // hidden this long before popping up somewhere new
      inOutSec: 0.45, // fade/grow in and fade/shrink out
      minSize: 0.12, // longest side, fraction of screen height
      maxSize: 0.2,
      margin: 0.12, // keep image centres this far (fraction of screen) from the edges
      maxTiltRad: 0.35,
      beatPop: 0.06, // extra scale right on the beat
      alpha: 0.85,
      blend: "source-over",
    },
  },

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
