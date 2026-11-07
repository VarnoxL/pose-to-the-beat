# Pose to the Beat — SPEC

King-of-the-court dance-off for CougarJam. Two players, one webcam. A singing character calls moves on the beat. Copy a sung move and you score; copy an unsung one (trap) and you're out. Tempo climbs with flow. Winner keeps the crown, next challenger steps in.

**Tagline:** Keep the flow. Don't break the beat.

The source of truth for shapes is `src/types.ts`, and for every tunable number it's `src/config.ts`. This doc explains them.

## Decisions (locked)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Joints | 8 joints: L/R elbow, shoulder, hip, knee. Angles in degrees, 0–180. Arms-only fallback = set hip/knee weights to 0 in config. |
| 2 | Trap rule | On a trap move, a match that would grade **good or better** = instant elimination. Anything worse is safe. |
| 3 | Round end | 2 lives. A miss costs 1 life; 0 lives = eliminated. Trap fail = instant elimination. 45 s cap: if both alive, higher score wins. |
| 4 | Tempo | One shared tempo tier, driven by the **leader's** (higher) flow. Tier changes only land on a measure boundary, at most one step per measure. Exact rule in "Tempo and music". |
| 5 | Mirroring | Webcam feed, skeletons and character are all drawn **mirrored**. Raw angles are compared directly; **no L/R swap anywhere**. |
| 6 | Lag | Hidden calibration screen on key `L`: click track, player claps/raises arm on 8 beats, median offset saved to localStorage (`ptb.lagOffsetMs`). Fallback is `lagOffsetMsDefault` in config. Judges never see it. |

## Game flow

```
title → round → (eliminated | time up) → champion → new challenger → round …
```

- Rounds last ≤ 45 s, so 3 judges finish in ~2 minutes.
- **The winner stays.** On the "new challenger" screen the loser steps out and a new player steps into the empty half. The champion's side doesn't change.
- Moves with index < `noTrapsBeforeMove` (0-based, counted per round) are never traps, so a new player can learn the loop.

## Data shapes

See `src/types.ts`. Summary:

- `Joint`: 8 joint names from `JOINTS`.
- `Point = { x, y, z, visibility }`: one MediaPipe landmark. x and y are normalized 0..1 in the **raw, unmirrored** camera image.
- `PlayerFrame = { id, t, angles, landmarks, confidence }`. `t = audioCtx.currentTime - lagOffsetMs / 1000` (seconds). `landmarks` holds all 33, smoothed.
- `Move = { id, beat, target, cue }`, where `cue: "trap"` means the character did not sing.
- `BeatClock = { bpm, beatIndex, msToNextBeat }`
- `GameEvent = { type, player, grade? }`
- `PlayerState = { score, combo, flow, lives, alive }`, owned by scoring and read by game.
- `MoveDef = { id, name, target }`, a saved move in `public/assets/moves/<id>.json`.

### Joint angles

Each angle is the 2D angle (x, y only; z is too noisy) at the middle landmark:

| Joint | Landmarks (MediaPipe index) |
|-------|-----------------------------|
| elbow | shoulder – **elbow** – wrist (11-13-15 / 12-14-16) |
| shoulder | hip – **shoulder** – elbow (23-11-13 / 24-12-14) |
| hip | shoulder – **hip** – knee (11-23-25 / 12-24-26) |
| knee | hip – **knee** – ankle (23-25-27 / 24-26-28) |

Left = MediaPipe's left (the person's own left). Odd indices are left.

### Player assignment

Run MediaPipe Pose Landmarker once per frame with `numPoses: 2`. For each pose take the hip midpoint x, convert it to **screen** x with `1 - x` (the view is mirrored), and sort: the smaller screen x is player 0 (left half of the screen). If only one pose is found, assign it by which half its screen x falls in. Ids are by screen half: if players cross over, their ids swap, and we accept that (listed in SIMPLIFICATIONS.md).

**MediaPipe files are self-hosted** (itch.io may block CDN fetches). Copy `node_modules/@mediapipe/tasks-vision/wasm/` to `public/mediapipe/wasm/` and the `pose_landmarker_*.task` model to `public/mediapipe/`, then load both with relative URLs.

**Fallback (Checkpoint 1):** crop the frame into halves and track one person per half. This needs 2 inference calls per frame.

## Scoring

1. For every frame in `move beat ± scoreWindowMs`, compute the error against `move.target`:
   - A joint's visibility is the **min** visibility of its 3 landmarks. Skip joints below `minJointVisibility`, and skip joints whose weight is 0.
   - Error = Σ(weight × |angle − target|) / Σ(weight), summed over the remaining joints only.
   - If fewer than `minVisibleJoints` joints remain, ignore that frame.
