# Scoring track spec

Scoring-only notes for the `scoring` branch. `SPEC.md` is still the source of truth. This file pins down what SPEC leaves open, as agreed in the grill-me session on 2026-11-07.

## Interface

Implement `Scoring` from `src/game/scoringApi.ts` as `createScoring(moves: MoveDef[])` in `src/scoring/index.ts`. Also export `loadMoves()`. Read every number from `src/config.ts`.

| Method | Behaviour |
|--------|-----------|
| `addFrame(f)` | Buffer frames per player id. Keep `scoreWindowMs` plus one beat at the slowest tier, both taken from config. |
| `nextMove(beat)` | Deal from the deck (see below). Decide the trap here. |
| `scoreMove(move, beatTime)` | Grade each alive player against frames in `beatTime ± scoreWindowMs`. Return events. |
| `tempoBpm()` | One-step tier rule, driven by the leader's flow among alive players. |
| `state` | `[PlayerState, PlayerState]`, read by game for the HUD. |
| `reset(championId)` | Fresh state, buffers, deck and tier 0. Remember `championId` for ties. |

## Decisions

1. **Move list:** hardcode the 10 ids in `src/scoring`, the same list as in `fake.ts`. Adding a move means editing that one line.
2. **Move order:** a shuffled deck of all moves. Deal in order and reshuffle when it runs out. The first card after a reshuffle is never the move just played.
3. **Traps:** moves with per-round index `< noTrapsBeforeMove` are never traps. After that, each move is a trap with chance `trapChance`. A move is also never a trap if the rest pose (standing still) is within `goodMaxErrorDeg + trapRestMarginDeg` of it, so standing still always survives a trap. With the current numbers that rules out disco, right_knee, supermen, right_biceps and t_pose.
4. **Per-frame error (SPEC "Scoring" 1):**
   - A joint's visibility is the min `visibility` of its 3 landmarks.
   - Skip a joint if its visibility is `< minJointVisibility` or its weight is 0.
   - Error = Σ(w·|angle − target|) / Σw over the joints that remain.
   - Ignore the frame if fewer than `minVisibleJoints` joints remain.
5. **Grade:** the lowest error among frames that weren't ignored. `≤ perfectMaxErrorDeg` is perfect, `≤ goodMaxErrorDeg` is good, anything else is a miss.
6. **Absent player = miss.** No usable frames in the window means a miss, so it costs a life on a sung move and is safe on a trap.
7. **Sung move:**
   - Hit: `+points[grade]`, `combo++`, `flow += flowGain[grade]` (cap 1).
   - Miss: `lives--`, `combo = 0`, `flow -= flowLossOnMiss` (floor 0). At 0 lives, set `alive = false` and emit `eliminated`.
8. **Trap move:**
   - A perfect or good grade emits `trapFail`, then `eliminated`, and sets `alive = false`.
   - Anything worse changes nothing: no points, no life lost, combo kept.
9. **Champion:** emitted by `scoreMove` only when the round ends there (any player eliminated). The winner is:
   - the one player still alive, or else
   - the higher score, or on a tie `championId ?? 0`.

   This is the same rule as `endRound` in `game.ts`. Time-up is decided by game, not by scoring.
10. **Players already out** are not scored.

## Wiring

`src/main.ts` changes in two lines. The import of `createFakeScoring, loadMoves` from `./game/fake` becomes `createScoring, loadMoves` from `./scoring`, and the `createFakeScoring(...)` call becomes `createScoring(...)`. That's game's file, so the PR has to point both lines out for the game owner. `fake.ts` stays until game deletes it.

## Check

`src/scoring/scoring.test.mjs` runs with `node src/scoring/scoring.test.mjs` (plain JS, so tsc and vite ignore it; it loads the TS through Node 24 type stripping), with no new dependencies. The repo's imports have no file extension, which Node can't resolve on its own. The test therefore registers a small `module.registerHooks` resolve hook that adds `.ts`, then loads scoring with a dynamic import. This needs no tsconfig change.

- **Asserts on made-up frames:** perfect, good and miss, visibility skips, too few joints, absent player, the trap rules, losing lives and elimination, the champion rule, the tempo stepping one tier at a time, and deck order with no repeat.
- **Session report:** replay each file in `public/assets/sessions/` against all 10 moves and print the best grade per player, to check by eye.

## Done when

Recorded sessions produce sensible hits, misses and eliminations, `npm run build` passes, and a full round plays live with real scoring.
