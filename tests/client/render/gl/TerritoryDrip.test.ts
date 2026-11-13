import { describe, expect, it } from "vitest";
import {
  dripBucketsPerFrame,
  TerritoryPass,
} from "../../../../src/client/render/gl/passes/TerritoryPass";
import { createRenderSettings } from "../../../../src/client/render/gl/RenderSettings";

const BUCKETS = createRenderSettings().tileDrip.bucketCount;

/** Time for one full drip cycle: every bucket drained once. */
function cycleMs(bucketCount: number, fps: number): number {
  const frames = Math.ceil(bucketCount / dripBucketsPerFrame(bucketCount, fps));
  return (frames * 1000) / fps;
}

// The drip state only, without GL: drainDripBuckets touches nothing else
// while a full upload is pending.
function makePass(tiles: number): TerritoryPass {
  const pass = Object.create(TerritoryPass.prototype) as TerritoryPass;
  Object.assign(pass, {
    mapW: tiles,
    cpuTileState: new Uint16Array(tiles),
    nBuckets: BUCKETS,
    dripBuckets: Array.from({ length: BUCKETS }, () => []),
    currentBucket: 0,
    bucketsPerFrame: 1,
    fullUploadPending: true,
    borderPatchConsumer: null,
    falloutTouched: false,
    tilesDirty: false,
  });
  return pass;
}

/** Frames until a tick that gives every tile to `owner` is fully applied. */
function framesToApply(pass: TerritoryPass, owner: number): number {
  const cpu = (pass as unknown as { cpuTileState: Uint16Array }).cpuTileState;
  const state = new Uint16Array(cpu.length).fill(owner);
  const changed = Array.from({ length: cpu.length }, (_, ref) => ref);
  pass.applyLiveDelta(state, changed);
  let frames = 0;
  while (cpu.some((tile) => tile !== owner) && frames < 100) {
    pass.drainDripBuckets();
    frames++;
  }
  return frames;
}

describe("territory drip below 60 FPS", () => {
  it("drains 3 of the 9 buckets per frame at 30 FPS", () => {
    expect(BUCKETS).toBe(9);
    expect(dripBucketsPerFrame(BUCKETS, 30)).toBe(3);
  });

  it("never takes longer for a full cycle at 30 FPS than at 60 FPS", () => {
    for (let buckets = 2; buckets <= 24; buckets++) {
      expect(cycleMs(buckets, 30)).toBeLessThanOrEqual(
        cycleMs(buckets, 60) + 1e-9,
      );
    }
  });

  it("drains one bucket per frame at 60 FPS and above", () => {
    for (const fps of [60, 120, 144]) {
      expect(dripBucketsPerFrame(BUCKETS, fps)).toBe(1);
    }
  });

  it("still spreads a tick's changes over several frames at 30 FPS", () => {
    const pass = makePass(1000);
    pass.setMaxFps(30);
    // 3 frames at 30 FPS = 100 ms, within the 150 ms of 9 frames at 60 FPS.
    expect(framesToApply(pass, 7)).toBe(3);
  });

  it("drains one bucket per frame when not capped", () => {
    const pass = makePass(1000);
    expect(framesToApply(pass, 7)).toBe(BUCKETS);
    pass.setMaxFps(30);
    pass.setMaxFps(null);
    expect(framesToApply(pass, 8)).toBe(BUCKETS);
  });
});
