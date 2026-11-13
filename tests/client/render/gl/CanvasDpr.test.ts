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
import nameFrag from "../../../../src/client/render/gl/shaders/name/name.frag.glsl?raw";
import structureLevelFrag from "../../../../src/client/render/gl/shaders/structure-level/structure-level.frag.glsl?raw";
import worldTextFrag from "../../../../src/client/render/gl/shaders/world-text/world-text.frag.glsl?raw";
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
function bare<T extends object>(cls: { prototype: T }, fields: object): T {
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

/** Draws the three MSDF text passes and records their outline inputs. */
function drawText() {
  const settings = createRenderSettings();
  const matrix = new Float32Array(9);
  const uniform1f = (rec: ReturnType<typeof recordingGl>, name: string) =>
    Number(rec.uniform("uniform1f", name)?.[0]);

  const names = recordingGl({ width: 0, height: 0 });
  bare(TextProgram, {
    gl: names.gl,
    atlasReady: true,
    textures: {},
    uOutlineWidth: "uOutlineWidth",
    uHoverGlowWidth: "uHoverGlowWidth",
    uRenderPx: "uRenderPx",
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
    uRenderPx: "uRenderPx",
  }).draw(matrix, 1);

  const texts = recordingGl({ width: 0, height: 0 });
  const worldText = bare(WorldTextPass, {
    gl: texts.gl,
    settings,
    atlasReady: true,
    uRenderPx: "uRenderPx",
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
  worldText.draw(matrix, 1);
  const { instanceData } = worldText as unknown as {
    instanceData: Float32Array;
  };

  return {
    settings,
    name: {
      outline: uniform1f(names, "uOutlineWidth"),
      glow: uniform1f(names, "uHoverGlowWidth"),
      renderPx: uniform1f(names, "uRenderPx"),
    },
    level: {
      outline: uniform1f(levels, "uOutlineWidth"),
      renderPx: uniform1f(levels, "uRenderPx"),
    },
    worldText: {
      // The attack label's outline width: float 9 of its instance.
      outline: instanceData[9],
      renderPx: uniform1f(texts, "uRenderPx"),
    },
  };
}

/**
 * The MSDF text shaders' outline clamp, ported. `rangePx` is screenPxRange,
 * the glyph's SDF range in canvas pixels; the widths are in canvas pixels too.
 */
function clampOutline(rangePx: number, width: number, renderPx: number) {
  const maxOutline = Math.max(rangePx * 0.5 - renderPx, 0);
  const outline = Math.min(width, maxOutline);
  return { outline, room: Math.max(maxOutline - outline, 0) };
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

  it("never raises the resolution: a 0.8 display stays at 0.8", () => {
    window.devicePixelRatio = 0.8;
    setMaxCanvasDpr(1);
    expect(canvasDpr()).toBe(0.8);
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

  it("halves the text outline and hover glow widths on a 1x canvas", () => {
    window.devicePixelRatio = 2;
    const full = drawText();
    setMaxCanvasDpr(1);
    const fast = drawText();

    // The shaders measure these widths in canvas pixels. A 1x canvas has half
    // as many per CSS pixel, so half the width keeps the same on-screen size.
    const { settings } = full;
    expect(full.name).toEqual({
      outline: settings.name.outlineWidth,
      glow: settings.name.hoverGlowWidth,
      renderPx: 1,
    });
    expect(full.level).toEqual({
      outline: settings.structureLevel.outlineWidth,
      renderPx: 1,
    });
    expect(full.worldText.outline).toBeCloseTo(1.2, 6);
    expect(full.worldText.renderPx).toBe(1);
    expect(fast.name).toEqual({
      outline: full.name.outline / 2,
      glow: full.name.glow / 2,
      renderPx: 0.5,
    });
    expect(fast.level).toEqual({
      outline: full.level.outline / 2,
      renderPx: 0.5,
    });
    expect(fast.worldText).toEqual({
      outline: full.worldText.outline / 2,
      renderPx: 0.5,
    });
  });

  it("keeps the outlines' on-screen width where the shader clamps them", () => {
    // clampOutline and the world-text glow below must match the shaders.
    for (const frag of [nameFrag, structureLevelFrag, worldTextFrag]) {
      expect(frag).toContain("max(screenPxRange * 0.5 - uRenderPx, 0.0)");
    }
    expect(worldTextFrag).toContain(
      "max(screenPxRange * 0.5 - effectiveOutline - 0.5 * uRenderPx, 0.0)",
    );

    window.devicePixelRatio = 2;
    const full = drawText();
    setMaxCanvasDpr(1);
    const fast = drawText();

    /** Widths in CSS px for a glyph whose SDF range is `range2x` px at 2x. */
    const onScreen = (text: ReturnType<typeof drawText>, dpr: number) => {
      return (range2x: number) => {
        const range = (range2x * dpr) / 2;
        const { name, level, worldText } = text;
        const n = clampOutline(range, name.outline, name.renderPx);
        const l = clampOutline(range, level.outline, level.renderPx);
        const w = clampOutline(range, worldText.outline, worldText.renderPx);
        const halo = range * 0.5 - w.outline - 0.5 * worldText.renderPx;
        return {
          nameOutline: n.outline / dpr,
          nameGlow: Math.min(name.glow, n.room) / dpr,
          levelOutline: l.outline / dpr,
          worldTextOutline: w.outline / dpr,
          worldTextHalo: Math.max(halo, 0) / dpr,
        };
      };
    };
    const off = onScreen(full, 2);
    const on = onScreen(fast, 1);

    // Small ranges clamp every outline; 40 clamps none. Below 2 the shader's
    // 1 px floor on the range takes over at 1x.
    for (const range2x of [2, 3, 4, 6, 8, 12, 40]) {
      const expected = off(range2x);
      const actual = on(range2x);
      for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
        expect(actual[key], `${key} at range ${range2x}`).toBeCloseTo(
          expected[key],
          9,
        );
      }
    }
    // A range of 4 at 2x clamps the 1.4 px name outline to 0.5 CSS px.
    expect(off(4).nameOutline).toBe(0.5);
    expect(on(4).nameOutline).toBe(0.5);
  });
});
