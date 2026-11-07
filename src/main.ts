// Entry point. Game track owns this file; it wires vision -> scoring -> game.
import { createFakeScoring, startFakeVision } from "./game/fake";
import { createGame } from "./game/game";

const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;

// TODO when scoring merges: replace createFakeScoring() with the real createScoring().
const scoring = createFakeScoring();
const game = createGame(canvas, scoring, { onNewChallenger: (side) => bots.newChallenger(side) });

// TODO when vision merges: replace the bots with
//   const v = await startVision(game.onFrame, game.now); game.setVideo(v.video);
// (or startReplay(session, game.onFrame, game.now) for a recorded session).
const bots = startFakeVision(game.onFrame, game.now, game.upcoming);
