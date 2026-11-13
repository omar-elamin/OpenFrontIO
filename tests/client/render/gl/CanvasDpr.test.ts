import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../../../src/client/render/gl/Camera";
import { CrosshairPass } from "../../../../src/client/render/gl/passes/CrosshairPass";
import { TextProgram } from "../../../../src/client/render/gl/passes/name-pass/TextProgram";
import { CHAR_RANGE } from "../../../../src/client/render/gl/passes/name-pass/Types";
import { NukeTrajectoryPass } from "../../../../src/client/render/gl/passes/NukeTrajectoryPass";
import { StructureLevelPass } from "../../../../src/client/render/gl/passes/StructureLevelPass";
import { WorldTextPass } from "../../../../src/client/render/gl/passes/WorldTextPass";
import { GPURenderer } from "../../../../src/client/render/gl/Renderer";
import { createRenderSettings } from "../../../../src/client/render/gl/RenderSettings";
import {
  canvasDpr,
  renderDpr,
  setMaxCanvasDpr,
} from "../../../../src/client/render/gl/utils/Dpr";

afterEach(() => {
  setMaxCanvasDpr(Infinity);
  window.devicePixelRatio = 1;
});

/** An instance with just `fields` set, skipping the GL setup. */
function bare<T>(cls: { prototype: T }, fields: object): T {
  return Object.assign(Object.create(cls.prototype) as T, fields);
}

function resize(cssWidth: number, cssHeight: number) {
  const canvas = { width: 0, height: 0 };
  const camera = new Camera(2000, 1000);
  bare(GPURenderer, { canvas, camera }).resize(cssWidth, cssHeight);
  // ClientGameRunner pushes zoom as CSS scale × renderDpr().
  camera.setCameraState(700, 400, 1.5 * renderDpr());
  return { canvas, camera };
}

/** A stand-in GL context for a canvas, recording every call made on it. */
function recordingGl(canvas: { width: number; height: number }) {
  const calls: unknown[][] = [];
  const gl = new Proxy(
    { drawingBufferWidth: canvas.width, drawingBufferHeight: canvas.height },
    {
      get: (target, key) =>
        key in target
          ? target[key as keyof typeof target]
          : (...args: unknown[]) => calls.push([key, ...args]),
    },
  ) as unknown as WebGL2RenderingContext;
  const uniform = (method: string, location: string) =>
    calls.find((call) => call[0] === method && call[1] === location)?.slice(2);
  return { gl, uniform };
}

describe("canvasDpr", () => {
  it("is min(devicePixelRatio, 2) without a cap", () => {
    for (const dpr of [1, 1.5, 2, 3]) {
      window.devicePixelRatio = dpr;
      expect(canvasDpr()).toBe(Math.min(dpr, 2));
    }
  });

  it("is 1 under fast mode's cap, while renderDpr stays the same", () => {
    setMaxCanvasDpr(1);
    for (const dpr of [1, 1.5, 2, 3]) {
      window.devicePixelRatio = dpr;
      expect(canvasDpr()).toBe(1);
      expect(renderDpr()).toBe(Math.min(dpr, 2));
    }
  });
});

