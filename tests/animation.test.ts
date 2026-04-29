import { describe, expect, it } from "vitest";
import {
  combineTransforms,
  getExitTransformForTarget,
  getTransformForPhase
} from "../src/animation";
import { cloneSettings, DEFAULT_SETTINGS } from "../src/settings";

describe("animation transforms", () => {
  it("starts exit effects before the next trigger and finishes at that trigger", () => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    const exitMove = settings.animations.exit.find(
      (effect) => effect.id === "exit-move"
    );
    if (!exitMove || exitMove.type !== "move") {
      throw new Error("exit move effect missing");
    }

    exitMove.enabled = true;
    exitMove.durationBeats = 0.5;
    exitMove.params = { startX: 0, startY: 0, endX: -100, endY: 0 };
    settings.bpm = 120;

    const targetTimeSec = 1;
    expect(getExitTransformForTarget(settings, 0.7, targetTimeSec).offsetX).toBe(0);
    expect(getExitTransformForTarget(settings, 0.75, targetTimeSec).offsetX).toBeCloseTo(0);
    expect(getExitTransformForTarget(settings, 1, targetTimeSec).offsetX).toBeCloseTo(-100);
  });

  it("combines enter and exit transforms on the same instance", () => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    const enter = getTransformForPhase(settings, "enter", 10);
    const exit = getExitTransformForTarget(settings, 0.99, 1);
    const combined = combineTransforms(enter, exit);

    expect(combined.offsetX).toBeLessThan(0);
  });
});
