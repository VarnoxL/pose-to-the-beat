// An image popping in and out around the screen during a round (the neon notes): several copies, each appearing at a random spot, lingering, then fading away,
// staggered so they don't all change at once. A pure function of the audio clock, so nothing to
// update between frames except the round fade.
import { config } from "../config";

type PopConfig = typeof config.popFx.notes;

/** Deterministic 0..1 hash so a copy's spot for a given cycle stays put while it's on screen. */
const rand = (a: number, b: number, k: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

export function createPopFx(src: string, fx: PopConfig, seed: number) {
  const img = new Image();
  img.src = src;
  let fade = 0;
  let lastT = 0;

  /** t = AudioContext time, active = a round is being played, pulse = 1 on the beat decaying to 0. */
  return function draw(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, active: boolean, pulse: number) {
    const dt = Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    fade = Math.max(0, Math.min(1, fade + (active ? dt : -dt) / config.popFx.roundFadeSec));
    if (fade <= 0 || !img.complete || !img.naturalWidth) return;

    const period = fx.showSec + fx.gapSec;
    ctx.save();
    ctx.globalCompositeOperation = fx.blend;
    for (let i = 0; i < fx.copies; i++) {
      const id = i + seed * 100;
      const local = t + (i * period) / fx.copies + seed; // stagger the copies evenly
      const cycle = Math.floor(local / period);
      const age = local - cycle * period;
      if (age > fx.showSec) continue; // in its gap: hidden
      const appear = Math.min(1, age / fx.inOutSec, (fx.showSec - age) / fx.inOutSec); // 0 → 1 → 0
      const ease = appear * appear * (3 - 2 * appear);

      const x = (fx.margin + (1 - 2 * fx.margin) * rand(id, cycle, 1)) * W;
      const y = (fx.margin + (1 - 2 * fx.margin) * rand(id, cycle, 2)) * H;
      const size = (fx.minSize + (fx.maxSize - fx.minSize) * rand(id, cycle, 3)) * H;
      const scale = size / Math.max(img.naturalWidth, img.naturalHeight);
      const k = scale * (0.6 + 0.4 * ease) * (1 + fx.beatPop * pulse); // grows in, shrinks out, pops on the beat
      const tilt = (rand(id, cycle, 4) - 0.5) * 2 * fx.maxTiltRad + Math.sin(t * 2 + i) * 0.05;
      const flip = rand(id, cycle, 5) < 0.5 ? -1 : 1; // half the copies mirrored, for variety

      ctx.globalAlpha = fade * fx.alpha * ease;
      ctx.setTransform(k * flip, 0, 0, k, x, y);
      ctx.rotate(tilt * flip);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    }
    ctx.restore();
  };
}
