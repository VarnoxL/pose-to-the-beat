# Scoring track status (handoff)

What's done on the `scoring` branch, what's left, and how to check it. The rules behind the code are in `SCORING.md`. `SCORING_REPORT.html` has the same work as flowcharts; open it in a browser.

## Done

- **`src/scoring/index.ts`** implements the whole `Scoring` interface from `src/game/scoringApi.ts`:
  - `frameError`: weighted mean angle error over visible joints. A joint's visibility is the min of its 3 landmarks, and a frame with fewer than `minVisibleJoints` usable joints is ignored.
  - `grade`: perfect ≤ `perfectMaxErrorDeg`, good ≤ `goodMaxErrorDeg`, otherwise miss. A player is graded on their best frame in `beatTime ± scoreWindowMs`.
  - `scoreMove` handles hits, misses, lives, elimination, traps and the champion event. An absent player counts as a miss.
  - `tempoBpm` steps one tier per call, toward the tier set by the leader's flow.
  - `nextMove` deals from a shuffled deck, never repeats the last move (even across a reshuffle), and never deals a trap before `noTrapsBeforeMove`.
  - `reset(championId)` starts each round clean.
  - `loadMoves()` loads the 10 hardcoded move files.
- **`src/main.ts`** now uses the real scoring instead of `createFakeScoring` (import and call swapped, old TODO removed). This is the game track's file, so the game owner has to OK it.
- **`src/scoring/scoring.test.mjs`**: rule asserts plus a report over `public/assets/sessions/`. All asserts pass.
- `npm run build` passes.
- I ran a headless `?demo` in Chrome: no console errors, and a full round played to the "takes the crown" screen and NEW CHALLENGER.

Run the check with:

```
node src/scoring/scoring.test.mjs
```

It needs Node 24 and no installs. It's plain JS so tsc and vite skip it, and it loads the TS through type stripping plus a small resolve hook.

## Left to do

1. **Play a live round with a real webcam and real scoring.** This is the last "Done when" item in `SCORING.md` and it hasn't been done. Use `npm run dev`, then open `localhost:5173` for 2 players or `?bot` for one player against a bot. Check that a correct pose grades perfect or good, that standing still misses, and that traps feel fair.
2. **Tune `goodMaxErrorDeg`.** It's a shared config value, so the change goes in its own small PR to main.
   - At the current 30°, just standing still grades **good** on 3 moves: `right_knee` 24.5°, `supermen` 27.1° and `disco` 28.8°. So a player who doesn't move scores on those moves, and gets eliminated when one of them is dealt as a trap.
   - 20 pairs of moves are within 30° of each other, for example `t_pose`–`y_pose` 18.5° and `chicken`–`double_bi` 18.0°.
   - Over 500 simulated bot rounds, trap eliminations were 473 at 30° and 228 at **22°**.
   - Suggestion: try 22°, then confirm it in the live round from item 1. Recorded sessions still hit at 22° except for a few 23–30° "good" grades (see the session report).
3. **Tell the game owner about a bot bug** (`src/game/bot.ts`, game's file, don't fix it here). Each bot's `plan` Map is keyed by beat and never cleared between rounds. A bot that survives a round replays the previous round's poses against the new moves, and `replace()` only swaps the loser.
   - In simulation, median round length is 8.7 s with the bug and 21.4 s with fresh bots.
   - The champion keeps the crown in 8% of rounds with the bug and 55% with fresh bots.
4. **After this merges:** game deletes `src/game/fake.ts`, once nothing imports it.
5. **Optional, only if moves get added:** add the id to `MOVE_IDS` in `index.ts`. Static hosting can't list a folder, so the list is hardcoded (logged in `SIMPLIFICATIONS.md`).

## Session report (current thresholds)

From `node src/scoring/scoring.test.mjs`: every move gets at least a good grade in every recording, with one exception. `duo.json` P1 misses `y_pose` at 43.2°. Several "good" grades fall in the 23–30° band, and those would turn into misses at 22°. Re-check them after any change to the threshold.
