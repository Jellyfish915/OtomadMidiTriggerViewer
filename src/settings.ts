import {
  EASE_IN_CURVE,
  EASE_OUT_CURVE,
  LINEAR_CURVE,
  clamp,
  normalizeCurve
} from "./easing";
import type { AnimationEffect, AppSettings, EffectPhase } from "./types";

const STORAGE_KEY = "otomad-midi-trigger-viewer.settings.v1";

export const DEFAULT_SETTINGS: AppSettings = {
  bpm: 120,
  media: {
    kind: "none",
    fps: 30,
    startFrame: 0,
    endFrame: 60,
    timeCurve: LINEAR_CURVE,
    patternMode: "mirror",
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    aspectX: 1,
    aspectY: 1
  },
  mask: {
    width: 640,
    height: 360,
    backgroundColor: "#151515",
    borderEnabled: true,
    borderColor: "#ffffff",
    borderWidth: 2
  },
  loop: {
    mode: "none",
    startBeat: 0,
    endBeat: 16
  },
  export: {
    fps: 30,
    startBeat: 0,
    endBeat: 16
  },
  tracks: {},
  animations: {
    enter: [
      {
        id: "enter-move",
        type: "move",
        label: "座標移動",
        enabled: true,
        durationBeats: 0.5,
        curve: EASE_OUT_CURVE,
        params: { startX: 240, startY: 0, endX: 0, endY: 0 }
      },
      {
        id: "enter-scale",
        type: "scale",
        label: "拡大縮小",
        enabled: false,
        durationBeats: 0.5,
        curve: EASE_OUT_CURVE,
        params: { start: 0.88, end: 1 }
      },
      {
        id: "enter-rotate",
        type: "rotate",
        label: "回転",
        enabled: false,
        durationBeats: 0.5,
        curve: EASE_OUT_CURVE,
        params: { startDeg: -8, endDeg: 0 }
      },
      {
        id: "enter-blur",
        type: "directionBlur",
        label: "方向ブラー",
        enabled: false,
        durationBeats: 0.35,
        curve: EASE_OUT_CURVE,
        params: { angleDeg: 0, startStrength: 16, endStrength: 0 }
      },
      {
        id: "enter-flip",
        type: "flip",
        label: "反転",
        enabled: true,
        durationBeats: 0,
        curve: LINEAR_CURVE,
        params: { axis: "horizontal" }
      }
    ],
    exit: [
      {
        id: "exit-move",
        type: "move",
        label: "座標移動",
        enabled: true,
        durationBeats: 0.35,
        curve: EASE_IN_CURVE,
        params: { startX: 0, startY: 0, endX: -240, endY: 0 }
      },
      {
        id: "exit-scale",
        type: "scale",
        label: "拡大縮小",
        enabled: false,
        durationBeats: 0.35,
        curve: EASE_IN_CURVE,
        params: { start: 1, end: 0.92 }
      },
      {
        id: "exit-rotate",
        type: "rotate",
        label: "回転",
        enabled: false,
        durationBeats: 0.35,
        curve: EASE_IN_CURVE,
        params: { startDeg: 0, endDeg: 8 }
      },
      {
        id: "exit-blur",
        type: "directionBlur",
        label: "方向ブラー",
        enabled: false,
        durationBeats: 0.3,
        curve: EASE_IN_CURVE,
        params: { angleDeg: 180, startStrength: 0, endStrength: 16 }
      }
    ]
  }
};

export function loadSettings(): AppSettings {
  const fallback = cloneSettings(DEFAULT_SETTINGS);
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return fallback;
  }

  try {
    return normalizeSettings(mergeSettings(fallback, JSON.parse(raw)));
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: AppSettings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function cloneSettings(settings: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(settings)) as AppSettings;
}

export function getMaxEffectDurationBeats(
  effects: AnimationEffect[],
  fallback = 0
): number {
  return effects.reduce(
    (max, effect) =>
      effect.enabled && effect.type !== "flip"
        ? Math.max(max, Math.max(0, effect.durationBeats))
        : max,
    fallback
  );
}

