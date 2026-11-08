# Pose to the Beat

**Keep the flow. Don't break the beat.**

A two-player webcam dance-off made in 48 hours for CougarJam. A character shows a move, a voice calls it, and on the fourth beat you strike the pose. The webcam watches both players and grades every pose against the target. Miss twice and you're out. Copy a move that wasn't called and you're out instantly. The last dancer standing takes the crown, and the next challenger steps in.

It runs entirely in the browser. There's no server, no install for players, and no video leaves the machine.

## How to play

1. Stand back from the webcam until your **hips and both arms** are in frame. Two players stand side by side, one on each half of the screen.
2. Press **Space** to start.
3. Each move takes four beats. The move is shown on beat 1, and you hold the pose on beat 4.
4. **Called moves:** the voice sings the move's name. Copy it.
   - **Perfect** (within 15°) scores 300 points.
   - **Good** (within 22°) scores 100 points.
   - A **miss** costs one of your 2 lives.
5. **Traps:** the move is shown but not called, and a "NOT CALLED" popup appears. Don't copy it. Copying a trap eliminates you on the spot. Standing still is safe.
6. Hit moves in a row to build **flow**. The leader's flow speeds up the tempo, from 78 up to 132 bpm.
7. A round lasts 45 seconds. If it hits the time cap, the higher score wins. The winner keeps the crown for the next challenger.

### Controls

| Key | Action |
|-----|--------|
| Space | Start a round (title or new challenger screen) |
| B | Play solo against a bot (title screen) |
| F | Start anyway when the camera can't fully see a player |
| L | Calibrate audio lag: tap along to the clicks |
| D | Toggle the debug readout (pose error and timing) |
| Esc | Back to the title |

Calibrate lag once per setup (**L**), especially on Bluetooth speakers. If good poses keep missing, press **D**: the readout shows whether the problem is the pose or the timing.

## Run it locally

You need Node.js and a webcam.

```
git clone https://github.com/VarnoxL/pose-to-the-beat.git
cd pose-to-the-beat
npm install
npm run dev
```

Open the URL Vite prints, usually http://localhost:5173. The webcam only works on localhost or https.

```
npm run build      # typecheck and build to dist/
npm run preview    # serve the built game
```

### URL switches

| URL | What it does |
|-----|--------------|
| `/?bot` | Space starts solo against a bot |
| `/?demo` | Two bots play each other, with no camera needed |
| `/?replay=duo` | Plays a recorded session from `public/assets/sessions/` (`duo`, `solo`, `legs`) |
| `/?log` | Saves a file per round with every move, its grade and the raw frames, for re-scoring offline |

## How it works

```
webcam ──► vision ──► PlayerFrame (joint angles, per player) ──► scoring ──► game
                                                                   ▲          │
                                                    bots ──────────┘          └─► canvas + audio
```

- **Vision** (`src/vision`): MediaPipe Pose Landmarker tracks up to two people. Landmarks are smoothed with a One Euro filter and turned into 8 joint angles: shoulders, elbows, hips and knees. Landmarks outside the image are treated as not visible.
- **Scoring** (`src/scoring`): each frame's error is the weighted mean angle difference from the move's target. Arms count fully and hips and knees count half. A player is graded on their best frame within ±200 ms of the beat. This module also tracks lives, flow, tempo tier and eliminations, and deals the moves.
- **Fair traps:** a move is only dealt as a trap if it's at least 32° from standing still and from the previous move. Moves the camera can't judge right now (for example leg moves while legs are out of frame) aren't dealt.
- **Game** (`src/game`): screens, HUD, drawing and audio. Everything is timed to `AudioContext.currentTime`. There's one song at 100 BPM, and its playback rate is changed to match the tempo tier. Voice lines play only on called moves.
- **Tuning:** every feel number (windows, thresholds, tiers, lives, points) is in [`src/config.ts`](src/config.ts).

### Scoring check

```
node src/scoring/scoring.test.mjs
```

This needs Node 24 and no extra installs. It runs the rule asserts and then prints the best grade per move for each recorded session.

## Project layout

```
src/
  config.ts       every tunable number
  types.ts        shared data shapes (PlayerFrame, Move, ...)
  main.ts         wires vision, scoring, game and bots together
  vision/         webcam, pose landmarks, smoothing, angles, record/replay
  scoring/        grading, lives, flow, tempo, traps, move deck
  game/           screens, drawing, HUD, audio, bot players
public/assets/
  moves/          10 move targets as JSON
  audio/          music and voice lines
  images/         title art and effects
  sessions/       recorded pose sessions for replay and tests
  CREDITS.md      asset credits and licenses
```

More detail:

- [SPEC.md](SPEC.md): game design and interfaces
- [src/scoring/SCORING.md](src/scoring/SCORING.md): scoring rules
- [SIMPLIFICATIONS.md](SIMPLIFICATIONS.md): shortcuts taken for the jam

## Credits

Made by the Pose to the Beat team for CougarJam. Music and images are licensed assets, listed with their licenses in [public/assets/CREDITS.md](public/assets/CREDITS.md). The voice lines were recorded by the team. No AI-generated art or sound is used.
