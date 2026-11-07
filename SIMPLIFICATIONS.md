# Simplifications and fallbacks

Every shortcut we take, so Q&A answers stay honest. One line each: what, why, and when it was taken.

- Joint angles use 2D (x, y) only; MediaPipe's z is too noisy. (Design, hour 0)
- Player ids follow screen halves; if players cross over, their ids swap. (Design, hour 0)
- A measure's tempo is decided when its first beat is scheduled (about one beat early), not exactly on the boundary. (Game, hour 0)
- A tempo tier with no `song_<bpm>.ogg` yet plays a code-made click track instead of music. (Game, hour 0)
- A tied first round (no champion yet) goes to P1. (Game, hour 0)
- Until scoring merges, the game uses a stand-in scoring from `src/game/fake.ts`. (Game, hour 0)
- Pose model is `pose_landmarker_lite` (5.8 MB) for frame rate on judge laptops; swap to `_full` in `src/vision/index.ts` if tracking is too jittery. (Vision, hour 0)
- A lone player keeps their id while alone instead of re-picking it by screen half every frame (SPEC says by half), so standing in the middle doesn't flip them. Known edges: after a second player leaves, the one left is re-picked by half; a new person entering after the lone player left inherits that id until a second player appears. (Vision, hour 1)
- MediaPipe runs on the CPU delegate, not GPU: on the dev laptop GPU (WebGL) took 110 ms/frame vs 40 ms on CPU. Webcam asks for 640x360 instead of 720p for the same reason. No auto-pick between them. (Vision, hour 1)