export function normalizeSettings(settings: AppSettings): AppSettings {
  settings.bpm = clampNumber(settings.bpm, 30, 300, DEFAULT_SETTINGS.bpm);
  settings.media.fps = clampNumber(settings.media.fps, 1, 240, 30);
  settings.media.startFrame = Math.max(0, Math.round(settings.media.startFrame));
  settings.media.endFrame = Math.max(
    settings.media.startFrame,
    Math.round(settings.media.endFrame)
  );
  settings.media.timeCurve = normalizeCurve(settings.media.timeCurve);
  settings.media.offsetX = clampNumber(settings.media.offsetX, -100000, 100000, 0);
  settings.media.offsetY = clampNumber(settings.media.offsetY, -100000, 100000, 0);
  settings.media.scale = clampNumber(settings.media.scale, 0.01, 100, 1);
  settings.media.aspectX = clampNumber(settings.media.aspectX, 0.01, 100, 1);
  settings.media.aspectY = clampNumber(settings.media.aspectY, 0.01, 100, 1);
  settings.mask.width = clampNumber(settings.mask.width, 80, 4000, 640);
  settings.mask.height = clampNumber(settings.mask.height, 80, 4000, 360);
  settings.mask.borderEnabled = Boolean(settings.mask.borderEnabled);
  settings.mask.borderWidth = clampNumber(settings.mask.borderWidth, 0, 32, 2);
  settings.loop.startBeat = clampNumber(settings.loop.startBeat, 0, 99999, 0);
  settings.loop.endBeat = Math.max(
    settings.loop.startBeat + 0.25,
    clampNumber(settings.loop.endBeat, 0.25, 99999, 16)
  );
  settings.export.fps = clampNumber(settings.export.fps, 1, 120, 30);
  settings.export.startBeat = clampNumber(settings.export.startBeat, 0, 99999, 0);
  settings.export.endBeat = Math.max(
    settings.export.startBeat + 0.25,
    clampNumber(settings.export.endBeat, 0.25, 99999, 16)
  );

  for (const phase of ["enter", "exit"] as EffectPhase[]) {
    settings.animations[phase] = settings.animations[phase].map((effect) => ({
      ...effect,
      durationBeats: clampNumber(effect.durationBeats, 0, 64, effect.durationBeats),
      curve: normalizeCurve(effect.curve)
    })) as AnimationEffect[];
  }

  return settings;
}

function mergeSettings(base: AppSettings, stored: unknown): AppSettings {
  if (!isRecord(stored)) {
    return base;
  }

  return {
    ...base,
    ...stored,
    media: {
      ...base.media,
      ...(isRecord(stored.media) ? stored.media : {})
    },
    mask: {
      ...base.mask,
      ...(isRecord(stored.mask) ? stored.mask : {})
    },
    loop: {
      ...base.loop,
      ...(isRecord(stored.loop) ? stored.loop : {})
    },
    export: {
      ...base.export,
      ...(isRecord(stored.export) ? stored.export : {})
    },
    tracks: isRecord(stored.tracks) ? (stored.tracks as Record<string, boolean>) : {},
    animations: {
      enter: mergeEffects(base.animations.enter, stored.animations, "enter"),
      exit: mergeEffects(base.animations.exit, stored.animations, "exit")
    }
  } as AppSettings;
}

function mergeEffects(
  defaults: AnimationEffect[],
  source: unknown,
  phase: EffectPhase
): AnimationEffect[] {
  if (!isRecord(source) || !Array.isArray(source[phase])) {
    return defaults;
  }

  const storedEffects = source[phase] as unknown[];

  return defaults.map((defaultEffect) => {
    const stored = storedEffects.find(
      (candidate) => isRecord(candidate) && candidate.id === defaultEffect.id
    );

    if (!isRecord(stored)) {
      return defaultEffect;
    }

    return {
      ...defaultEffect,
      ...stored,
      params: {
        ...defaultEffect.params,
        ...(isRecord(stored.params) ? stored.params : {})
      }
    } as AnimationEffect;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampNumber(
  value: number,
  min: number,
  max: number,
  fallback: number
): number {
  return Number.isFinite(value) ? clamp(value, min, max) : fallback;
}
