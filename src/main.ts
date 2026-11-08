// Entry point. Game track owns this file; it wires vision -> scoring -> game.
//   (default)       live webcam, 1v1; press B on the title for you vs bot
//   ?bot            SPACE on the title starts you vs bot (same as pressing B)
//   ?log            download round_<time>.json after every round (moves, grades, best error and timing, raw frames)
//   ?demo           two bots, no camera (dev / backup video)
//   ?replay=<name>  feed public/assets/sessions/<name>.json instead of the camera
import { config } from "./config";
import type { PlayerFrame } from "./types";
import { startBots } from "./game/bot";
import { createScoring, loadMoves } from "./scoring";
import { createGame } from "./game/game";
import { startReplay, startVision, type Session } from "./vision";

const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
const params = new URLSearchParams(location.search);
const demo = params.has("demo");
const replay = params.get("replay");

const scoring = createScoring(await loadMoves());
const game = createGame(canvas, scoring, {
  spaceMode: params.has("bot") ? "bot" : "duo",
  log: params.has("log"),
  onNewChallenger: (side, mode) => { if (demo || (mode === "bot" && side === 1)) bots.replace(side); },
});
const bots = startBots(game.onFrame, game.now, game.upcoming, () => (demo ? [0, 1] : game.mode === "bot" ? [1] : []));

// Camera (or replay) frames. In bot mode the one human is always slot 0 (left), whatever half vision gave them.
const lastSeen = [-Infinity, -Infinity];
function onHumanFrame(f: PlayerFrame) {
  lastSeen[f.id] = f.t;
  if (game.mode !== "bot") return game.onFrame(f);
  if (f.id === 1 && f.t - lastSeen[0] < config.playerGoneSec) return; // two people in bot mode: the left one plays
  game.onFrame({ ...f, id: 0 });
}

if (replay) {
  fetch(`assets/sessions/${replay}.json`)
    .then((r) => r.json() as Promise<Session>)
    .then((s) => startReplay(s, onHumanFrame, game.now))
    .catch(() => game.setStatus(`Couldn't load session "${replay}"`));
} else if (!demo) {
  startVision(onHumanFrame, game.now)
    .then((v) => game.setVideo(v.video))
    .catch((e) => game.setStatus(`Camera unavailable (${e?.name ?? e}). Try ?demo for bots only.`));
}
