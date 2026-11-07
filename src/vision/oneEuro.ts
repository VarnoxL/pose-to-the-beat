// One Euro filter (Casiez et al. 2012): low lag when moving fast, low jitter when still.
import { config } from "../config";

const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

export class OneEuro {
  private x?: number;
  private dx = 0;
  private t = 0;

  filter(x: number, t: number): number {
    const { minCutoff, beta, dCutoff } = config.oneEuro;
    const dt = t - this.t;
    if (this.x === undefined || dt <= 0) {
      if (this.x === undefined) this.x = x;
      this.t = t;
      return this.x;
    }
    this.dx += alpha(dCutoff, dt) * ((x - this.x) / dt - this.dx);
    this.x += alpha(minCutoff + beta * Math.abs(this.dx), dt) * (x - this.x);
    this.t = t;
    return this.x;
  }
}
