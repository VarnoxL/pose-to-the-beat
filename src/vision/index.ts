// Vision track: webcam -> MediaPipe -> One Euro -> angles -> PlayerFrame. Replay and recorder feed the same callback.
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { JOINTS, type Joint, type PlayerFrame, type Point } from "../types";
import { OneEuro } from "./oneEuro";

export type Session = { recordedAt: string; frames: PlayerFrame[] };
type OnFrame = (f: PlayerFrame) => void;

// [a, middle, c] MediaPipe indices; the angle is measured at the middle landmark (SPEC "Joint angles").
const JOINT_LANDMARKS: Record<Joint, [number, number, number]> = {
  leftElbow: [11, 13, 15], rightElbow: [12, 14, 16],
  leftShoulder: [23, 11, 13], rightShoulder: [24, 12, 14],
  leftHip: [11, 23, 25], rightHip: [12, 24, 26],
  leftKnee: [23, 25, 27], rightKnee: [24, 26, 28],
};
const USED = [...new Set(Object.values(JOINT_LANDMARKS).flat())];

/** 2D angle at b in degrees, 0..180. x is scaled by the image aspect so angles match what the eye sees. */
function angleAt(a: Point, b: Point, c: Point, aspect: number): number {
  const v1x = (a.x - b.x) * aspect, v1y = a.y - b.y;
  const v2x = (c.x - b.x) * aspect, v2y = c.y - b.y;
  const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

export function toFrame(id: 0 | 1, t: number, landmarks: Point[], aspect: number): PlayerFrame {
  const angles = {} as Record<Joint, number>;
  for (const j of JOINTS) {
    const [a, b, c] = JOINT_LANDMARKS[j];
    angles[j] = angleAt(landmarks[a], landmarks[b], landmarks[c], aspect);
  }
  const confidence = USED.reduce((s, i) => s + landmarks[i].visibility, 0) / USED.length;
  return { id, t, angles, landmarks, confidence };
}

/**
 * Screen-half player ids (SPEC "Player assignment"). Returns [id, pose] pairs.
 * `loneId` = id of a lone player from earlier frames: they keep it instead of flipping when they cross the middle.
 */
export function assignPlayers(poses: Point[][], loneId?: 0 | 1): [0 | 1, Point[]][] {
  const screenX = (p: Point[]) => 1 - (p[23].x + p[24].x) / 2; // view is mirrored
  if (poses.length === 1) return [[loneId ?? (screenX(poses[0]) < 0.5 ? 0 : 1), poses[0]]];
  const [a, b] = [...poses].sort((p, q) => screenX(p) - screenX(q));
  return b ? [[0, a], [1, b]] : [];
}

/** Live webcam. `now()` = audio-clock seconds minus lag offset (game supplies it). */
export async function startVision(onFrame: OnFrame, now: () => number) {
  const video = document.createElement("video");
  video.muted = video.playsInline = true;
  video.srcObject = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 360, facingMode: "user" }, // model works at 256px internally; a smaller frame is cheaper to hand it
    audio: false,
  });
  await video.play();

  const fileset = await FilesetResolver.forVisionTasks("mediapipe/wasm");
  const landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: "mediapipe/pose_landmarker_lite.task", delegate: "CPU" }, // ponytail: GPU (WebGL) was 110ms vs CPU 40ms on the dev laptop; try GPU again if a target machine is CPU-starved
    runningMode: "VIDEO",
    numPoses: 2,
  });

  // One filter per player, landmark and axis. Visibility is passed through raw.
  const filters = [0, 1].map(() => Array.from({ length: 33 }, () => [new OneEuro(), new OneEuro(), new OneEuro()]));
  let lastVideoTime = -1, lastTs = 0, running = true, raf = 0, loneId: 0 | 1 | undefined;
  const stats = { detectMs: 0 }; // dev readout only; wall-clock is fine here, nothing is timed off it

  const loop = () => {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (video.currentTime === lastVideoTime) return; // no new camera frame yet
    lastVideoTime = video.currentTime;
    const t = now();
    lastTs = Math.max(lastTs + 1, Math.round(t * 1000)); // MediaPipe needs strictly increasing ms
    const d0 = performance.now();
    const result = landmarker.detectForVideo(video, lastTs);
    stats.detectMs = performance.now() - d0;
    const aspect = video.videoWidth / video.videoHeight;
    const players = assignPlayers(result.landmarks as Point[][], loneId);
    // Sticky through frames with no pose (tracking blips); two players reset it to screen halves.
    if (players.length) loneId = players.length === 1 ? players[0][0] : undefined;
    for (const [id, raw] of players) {
      const smooth = raw.map((p, i) => {
        const [fx, fy, fz] = filters[id][i];
        return { x: fx.filter(p.x, t), y: fy.filter(p.y, t), z: fz.filter(p.z, t), visibility: p.visibility };
      });
      onFrame(toFrame(id, t, smooth, aspect));
    }
  };
  loop();

  return {
    video,
    stats,
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      (video.srcObject as MediaStream).getTracks().forEach((tr) => tr.stop());
      landmarker.close();
    },
  };
}

/** Plays a recorded session through `onFrame`, rebased so frame t=0 lands at the current `now()`. */
export function startReplay(session: Session, onFrame: OnFrame, now: () => number, loop = true) {
  const frames = session.frames;
  const duration = frames.length ? frames[frames.length - 1].t : 0;
  let t0 = now(), i = 0, running = true, raf = 0;
  const tick = () => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const elapsed = now() - t0;
    while (i < frames.length && frames[i].t <= elapsed) {
      onFrame({ ...frames[i], t: t0 + frames[i].t });
      i++;
    }
    if (i >= frames.length && loop && elapsed > duration) (t0 = now()), (i = 0);
  };
  tick();
  return { stop: () => ((running = false), cancelAnimationFrame(raf)) };
}

/** Collects frames; `download()` saves a Session JSON with t rebased to 0. */
export function createRecorder() {
  let frames: PlayerFrame[] = [];
  return {
    add: (f: PlayerFrame) => void frames.push(f),
    get count() { return frames.length; },
    clear: () => void (frames = []),
    download(name = "session") {
      const t0 = frames[0]?.t ?? 0;
      const session: Session = { recordedAt: new Date().toISOString(), frames: frames.map((f) => ({ ...f, t: f.t - t0 })) };
      downloadJson(session, `${name}.json`);
    },
  };
}

export function downloadJson(data: unknown, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
