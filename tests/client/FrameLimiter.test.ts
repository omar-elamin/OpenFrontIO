import { describe, expect, it } from "vitest";
import { FrameLimiter } from "../../src/client/FrameLimiter";

/** Which of one second of `hz` animation frames draw, as frame indexes. */
function drawnFrames(limiter: FrameLimiter, hz: number, jitterMs = 0) {
  const drawn: number[] = [];
  for (let i = 0; i < hz; i++) {
    // Alternate early and late frames to model timestamp jitter.
    const jitter = i % 2 === 0 ? -jitterMs : jitterMs;
    if (limiter.shouldDraw(5000 + (i * 1000) / hz + jitter)) drawn.push(i);
  }
  return drawn;
}

function limiterAt(fps: number | null): FrameLimiter {
  const limiter = new FrameLimiter();
  limiter.setMaxFps(fps);
  return limiter;
}

describe("FrameLimiter", () => {
  it("draws every 4th frame at 120 Hz: exactly 30 per second", () => {
    const drawn = drawnFrames(limiterAt(30), 120);
    expect(drawn).toHaveLength(30);
    expect(drawn.every((frame) => frame % 4 === 0)).toBe(true);
  });

  it("draws every 2nd frame at 60 Hz: exactly 30 per second", () => {
    const drawn = drawnFrames(limiterAt(30), 60);
    expect(drawn).toHaveLength(30);
    expect(drawn.every((frame) => frame % 2 === 0)).toBe(true);
  });

  it("keeps the steady cadence when frame times jitter", () => {
    const at120 = drawnFrames(limiterAt(30), 120, 0.5);
    expect(at120).toHaveLength(30);
    expect(at120.every((frame) => frame % 4 === 0)).toBe(true);
    const at60 = drawnFrames(limiterAt(30), 60, 0.5);
    expect(at60).toHaveLength(30);
    expect(at60.every((frame) => frame % 2 === 0)).toBe(true);
  });

  it("averages 30 per second on a 144 Hz display", () => {
    const limiter = limiterAt(30);
    let drawn = 0;
    for (let i = 0; i < 144 * 10; i++) {
      if (limiter.shouldDraw((i * 1000) / 144)) drawn++;
    }
    expect(drawn).toBe(300);
  });

  it("draws the first frame at once", () => {
    expect(limiterAt(30).shouldDraw(12345)).toBe(true);
  });

  it("draws at once after a long gap, without a catch-up burst", () => {
    const limiter = limiterAt(30);
    expect(limiter.shouldDraw(1000)).toBe(true);
    // A hidden tab or a stall: no frames for half a second.
    expect(limiter.shouldDraw(1500)).toBe(true);
    expect(limiter.shouldDraw(1500 + 1000 / 120)).toBe(false);
    expect(limiter.shouldDraw(1500 + 1000 / 30)).toBe(true);
  });

  it("draws the next frame after the cap changes", () => {
    const limiter = limiterAt(30);
    expect(limiter.shouldDraw(1000)).toBe(true);
    expect(limiter.shouldDraw(1008)).toBe(false);
    limiter.setMaxFps(30);
    expect(limiter.shouldDraw(1016)).toBe(true);
  });

  it("draws every frame when not capped", () => {
    expect(drawnFrames(new FrameLimiter(), 120)).toHaveLength(120);
    const limiter = limiterAt(30);
    limiter.setMaxFps(null);
    expect(drawnFrames(limiter, 120)).toHaveLength(120);
  });
});
