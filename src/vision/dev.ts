// Dev harness: live or replayed skeletons, recorder, and move capture. Open /src/vision/dev.html.
import { PoseLandmarker } from "@mediapipe/tasks-vision";
import { config } from "../config";
import type { MoveDef, PlayerFrame } from "../types";
import { assignPlayers, createRecorder, downloadJson, startReplay, startVision, toFrame, type Session } from "./index";
import { OneEuro } from "./oneEuro";

const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
const ctx = canvas.getContext("2d")!;
const info = document.querySelector<HTMLPreElement>("#info")!;
const audio = new AudioContext();
const lagMs = Number(localStorage.getItem(config.lagOffsetStorageKey) ?? config.lagOffsetMsDefault);
const now = () => audio.currentTime - lagMs / 1000;

const latest: (PlayerFrame | undefined)[] = [];
const recorder = createRecorder();
let recording = false, video: HTMLVideoElement | undefined, stop = () => {}, frames = 0, fps = 0, fpsT = 0;
let stats = { detectMs: 0 }, camFrames = 0, camFps = 0;
const countCam = () => { camFrames++; video?.requestVideoFrameCallback(countCam); };

const onFrame = (f: PlayerFrame) => {
  latest[f.id] = f;
  frames++;
  if (recording) recorder.add(f);
};

document.querySelector("#cam")!.addEventListener("click", async () => {
  await audio.resume();
  stop();
  const v = await startVision(onFrame, now);
  video = v.video;
  stats = v.stats;
  stop = v.stop;
  video.requestVideoFrameCallback(countCam);
});

document.querySelector<HTMLInputElement>("#file")!.addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  await audio.resume();
  stop();
  video = undefined;
  latest.length = 0;
  const session: Session = JSON.parse(await file.text());
  stop = startReplay(session, onFrame, now).stop;
});

addEventListener("keydown", (e) => {
  if (e.key === "r") {
    if (recording) recorder.download(`session_${Date.now()}`), recorder.clear();
    recording = !recording;
  }
  if (e.key === "m" && !e.repeat) {
    const id = prompt(`Move id (e.g. arms_up). Saved ${CAPTURE_DELAY_S}s after OK: get into the pose.`)?.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (id) capture = { id, at: now() + CAPTURE_DELAY_S };
  }
});

// Move capture: countdown so one person can press M and walk back; saves the clearest fresh player, not the presser.
const CAPTURE_DELAY_S = 5;
let capture: { id: string; at: number } | undefined, captureMsg = "";
function saveCapture(t: number) {
  const { id } = capture!;
  capture = undefined;
  const f = latest.filter((p) => p && t - p.t < 0.5).sort((a, b) => b!.confidence - a!.confidence)[0];
  if (!f) return void (captureMsg = `${id}: nobody in view, not saved`);
  const move: MoveDef = { id, name: id.replace(/_/g, " "), target: f.angles };
  downloadJson(move, `${id}.json`);
  captureMsg = `${id}: saved P${f.id} conf ${f.confidence.toFixed(2)}${f.confidence < config.minJointVisibility ? " (LOW, redo)" : ""}`;
}

const COLORS = ["#4cf", "#f6a"];
function draw() {
  requestAnimationFrame(draw);
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  const { width: w, height: h } = canvas;
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1); // mirrored view; landmarks stay raw
  if (video) ctx.drawImage(video, 0, 0, w, h);
  else (ctx.fillStyle = "#111"), ctx.fillRect(0, 0, w, h);
  const t = now();
  if (capture && t >= capture.at) saveCapture(t);
  for (const f of latest) {
    if (!f || t - f.t > 0.5) continue; // stale: player left the frame
    ctx.strokeStyle = ctx.fillStyle = COLORS[f.id];
    ctx.lineWidth = 4;
    for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
      const a = f.landmarks[start], b = f.landmarks[end];
      if (Math.min(a.visibility, b.visibility) < config.minJointVisibility) continue;
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }
  }
  ctx.restore();
  if (capture) {
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${h / 3}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(String(Math.ceil(capture.at - t)), w / 2, h / 2);
  }

  if (t - fpsT >= 1) (fps = frames / (t - fpsT)), (camFps = camFrames / (t - fpsT)), (frames = camFrames = 0), (fpsT = t);
  const track = (video?.srcObject as MediaStream | undefined)?.getVideoTracks()[0]?.getSettings();
  info.textContent =
    `${recording ? `● REC ${recorder.count}` : ""} ${captureMsg}\nplayer-frames/s ${fps.toFixed(0)}  lag ${lagMs}ms\n` +
    (track ? `camera ${camFps.toFixed(0)}fps (reports ${track.frameRate?.toFixed(0)}, ${track.width}x${track.height})  detect ${stats.detectMs.toFixed(0)}ms\n` : "") +
    latest.map((f) => f && `P${f.id} conf ${f.confidence.toFixed(2)}\n` +
      Object.entries(f.angles).map(([j, a]) => `  ${j.padEnd(14)}${a.toFixed(0)}`).join("\n")).join("\n");
}
draw();

// Self-check: angles, player assignment and the filter. Results land in the console on load.
{
  const pt = (x: number, y: number) => ({ x, y, z: 0, visibility: 1 });
  const pose = (hipX: number) => Array.from({ length: 33 }, () => pt(hipX, 0.5));
  // Right angle at the elbow: shoulder above, wrist to the side.
  const lm = pose(0.5);
  lm[11] = pt(0.5, 0.3); lm[13] = pt(0.5, 0.5); lm[15] = pt(0.6, 0.5);
  const f = toFrame(0, 0, lm, 1);
  console.assert(Math.abs(f.angles.leftElbow - 90) < 1e-6, "elbow 90", f.angles.leftElbow);
  // Aspect: 0.1 normalized x at 16:9 is wider than 0.1 y, so a "45°" in normalized space isn't 45° on screen.
  lm[15] = pt(0.6, 0.4);
  console.assert(Math.abs(toFrame(0, 0, lm, 16 / 9).angles.leftElbow - 45) > 5, "aspect scales x");
  // Raw x 0.8 is screen x 0.2 (mirrored), so it's player 0.
  const ids = assignPlayers([pose(0.2), pose(0.8)]);
  console.assert(ids[0][1][23].x === 0.8 && ids[1][1][23].x === 0.2, "sort by mirrored screen x");
  console.assert(assignPlayers([pose(0.2)])[0][0] === 1, "single pose on screen right = player 1");
  console.assert(assignPlayers([pose(0.6)], 1)[0][0] === 1, "lone player keeps id after crossing the middle");
  console.assert(assignPlayers([pose(0.2), pose(0.8)], 1)[0][0] === 0, "two players ignore loneId");
  const oe = new OneEuro();
  oe.filter(0, 0);
  const v = oe.filter(1, 1 / 30);
  console.assert(v > 0 && v < 1, "filter smooths a step", v);
  console.log("vision self-check done");
}