2. Take the **best (lowest) error** among the frames that weren't ignored. If every frame was ignored, the grade is a miss.
3. Grade: error ≤ `perfectMaxErrorDeg` is perfect, error ≤ `goodMaxErrorDeg` is good, anything else is a miss.
4. **Sung move:** perfect or good gives a `hit` event, adds points, increments combo and raises flow. A miss gives a `miss` event, takes a life, resets combo and drops flow. At 0 lives, emit `eliminated`.
5. **Trap move:** perfect or good gives `trapFail`, always followed by `eliminated` in the same returned array. Otherwise nothing happens: no points, no life lost, and combo is kept.
6. Round end: when one player is eliminated, or time is up (the higher score wins; on a tie the champion keeps the crown), emit `champion` for the winner.

Smoothing is a One Euro filter on landmarks (`config.oneEuro`), applied in vision before angles are computed.

## Tempo and music

- BeepBox song exported once per tier in `config.tempoTiers`, as `public/assets/audio/song_<bpm>.ogg`.
- At each measure boundary: `leaderFlow` = the highest flow among **alive** players. `target` = the highest tier index whose `minFlow` ≤ `leaderFlow`. Then `tier += sign(target − tier)`, so it moves at most one step per measure. Switch tracks at the boundary, timed on the audio clock. If tiers flap during playtests, add hysteresis then.
- **Everything is timed to `AudioContext.currentTime`**, never to frame time.
- **Fallback:** keep the music fixed and only speed up visuals and move frequency.

## Track interfaces (who calls whom)

```
vision  ──PlayerFrame──▶  scoring  ──GameEvent / PlayerState──▶  game
                                ▲                                 │
                                └──── Move, BeatClock ────────────┘
```

- **vision** (`src/vision`): `startVision(onFrame, now)` takes the live webcam and calls `onFrame(PlayerFrame)` for each player each frame. `now()` returns audio-clock seconds minus the lag offset; game supplies it. It also provides `startReplay(session, onFrame, now)` with the same output, read from JSON, plus the recorder.
- **scoring** (`src/scoring`): `createScoring()` returns something like `{ addFrame(f), nextMove(beatIndex): Move, scoreMove(move): GameEvent[], tempoBpm(): number, state: [PlayerState, PlayerState], reset(championId) }`. Scoring owns move sequencing, including the random trap choice.
- **game** (`src/game` + `src/main.ts`): owns the AudioContext, `BeatClock`, music switching, all screens (title, round, eliminated, champion, challenger, hidden lag screen), drawing (mirrored), and the HUD. It calls `scoreMove(move)` once the beat's window has closed.

These signatures are a starting point. Each track may adjust its own exports, but must tell the other tracks. **Changes to `types.ts` go to main first.**

## Recorder and replay (build first, Track 1)

- Session file: `{ recordedAt: string, frames: PlayerFrame[] }`, with `t` rebased to start at 0. Saved by download as `.json`, and the test sessions live in `public/assets/sessions/`.
- Replay feeds those frames through the same `onFrame` callback as the live camera, so scoring and game can't tell the difference.
- To make a move, record yourself holding the pose, pick a steady frame, and save its `angles` as a `MoveDef` in `public/assets/moves/<id>.json`. The character is drawn from these recorded poses, so no character art is needed.
- Target: **8–10 moves.**

**Asset loading:** everything runtime (songs, moves, sessions, SFX, MediaPipe files) lives under `public/`. Vite copies `public/` into the build as-is. Fetch with relative URLs (`fetch("assets/moves/arms_up.json")`), never root-absolute ones (`/assets/...`), so the build works from an itch.io subfolder.

## Jam rules

- No AI-generated art, music, or sound. All singing is recorded by the team.
- AI-generated code is allowed and is disclosed on the itch page.
- Free assets are OK. Every one goes in `public/assets/CREDITS.md` with its license.
- Every simplification or fallback goes in `SIMPLIFICATIONS.md`, so Q&A answers stay honest.
- Show a "Camera stays on this device" note on screen.

## Fallbacks (switch at Checkpoint 1, hour 20)

| Part | Fallback |
|------|----------|
| Full-body scoring | Arms only (zero the hip/knee weights) and a looser `goodMaxErrorDeg` |
| 2 players in one pass | Crop into halves, one pose per half |
| Beat timing | Fixed tempo tiers (already the plan) |
| Tempo rises with flow | Speed up visuals and move frequency only; music fixed |
| Venue lighting | Bring a lamp; play the backup gameplay video |
