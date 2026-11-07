// Scoring check: rule asserts on made-up frames, then a report over the recorded sessions.
// Run: node src/scoring/scoring.test.mjs   (Node 24; plain JS so tsc and vite ignore it)
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";

// The repo imports without extensions ("../config"); let Node retry with .ts.
registerHooks({
  resolve(spec, ctx, next) {
    try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".")) return next(spec + ".ts", ctx); throw e; }
  },
});
const { createScoring, frameError, grade } = await import("./index.ts");
const { config } = await import("../config.ts");
const { JOINTS } = await import("../types.ts");

const root = new URL("../../public/assets/", import.meta.url);
const ids = ["chicken", "disco", "double_bi", "right_biceps", "right_knee", "six_seven", "sumo_squat", "supermen", "t_pose", "y_pose"];
const moves = ids.map((id) => JSON.parse(readFileSync(new URL(`moves/${id}.json`, root), "utf8")));
const target = moves[0].target;

const landmarks = (vis = 1) => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: vis }));
const frame = (id, t, offset = 0, lms = landmarks()) => ({
  id, t, landmarks: lms, confidence: 1,
  angles: Object.fromEntries(JOINTS.map((j) => [j, target[j] + offset])),
});
const sing = (beat = 0) => ({ id: moves[0].id, beat, target, cue: "sing" });
const trap = (beat = 0) => ({ ...sing(beat), cue: "trap" });
const types = (evs) => evs.map((e) => `${e.type}:${e.player}`);

// --- frameError / grade
assert.equal(grade(frameError(frame(0, 0, 0), target)), "perfect");
assert.equal(grade(frameError(frame(0, 0, config.goodMaxErrorDeg - 1), target)), "good");
assert.equal(grade(frameError(frame(0, 0, config.goodMaxErrorDeg + 1), target)), "miss");
{ // a hidden left wrist drops leftElbow, so a wild leftElbow angle doesn't count
  const lms = landmarks(); lms[15].visibility = 0;
  const f = frame(0, 0, 0, lms); f.angles.leftElbow = target.leftElbow + 170;
  assert.equal(frameError(f, target), 0);
}
assert.equal(frameError(frame(0, 0, 0, landmarks(0)), target), null, "no visible joints -> ignored");
assert.equal(grade(null), "miss");

// --- scoreMove: hit, window, absent player
{
  const s = createScoring(moves);
  s.reset(null);
  s.addFrame(frame(0, 1.0, 40));  // in window but a bad pose
  s.addFrame(frame(0, 1.1, 0));   // in window, perfect -> best one wins
  s.addFrame(frame(1, 1.5, 0));   // perfect but outside window
  assert.deepEqual(types(s.scoreMove(sing(), 1.0)), ["hit:0", "miss:1"]);
  assert.equal(s.state[0].score, config.points.perfect);
  assert.equal(s.state[0].combo, 1);
  assert.equal(s.state[1].lives, config.startingLives - 1, "absent/out-of-window = miss");
  // second miss eliminates p1; p0 is champion
  assert.deepEqual(types(s.scoreMove(sing(4), 5.0)), ["miss:0", "miss:1", "eliminated:1", "champion:0"]);
  assert.equal(s.state[0].combo, 0);
  assert.equal(s.state[1].alive, false);
}

// --- traps
{
  const s = createScoring(moves);
  s.reset(null);
  s.addFrame(frame(0, 1.0, 0));                 // p0 copies the trap
  s.addFrame(frame(1, 1.0, 80));                // p1 doesn't
  assert.deepEqual(types(s.scoreMove(trap(), 1.0)), ["trapFail:0", "eliminated:0", "champion:1"]);
  assert.equal(s.state[1].lives, config.startingLives, "a safe trap costs nothing");
  assert.equal(s.state[1].score, 0);
}

// --- tie goes to the champion when both go out on the same move
{
  const s = createScoring(moves);
  s.reset(1);
  s.addFrame(frame(0, 1.0, 0));
  s.addFrame(frame(1, 1.0, 0));
  assert.deepEqual(types(s.scoreMove(trap(), 1.0)), ["trapFail:0", "eliminated:0", "trapFail:1", "eliminated:1", "champion:1"]);
}

// --- tempo: one tier per call, follows the leader's flow
{
  const s = createScoring(moves);
  s.reset(null);
  assert.equal(s.tempoBpm(), config.tempoTiers[0].bpm);
  s.state[1].flow = 1;
  const bpms = config.tempoTiers.map(() => s.tempoBpm());
  assert.deepEqual(bpms, [...config.tempoTiers.slice(1).map((t) => t.bpm), config.tempoTiers.at(-1).bpm]);
  s.state[1].flow = 0;
  assert.equal(s.tempoBpm(), config.tempoTiers.at(-2).bpm, "steps down one at a time too");
}

// --- deck: every move once per pass, never twice in a row; no traps early
{
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const s = createScoring(moves, rand);
  s.reset(null);
  const dealt = Array.from({ length: 50 }, (_, i) => s.nextMove(i).id);
  for (let p = 0; p < 5; p++) assert.equal(new Set(dealt.slice(p * 10, p * 10 + 10)).size, 10, `pass ${p} deals all 10`);
  for (let i = 1; i < dealt.length; i++) assert.notEqual(dealt[i], dealt[i - 1], "no repeat");

  const always = createScoring(moves, () => 0); // rand 0 = trap whenever allowed
  always.reset(null);
  const cues = Array.from({ length: 5 }, (_, i) => always.nextMove(i).cue);
  assert.deepEqual(cues, [...Array(config.noTrapsBeforeMove).fill("sing"), ...Array(5 - config.noTrapsBeforeMove).fill("trap")]);
}

console.log("scoring rules: all asserts pass\n");

// --- session report: best grade per player per move, for eyeballing
for (const file of readdirSync(new URL("sessions/", root)).filter((f) => f.endsWith(".json"))) {
  const { frames } = JSON.parse(readFileSync(new URL(`sessions/${file}`, root), "utf8"));
  const players = [...new Set(frames.map((f) => f.id))].sort();
  const span = frames.length ? frames.at(-1).t - frames[0].t : 0;
  console.log(`${file}: ${frames.length} frames, ${span.toFixed(1)} s, players ${players.join(",")}`);
  for (const m of moves) {
    const row = players.map((id) => {
      let best = null;
      for (const f of frames) {
        if (f.id !== id) continue;
        const e = frameError(f, m.target);
        if (e !== null && (best === null || e < best)) best = e;
      }
      return `P${id} ${grade(best).padEnd(7)} ${best === null ? "  -  " : best.toFixed(1).padStart(5)}°`;
    });
    console.log(`  ${m.id.padEnd(13)} ${row.join("   ")}`);
  }
}
