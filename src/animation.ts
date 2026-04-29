import { evaluateBezier, lerp } from "./easing";
import { beatsToSeconds } from "./midi";
import type {
  AnimationEffect,
  AppSettings,
  EffectPhase,
  FlipAxis,
  TransformState
} from "./types";

export function getTransformForPhase(
  settings: AppSettings,
  phase: EffectPhase,
  ageSec: number
): TransformState {
  const transform = createIdentityTransform();

  for (const effect of settings.animations[phase]) {
    if (!effect.enabled || effect.type === "flip") {
      continue;
    }

    const amount = effectProgress(effect, settings.bpm, ageSec);
    applyEffectTransform(transform, effect, amount);
  }

  return transform;
}

export function getExitTransformForTarget(
  settings: AppSettings,
  timeSec: number,
  targetTimeSec: number
): TransformState {
  const transform = createIdentityTransform();

  for (const effect of settings.animations.exit) {
    if (!effect.enabled || effect.type === "flip") {
      continue;
    }

    const durationSec = beatsToSeconds(Math.max(0, effect.durationBeats), settings.bpm);
    if (durationSec <= 0) {
      continue;
    }

    const startTimeSec = targetTimeSec - durationSec;
    if (timeSec < startTimeSec || timeSec > targetTimeSec) {
      continue;
    }

    const rawProgress = (timeSec - startTimeSec) / durationSec;
    const amount = evaluateBezier(effect.curve, Math.min(1, Math.max(0, rawProgress)));
    applyEffectTransform(transform, effect, amount);
  }

  return transform;
}

export function combineTransforms(
  base: TransformState,
  overlay: TransformState
): TransformState {
  return {
    offsetX: base.offsetX + overlay.offsetX,
    offsetY: base.offsetY + overlay.offsetY,
    scale: base.scale * overlay.scale,
    rotationDeg: base.rotationDeg + overlay.rotationDeg,
    blurAngleDeg: overlay.blurStrength > 0 ? overlay.blurAngleDeg : base.blurAngleDeg,
    blurStrength: base.blurStrength + overlay.blurStrength
  };
}

export function getFlipAxis(settings: AppSettings): FlipAxis | null {
  const flipEffect = settings.animations.enter.find(
    (effect) => effect.type === "flip" && effect.enabled
  );

  return flipEffect?.type === "flip" ? flipEffect.params.axis : null;
}

function effectProgress(
  effect: AnimationEffect,
  bpm: number,
  ageSec: number
): number {
  const durationSec = beatsToSeconds(Math.max(0, effect.durationBeats), bpm);

  if (durationSec <= 0) {
    return 1;
  }

  return evaluateBezier(effect.curve, Math.min(1, Math.max(0, ageSec / durationSec)));
}

function createIdentityTransform(): TransformState {
  return {
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    rotationDeg: 0,
    blurAngleDeg: 0,
    blurStrength: 0
  };
}

function applyEffectTransform(
  transform: TransformState,
  effect: AnimationEffect,
  amount: number
): void {
  if (effect.type === "move") {
    transform.offsetX += lerp(effect.params.startX, effect.params.endX, amount);
    transform.offsetY += lerp(effect.params.startY, effect.params.endY, amount);
  }

  if (effect.type === "scale") {
    transform.scale *= Math.max(
      0.01,
      lerp(effect.params.start, effect.params.end, amount)
    );
  }

  if (effect.type === "rotate") {
    transform.rotationDeg += lerp(effect.params.startDeg, effect.params.endDeg, amount);
  }

  if (effect.type === "directionBlur") {
    transform.blurAngleDeg = effect.params.angleDeg;
    transform.blurStrength += lerp(
      effect.params.startStrength,
      effect.params.endStrength,
      amount
    );
  }
}
