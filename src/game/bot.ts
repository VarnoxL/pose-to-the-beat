// Bot players: copy the character's moves with mistakes, emitting PlayerFrames like vision does.
// Used for "you vs bot" mode (bot on the right) and the ?demo page (two bots, no camera).
import { config } from "../config";
import { JOINTS, type Joint, type Move, type PlayerFrame } from "../types";
import type { Upcoming } from "./game";
import { REST_POSE, poseToLandmarks } from "./pose";

// Plans are keyed by the Move object, not its beat: beat numbers restart every round, so a beat key made a bot
// that survived a round replay last round's poses against the new moves.
type Bot = { skill: number; pose: Record<Joint, number>; plan: WeakMap<Move, Record<Joint, number>> };
const newBot = (): Bot => ({
  skill: config.bot.skillMin + Math.random() * (config.bot.skillMax - config.bot.skillMin),
  pose: { ...REST_POSE },
  plan: new WeakMap(),
});

/** `ids()` says which player slots the bots fill right now (e.g. [1] in bot mode, [] in 1v1). */
export function startBots(onFrame: (f: PlayerFrame) => void, now: () => number, upcoming: () => Upcoming, ids: () => (0 | 1)[]) {
  const bots = [newBot(), newBot()];
  let last = now();

  const decide = (bot: Bot, move: Move) => {
    const copies = Math.random() < (move.cue === "sing" ? bot.skill : config.bot.trapGullibility);
    if (!copies) return { ...REST_POSE };
    const out = {} as Record<Joint, number>;
    for (const j of JOINTS) out[j] = Math.max(0, Math.min(180, move.target[j] + (Math.random() * 2 - 1) * config.bot.noiseDeg));
    return out;
  };

  const loop = () => {
    requestAnimationFrame(loop);
    const t = now();
    const dt = t - last;
    if (dt < 1 / config.bot.fps) return; // also idles while the AudioContext is suspended
    last = t;
    const up = upcoming();
    for (const id of ids()) {
      const bot = bots[id];
      let goal = bot.pose;
      if (up && up.beatTime - t < config.bot.reactSec) {
        if (!bot.plan.has(up.move)) bot.plan.set(up.move, decide(bot, up.move));
        goal = bot.plan.get(up.move)!;
      }
      const k = 1 - Math.exp(-Math.min(dt, 0.1) * config.bot.speed);
      for (const j of JOINTS) bot.pose[j] += (goal[j] - bot.pose[j]) * k;
      const hipX = (id === 0 ? 0.73 : 0.27) + Math.sin(t * 2 + id) * 0.01; // raw x; screen x = 1 - x
      onFrame({ id, t, angles: { ...bot.pose }, landmarks: poseToLandmarks(bot.pose, hipX, 0.6, 0.7, 16 / 9), confidence: 0.95 });
    }
  };
  loop();

  return {
    /** A fresh bot (new skill roll) in that slot. */
    replace(id: 0 | 1) { bots[id] = newBot(); },
  };
}
