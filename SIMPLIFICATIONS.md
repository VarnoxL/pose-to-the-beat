# Simplifications and fallbacks

Every shortcut we take, so Q&A answers stay honest. One line each: what, why, and when it was taken.

- Joint angles use 2D (x, y) only; MediaPipe's z is too noisy. (Design, hour 0)
- Player ids follow screen halves; if players cross over, their ids swap. (Design, hour 0)
- A measure's tempo is decided when its first beat is scheduled (about one beat early), not exactly on the boundary. (Game, hour 0)
- A tempo tier with no `song_<bpm>.ogg` yet plays a code-made click track instead of music. (Game, hour 0)
- A tied first round (no champion yet) goes to P1. (Game, hour 0)
- Until vision and scoring merge, `main.ts` runs two bot players and a stand-in scoring from `src/game/fake.ts`. (Game, hour 0)