describe("the canvas DPR cap", () => {
  it("draws a 1x canvas without moving or resizing the map", () => {
    window.devicePixelRatio = 2;
    const full = resize(1280, 800);
    setMaxCanvasDpr(1);
    const fast = resize(1280, 800);

    expect(full.canvas).toEqual({ width: 2560, height: 1600 });
    expect(fast.canvas).toEqual({ width: 1280, height: 800 });
    // Same world → clip matrix, and the same zoom for every pass that sizes
    // icons, text and rails or picks a detail level from it.
    expect(fast.camera.getMatrix()).toEqual(full.camera.getMatrix());
    expect(fast.camera.zoom).toBe(full.camera.zoom);
    expect(fast.camera.worldToScreen(321, 123)).toEqual(
      full.camera.worldToScreen(321, 123),
    );
  });

  it("keeps the crosshair and nuke trajectory the same size", () => {
    const draw = () => {
      const { canvas, camera } = resize(1280, 800);
      const { gl, uniform } = recordingGl(canvas);
      bare(CrosshairPass, {
        gl,
        uViewport: "uViewport",
        active: true,
        blockedXTile: null,
      }).draw(camera.getMatrix());
      bare(NukeTrajectoryPass, {
        gl,
        settings: createRenderSettings(),
        uLinePixelSize: "uLinePixelSize",
        visible: true,
        data: {
          p0x: 0,
          p0y: 0,
          p1x: 10,
          p1y: 10,
          p2x: 20,
          p2y: 10,
          p3x: 30,
          p3y: 0,
          tUntargetableStart: -1,
          tUntargetableEnd: -1,
          tSamIntercept: 1,
        },
      }).draw(camera.getMatrix());
      return {
        viewport: uniform("uniform2f", "uViewport"),
        pixelSize: uniform("uniform1f", "uLinePixelSize")?.[0],
      };
    };

    window.devicePixelRatio = 2;
    const full = draw();
    setMaxCanvasDpr(1);
    const fast = draw();

    // The crosshair's pixel offsets are measured against a 2x viewport either
    // way, and the trajectory's line widths use the same world size per pixel.
    expect(full.viewport).toEqual([2560, 1600]);
    expect(fast.viewport).toEqual([2560, 1600]);
    expect(full.pixelSize).toBeCloseTo(1 / 3, 6);
    expect(fast.pixelSize).toBe(full.pixelSize);
  });

  it("keeps text outlines and the name hover glow the same width", () => {
    const settings = createRenderSettings();
    const matrix = new Float32Array(9);
    const draw = () => {
      const names = recordingGl({ width: 0, height: 0 });
      bare(TextProgram, {
        gl: names.gl,
        atlasReady: true,
        textures: {},
        uOutlineWidth: "uOutlineWidth",
        uHoverGlowWidth: "uHoverGlowWidth",
      }).draw(matrix, settings, {} as WebGLVertexArrayObject, 1, 0, -1, -1);

      const levels = recordingGl({ width: 0, height: 0 });
      bare(StructureLevelPass, {
        gl: levels.gl,
        settings,
        lastUnits: null,
        msdf: { atlasReady: true },
        classic: { atlasReady: true },
        instanceCount: 1,
        uOutlineWidth: "uOutlineWidth",
      }).draw(matrix, 1);

      const worldText = bare(WorldTextPass, {
        glyph: {
          advance: new Float32Array(CHAR_RANGE).fill(10),
          xOffset: new Float32Array(CHAR_RANGE).fill(0),
          visW: new Float32Array(CHAR_RANGE).fill(10),
        },
        kernTable: new Int8Array(CHAR_RANGE * CHAR_RANGE),
        charCodes: new Uint8Array(64),
        cursors: new Float32Array(64),
        maxInstances: 16,
        instanceData: new Float32Array(16 * 10),
        active: [],
        attackTroopLabels: [
          { x: 0, y: 0, text: "5", colorR: 1, colorG: 1, colorB: 1 },
        ],
        ghostCostLabel: null,
        timeFn: () => 0,
      });
      worldText.tick(1);
      const { instanceData } = worldText as unknown as {
        instanceData: Float32Array;
      };

      return {
        nameOutline: Number(names.uniform("uniform1f", "uOutlineWidth")?.[0]),
        nameGlow: Number(names.uniform("uniform1f", "uHoverGlowWidth")?.[0]),
        levelOutline: Number(levels.uniform("uniform1f", "uOutlineWidth")?.[0]),
        // The attack label's outline width: float 9 of its instance.
        worldTextOutline: instanceData[9],
      };
    };

    window.devicePixelRatio = 2;
    const full = draw();
    setMaxCanvasDpr(1);
    const fast = draw();

    // The shaders measure these widths in canvas pixels. A 1x canvas has half
    // as many per CSS pixel, so half the width keeps the same on-screen size.
    expect(full.nameOutline).toBe(settings.name.outlineWidth);
    expect(full.nameGlow).toBe(settings.name.hoverGlowWidth);
    expect(full.levelOutline).toBe(settings.structureLevel.outlineWidth);
    expect(full.worldTextOutline).toBeCloseTo(1.2, 6);
    expect(fast).toEqual({
      nameOutline: full.nameOutline / 2,
      nameGlow: full.nameGlow / 2,
      levelOutline: full.levelOutline / 2,
      worldTextOutline: full.worldTextOutline / 2,
    });
  });
});
