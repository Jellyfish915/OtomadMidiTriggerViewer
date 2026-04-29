import { describe, expect, it } from "vitest";
import { EASE_OUT_CURVE, LINEAR_CURVE, evaluateBezier } from "../src/easing";

describe("evaluateBezier", () => {
  it("keeps linear curves linear", () => {
    expect(evaluateBezier(LINEAR_CURVE, 0)).toBeCloseTo(0);
    expect(evaluateBezier(LINEAR_CURVE, 0.25)).toBeCloseTo(0.25);
    expect(evaluateBezier(LINEAR_CURVE, 0.5)).toBeCloseTo(0.5);
    expect(evaluateBezier(LINEAR_CURVE, 1)).toBeCloseTo(1);
  });

  it("clamps input progress", () => {
    expect(evaluateBezier(EASE_OUT_CURVE, -1)).toBe(0);
    expect(evaluateBezier(EASE_OUT_CURVE, 2)).toBe(1);
  });
});
