# CLAUDE.md

Read `SPEC.md` first. It holds the locked game decisions and the track interfaces.

## Stack
TypeScript + Vite, MediaPipe Pose Landmarker (`@mediapipe/tasks-vision`), Canvas 2D, and the Web Audio API. It runs entirely in the browser and ships to itch.io.

- `npm run dev` starts the dev server (the webcam needs localhost or https).
- `npm run build` typechecks and builds to `dist/`. Run it before every push.

## Ownership
Each track's agent works only inside its own folder, on its own branch:

| Branch | Folder | Owns |
|--------|--------|------|
| `track/vision` | `src/vision` | webcam, landmarks, One Euro smoothing, angles, `PlayerFrame`, recorder and replay |
| `track/scoring` | `src/scoring` | angle matching, grades, flow, lives, tempo tier, traps, move sequence, elimination |
| `track/game` | `src/game`, `src/main.ts`, `index.html` | audio clock, music, screens, drawing, HUD, lag screen |
| `track/content` | `assets/` | songs, voice lines, moves, sessions, SFX, `CREDITS.md` |

- **Shared files:** `src/types.ts` and `src/config.ts`. Change them only with a small PR to `main`, and tell the other tracks. Never change a shared type silently inside a track branch.
- Until the real pieces connect, build against the shapes in `types.ts` using mock data or replay JSON from `assets/sessions/`.
- Merge `main` into your branch often. All tracks merge to `main` by hour 14.

## Rules
- **Every feel number goes in `src/config.ts`.** That includes windows, thresholds, tiers and lives. No magic numbers in track code.
- **Time everything to `AudioContext.currentTime`**, never to `performance.now()` or frame time.
- **The view is mirrored.** Draw with `ctx.scale(-1, 1)`. Never swap L/R joints.
- **Never generate art, music, or sound.** Code-drawn visuals (skeletons, shapes, particles) are fine.
- Any free asset you add gets a line in `assets/CREDITS.md`, with its license.
- Any simplification or fallback you take gets a line in `SIMPLIFICATIONS.md`.
- Keep it small. This is a 48-hour jam: no new dependencies without asking, and no abstractions for one use.
- When done, run the thing and report what you saw.
