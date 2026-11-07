# Simplifications and fallbacks

Every shortcut we take, so Q&A answers stay honest. One line each: what, why, and when it was taken.

- Joint angles use 2D (x, y) only; MediaPipe's z is too noisy. (Design, hour 0)
- Player ids follow screen halves; if players cross over, their ids swap. (Design, hour 0)
- Pose model is `pose_landmarker_lite` (5.8 MB) for frame rate on judge laptops; swap to `_full` in `src/vision/index.ts` if tracking is too jittery. (Vision, hour 0)
