import type { BezierCurve } from "./types";

export const LINEAR_CURVE: BezierCurve = { x1: 0, y1: 0, x2: 1, y2: 1 };
export const EASE_OUT_CURVE: BezierCurve = { x1: 0.16, y1: 1, x2: 0.3, y2: 1 };
export const EASE_IN_CURVE: BezierCurve = { x1: 0.7, y1: 0, x2: 0.84, y2: 0 };

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

export function evaluateBezier(curve: BezierCurve, progress: number): number {
  const x = clamp(progress, 0, 1);
  if (x === 0 || x === 1) {
    return x;
  }

  const x1 = clamp(curve.x1, 0, 1);
  const y1 = clamp(curve.y1, 0, 1);
  const x2 = clamp(curve.x2, 0, 1);
  const y2 = clamp(curve.y2, 0, 1);
  const t = solveBezierT(x, x1, x2);

  return clamp(sampleBezier(t, y1, y2), 0, 1);
}

export function normalizeCurve(curve: BezierCurve): BezierCurve {
  return {
    x1: clampNumber(curve.x1, 0, 1, LINEAR_CURVE.x1),
    y1: clampNumber(curve.y1, 0, 1, LINEAR_CURVE.y1),
    x2: clampNumber(curve.x2, 0, 1, LINEAR_CURVE.x2),
    y2: clampNumber(curve.y2, 0, 1, LINEAR_CURVE.y2)
  };
}

function solveBezierT(targetX: number, x1: number, x2: number): number {
  let t = targetX;

  for (let i = 0; i < 8; i += 1) {
    const x = sampleBezier(t, x1, x2) - targetX;
    const derivative = sampleBezierDerivative(t, x1, x2);

    if (Math.abs(x) < 0.000001) {
      return t;
    }

    if (Math.abs(derivative) < 0.000001) {
      break;
    }

    t = clamp(t - x / derivative, 0, 1);
  }

  let lower = 0;
  let upper = 1;
  t = targetX;

  for (let i = 0; i < 24; i += 1) {
    const x = sampleBezier(t, x1, x2);
    if (Math.abs(x - targetX) < 0.000001) {
      return t;
    }

    if (x < targetX) {
      lower = t;
    } else {
      upper = t;
    }

    t = (lower + upper) / 2;
  }

  return t;
}

function sampleBezier(t: number, point1: number, point2: number): number {
  const inv = 1 - t;
  return 3 * inv * inv * t * point1 + 3 * inv * t * t * point2 + t * t * t;
}

function sampleBezierDerivative(t: number, point1: number, point2: number): number {
  const inv = 1 - t;
  return (
    3 * inv * inv * point1 +
    6 * inv * t * (point2 - point1) +
    3 * t * t * (1 - point2)
  );
}

function clampNumber(
  value: number,
  min: number,
  max: number,
  fallback: number
): number {
  return Number.isFinite(value) ? clamp(value, min, max) : fallback;
}
