// Stick-figure drawing: player skeletons from landmarks, and the character built from joint angles.
import { config } from "../config";
import type { Joint, Point } from "../types";

export type Rect = { x: number; y: number; w: number; h: number };

const BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

// Body proportions in units of frame height (stick figure ~0.8 tall at scale 1).
// Shoulders and hips share a width so the torso is vertical and the angles come back out exactly.
const BODY = { torso: 0.3, shoulderHalf: 0.09, hipHalf: 0.09, upperArm: 0.15, forearm: 0.14, thigh: 0.2, shin: 0.2, neck: 0.1 };

export const REST_POSE: Record<Joint, number> = {
  leftElbow: 170, rightElbow: 170, leftShoulder: 15, rightShoulder: 15,
  leftHip: 175, rightHip: 175, leftKnee: 178, rightKnee: 178,
};

/**
 * Forward kinematics: 33 landmarks (raw, unmirrored image coords, 0..1) that produce the given angles.
 * Angles are unsigned, so we pick a natural direction: arms swing out sideways (0 = down, 180 = up),
 * elbows bend inward/up, legs lift out sideways, knees fold back toward the centre.
 * `aspect` = width/height of the target image, so angles look right on screen.
 */
export function poseToLandmarks(a: Record<Joint, number>, hipX: number, hipY: number, scale: number, aspect: number): Point[] {
  const rad = (d: number) => (d * Math.PI) / 180;
  // Work in height units; x is divided by aspect at the end.
  const pts: [number, number][] = Array.from({ length: 33 }, () => [0, 0]);
  const L = (k: keyof typeof BODY) => BODY[k] * scale;
  const at = (p: [number, number], ang: number, len: number): [number, number] => [p[0] + Math.cos(ang) * len, p[1] + Math.sin(ang) * len];
  const cx = hipX * aspect;

  for (const s of [1, -1] as const) { // +1 = person's left = larger raw x
    const side = s === 1 ? "left" : "right";
    const sh: [number, number] = [cx + s * L("shoulderHalf"), hipY - L("torso")];
    const hip: [number, number] = [cx + s * L("hipHalf"), hipY];
    // Angle 0 = +x, y down. "Straight down" = PI/2; rotating outward on side s means toward +s x.
    const down = Math.PI / 2;
    const upperArm = down - s * rad(a[`${side}Shoulder`]);
    const elbow = at(sh, upperArm, L("upperArm"));
    const wrist = at(elbow, upperArm - s * (Math.PI - rad(a[`${side}Elbow`])), L("forearm"));
    const thigh = down - s * (Math.PI - rad(a[`${side}Hip`]));
    const knee = at(hip, thigh, L("thigh"));
    const ankle = at(knee, thigh + s * (Math.PI - rad(a[`${side}Knee`])), L("shin"));
    const [iSh, iEl, iWr, iHip, iKn, iAn] = s === 1 ? [11, 13, 15, 23, 25, 27] : [12, 14, 16, 24, 26, 28];
    pts[iSh] = sh; pts[iEl] = elbow; pts[iWr] = wrist; pts[iHip] = hip; pts[iKn] = knee; pts[iAn] = ankle;
  }
  pts[0] = [cx, hipY - L("torso") - L("neck")];

  return pts.map(([x, y], i) => ({ x: x / aspect, y, z: 0, visibility: i === 0 || (i >= 11 && i <= 16) || (i >= 23 && i <= 28) ? 1 : 0 }));
}

/** Call inside a mirrored transform (ctx.scale(-1, 1)); `rect` is in that mirrored space. */
export function drawSkeleton(ctx: CanvasRenderingContext2D, lm: Point[], rect: Rect, color: string, width: number) {
  const P = (i: number) => [rect.x + lm[i].x * rect.w, rect.y + lm[i].y * rect.h] as const;
  const ok = (i: number) => lm[i] && lm[i].visibility >= config.minJointVisibility;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const [a, b] of BONES) {
    if (!ok(a) || !ok(b)) continue;
    ctx.moveTo(...P(a));
    ctx.lineTo(...P(b));
  }
  ctx.stroke();
  if (ok(0) && ok(11) && ok(12)) {
    const [hx, hy] = P(0);
    const r = Math.hypot(P(11)[0] - P(12)[0], P(11)[1] - P(12)[1]) * 0.45;
    ctx.beginPath();
    ctx.arc(hx, hy, Math.max(r, width), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Run `draw` with the canvas mirrored horizontally (SPEC decision 5). */
export function mirrored(ctx: CanvasRenderingContext2D, draw: () => void) {
  ctx.save();
  ctx.translate(ctx.canvas.width, 0);
  ctx.scale(-1, 1);
  draw();
  ctx.restore();
}
