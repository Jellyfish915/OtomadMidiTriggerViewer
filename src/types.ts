export type MediaKind = "none" | "image" | "video";
export type PatternMode = "mirror" | "repeat";
export type LoopMode = "none" | "full" | "ab";
export type EffectPhase = "enter" | "exit";
export type EffectType = "move" | "scale" | "rotate" | "directionBlur" | "flip";
export type FlipAxis = "horizontal" | "vertical" | "both";

export type BezierCurve = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type MidiTrigger = {
  tick: number;
  beat: number;
  timeSec: number;
};

export type TrackSelection = {
  id: string;
  name: string;
  noteCount: number;
  selected: boolean;
};

export type ParsedMidiProject = {
  name: string;
  ppq: number;
  durationTicks: number;
  durationBeats: number;
  tracks: TrackSelection[];
};

export type MediaSettings = {
  kind: MediaKind;
  fps: number;
  startFrame: number;
  endFrame: number;
  timeCurve: BezierCurve;
  patternMode: PatternMode;
  offsetX: number;
  offsetY: number;
  scale: number;
  aspectX: number;
  aspectY: number;
};

export type MaskSettings = {
  width: number;
  height: number;
  backgroundColor: string;
  borderEnabled: boolean;
  borderColor: string;
  borderWidth: number;
};

export type LoopSettings = {
  mode: LoopMode;
  startBeat: number;
  endBeat: number;
};

export type ExportSettings = {
  fps: number;
  startBeat: number;
  endBeat: number;
};

export type MoveEffectParams = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

export type ScaleEffectParams = {
  start: number;
  end: number;
};

export type RotateEffectParams = {
  startDeg: number;
  endDeg: number;
};

export type DirectionBlurEffectParams = {
  angleDeg: number;
  startStrength: number;
  endStrength: number;
};

export type FlipEffectParams = {
  axis: FlipAxis;
};

export type AnimationEffect =
  | {
      id: string;
      type: "move";
      label: string;
      enabled: boolean;
      durationBeats: number;
      curve: BezierCurve;
      params: MoveEffectParams;
    }
  | {
      id: string;
      type: "scale";
      label: string;
      enabled: boolean;
      durationBeats: number;
      curve: BezierCurve;
      params: ScaleEffectParams;
    }
  | {
      id: string;
      type: "rotate";
      label: string;
      enabled: boolean;
      durationBeats: number;
      curve: BezierCurve;
      params: RotateEffectParams;
    }
  | {
      id: string;
      type: "directionBlur";
      label: string;
      enabled: boolean;
      durationBeats: number;
      curve: BezierCurve;
      params: DirectionBlurEffectParams;
    }
  | {
      id: string;
      type: "flip";
      label: string;
      enabled: boolean;
      durationBeats: number;
      curve: BezierCurve;
      params: FlipEffectParams;
    };

export type AppSettings = {
  bpm: number;
  media: MediaSettings;
  mask: MaskSettings;
  loop: LoopSettings;
  export: ExportSettings;
  tracks: Record<string, boolean>;
  animations: Record<EffectPhase, AnimationEffect[]>;
};

export type TransformState = {
  offsetX: number;
  offsetY: number;
  scale: number;
  rotationDeg: number;
  blurAngleDeg: number;
  blurStrength: number;
};

export type VideoFrameCache = {
  fps: number;
  startFrame: number;
  endFrame: number;
  frames: CanvasImageSource[];
};

export type MediaAsset = {
  kind: Exclude<MediaKind, "none">;
  name: string;
  url: string;
  width: number;
  height: number;
  texture: import("pixi.js").Texture;
  video?: HTMLVideoElement;
  videoCanvas?: HTMLCanvasElement;
  videoContext?: CanvasRenderingContext2D;
  videoFrameCache?: VideoFrameCache;
  displayedVideoFrame?: number;
};

export type RuntimeTriggerState = {
  currentIndex: number;
  currentTimeSec: number;
  isPlaying: boolean;
};
