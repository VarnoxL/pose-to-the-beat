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
const { createScoring, frameError, grade, keyJoints, poseDistance } = await import("./index.ts");
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
{ // a hidden left ankle drops leftKnee (not a key joint of chicken), so a wild leftKnee angle doesn't count
  const lms = landmarks(); lms[27].visibility = 0;
  const f = frame(0, 0, 0, lms); f.angles.leftKnee = target.leftKnee + 170;
  assert.equal(frameError(f, target), 0);
}
{ // a hidden left wrist drops leftElbow, a key joint of chicken: the frame can't judge chicken at all
  const lms = landmarks(); lms[15].visibility = 0;
  assert.equal(frameError(frame(0, 0, 0, lms), target), null);
}

// --- key joints: right_knee is defined by its right leg, so standing still with legs hidden can't match it
{
  const knee = moves.find((m) => m.id === "right_knee").target;
  assert.deepEqual(keyJoints(knee), ["rightHip", "rightKnee"]);
  const lms = landmarks(); for (const i of [25, 26, 27, 28]) lms[i].visibility = 0; // knees and ankles out of frame
  const still = { id: 0, t: 0, landmarks: lms, confidence: 1, angles: { ...config.standingPose } };
  assert.equal(frameError(still, knee), null, "legs hidden: right_knee can't be judged");
  assert.equal(keyJoints(config.standingPose).length, 0, "standing still has no key joints");
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

  // rand ~0 = trap whenever allowed: no traps early, and every trap is far from standing still and from the move before
  let seed2 = 11;
  const always = createScoring(moves, () => ((seed2 = (seed2 * 16807) % 2147483647) / 2147483647) * config.trapChance * 0.99);
  always.reset(null);
  const dealt2 = Array.from({ length: 200 }, (_, i) => always.nextMove(i));
  assert.ok(dealt2.slice(0, config.noTrapsBeforeMove).every((m) => m.cue === "sing"), "no traps early");
  const traps = dealt2.map((m, i) => [m, dealt2[i - 1]]).filter(([m], i) => i >= config.noTrapsBeforeMove && m.cue === "trap");
  assert.ok(traps.length > 50, `traps still happen (${traps.length}/200)`);
  for (const [m, prev] of traps) {
    assert.ok(poseDistance(m.target, config.standingPose) >= config.trapMinDistanceDeg, `${m.id} trap far from standing`);
    assert.ok(poseDistance(m.target, prev.target) >= config.trapMinDistanceDeg, `${m.id} trap far from ${prev.id}`);
  }
  for (const id of ["right_knee", "supermen"]) assert.ok(!traps.some(([m]) => m.id === id), `${id} is never a trap`);
}

// --- dealing: moves the camera can't judge aren't dealt (legs out of frame -> no leg moves)
{
  const s = createScoring(moves);
  s.reset(null);
  const lms = landmarks(); for (const i of [25, 26, 27, 28]) lms[i].visibility = 0;
  for (let k = 0; k < 10; k++) s.addFrame({ id: 0, t: k * 0.05, landmarks: lms, confidence: 1, angles: { ...config.standingPose } });
  const dealt3 = Array.from({ length: 40 }, (_, i) => s.nextMove(i).id);
  for (const id of ["right_knee", "sumo_squat"]) assert.ok(!dealt3.includes(id), `${id} not dealt while legs are hidden`);
  assert.equal(new Set(dealt3).size, 8, "the other 8 moves still all come up");
  for (let i = 1; i < dealt3.length; i++) assert.notEqual(dealt3[i], dealt3[i - 1], "no repeat");

  // player 0 walks out of view; player 1 keeps sending full-body frames. P0's stale legs-hidden frames stop counting.
  for (let k = 0; k < 40; k++) s.addFrame({ id: 1, t: 1 + k * 0.05, landmarks: landmarks(), confidence: 1, angles: { ...config.standingPose } });
  const dealt4 = Array.from({ length: 30 }, (_, i) => s.nextMove(100 + i).id);
  assert.ok(dealt4.includes("right_knee") && dealt4.includes("sumo_squat"), "leg moves come back once the stale frames age out");
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
