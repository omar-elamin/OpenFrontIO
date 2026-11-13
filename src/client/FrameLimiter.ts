// Animation-frame times jitter a little. Without this slack, a frame that
// lands a hair before its slot waits one more display frame and the next one
// makes up for it, so a 30 FPS cap on 60 Hz draws after gaps of 1 and 3
// frames instead of a steady 2.
const SLACK_MS = 2;

/** Decides which animation frames draw when the frame rate is capped. */
export class FrameLimiter {
  private intervalMs = 0;
  private lastDrawMs = -Infinity;

  /** Draw at most `fps` times a second, or on every frame when null. */
  setMaxFps(fps: number | null): void {
    this.intervalMs = fps === null ? 0 : 1000 / fps;
    this.lastDrawMs = -Infinity;
  }

  /** Whether the animation frame at `nowMs` should draw. */
  shouldDraw(nowMs: number): boolean {
    if (this.intervalMs === 0) return true;
    const elapsed = nowMs - this.lastDrawMs;
    if (elapsed < this.intervalMs - SLACK_MS) return false;
    // Step along a fixed grid so the average stays exact on any refresh rate
    // (144 Hz alternates gaps of 4 and 5 frames). After a long gap (hidden
    // tab, stall) restart the grid here rather than catch up with a burst.
    this.lastDrawMs =
      elapsed < 2 * this.intervalMs ? this.lastDrawMs + this.intervalMs : nowMs;
    return true;
  }
}
