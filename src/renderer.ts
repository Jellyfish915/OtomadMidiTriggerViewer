import {
  Application,
  BlurFilter,
  Container,
  Graphics,
  Sprite,
  Texture
} from "pixi.js";
import {
  combineTransforms,
  getExitTransformForTarget,
  getFlipAxis,
  getTransformForPhase
} from "./animation";
import { evaluateBezier } from "./easing";
import { findCurrentTriggerIndex } from "./playback";
import type {
  AppSettings,
  MediaAsset,
  MidiTrigger,
  TransformState
} from "./types";
import {
  drawCachedVideoFrame,
  getVideoFrameCacheSpec,
  isVideoFrameCacheReady
} from "./videoFrames";

export type MaskRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  stageWidth: number;
  stageHeight: number;
};

type RenderInput = {
  settings: AppSettings;
  triggers: MidiTrigger[];
  timeSec: number;
  isPlaying: boolean;
  forceReset: boolean;
};

type RuntimeInstance = {
  container: Container;
  sprites: Sprite[];
  blurFilter: BlurFilter;
  texture: Texture;
  ownsTexture: boolean;
  triggerIndex: number;
  triggerTimeSec: number;
  flipX: boolean;
  flipY: boolean;
};

const MASK_MARGIN = 32;
const TILE_RADIUS = 4;
const BLUR_EPSILON = 0.05;

export class PixiPreviewRenderer {
  private app: Application | null = null;
  private mediaLayer = new Container();
  private currentLayer = new Container();
  private border = new Graphics();
  private maskShape = new Graphics();
  private current: RuntimeInstance | null = null;
  private media: MediaAsset | null = null;
  private lastTimeSec: number | null = null;
  private lastMaskKey = "";
  private maskRect: MaskRect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    stageWidth: 0,
    stageHeight: 0
  };

  constructor(
    private readonly host: HTMLElement,
    private readonly onMaskRectChange: (rect: MaskRect) => void
  ) {}

  async init(): Promise<void> {
    if (!hasWebGlSupport()) {
      throw new Error("WebGLを利用できません。ブラウザまたはGPU設定を確認してください。");
    }

    const app = new Application();
    await app.init({
      resizeTo: this.host,
      preference: "webgl",
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      backgroundAlpha: 0
    });

    this.app = app;
    app.canvas.className = "preview-canvas";
    this.host.appendChild(app.canvas);
    this.mediaLayer.addChild(this.currentLayer);
    app.stage.addChild(this.mediaLayer, this.maskShape, this.border);
    this.mediaLayer.mask = this.maskShape;
  }

  setMedia(media: MediaAsset | null): void {
    this.clearInstances();
    this.media = media;
    this.lastTimeSec = null;
  }

  getCanvas(): HTMLCanvasElement {
    return this.requireApp().canvas as HTMLCanvasElement;
  }

  getMaskRect(): MaskRect {
    return { ...this.maskRect };
  }

  render(input: RenderInput): void {
    const app = this.requireApp();
    this.updateMask(input.settings);

    if (!this.media) {
      this.clearInstances();
      this.lastTimeSec = input.timeSec;
      return;
    }

    const timeMovedBackward =
      this.lastTimeSec !== null && input.timeSec + 0.01 < this.lastTimeSec;

    const resetAtCurrentTime = input.forceReset;

    if (resetAtCurrentTime || timeMovedBackward) {
      this.clearInstances();
    }

    const currentTriggerIndex =
      input.triggers.length === 0
        ? -1
        : findCurrentTriggerIndex(input.triggers, input.timeSec);

    if (input.triggers.length > 0 && currentTriggerIndex < 0) {
      this.clearCurrent();
      pauseVideo(this.media);
      this.lastTimeSec = input.timeSec;
      app.render();
      return;
    }

    if (!this.current && (input.triggers.length === 0 || currentTriggerIndex >= 0)) {
      this.current = this.createCurrentInstance(
        currentTriggerIndex,
        resetAtCurrentTime
          ? input.timeSec
          : triggerTimeForIndex(input.triggers, currentTriggerIndex),
        input.settings
      );
    }

    if (
      this.current &&
      currentTriggerIndex !== this.current.triggerIndex &&
      currentTriggerIndex >= 0
    ) {
      if (currentTriggerIndex > this.current.triggerIndex) {
        this.clearCurrent();
        this.current = this.createCurrentInstance(
          currentTriggerIndex,
          triggerTimeForIndex(input.triggers, currentTriggerIndex),
          input.settings
        );
      } else {
        this.clearInstances();
        this.current = this.createCurrentInstance(
          currentTriggerIndex,
          triggerTimeForIndex(input.triggers, currentTriggerIndex),
          input.settings
        );
      }
    }

    this.updateCurrent(input.settings, input.triggers, input.timeSec, input.isPlaying);
    this.lastTimeSec = input.timeSec;
    app.render();
  }

  destroy(): void {
    this.clearInstances();
    if (this.app) {
      this.app.destroy(true);
      this.app = null;
    }
  }

  private updateMask(settings: AppSettings): void {
    const app = this.requireApp();
    const screen = app.screen;
    const widthLimit = Math.max(80, screen.width - MASK_MARGIN * 2);
    const heightLimit = Math.max(80, screen.height - MASK_MARGIN * 2);
    const width = Math.min(settings.mask.width, widthLimit);
    const height = Math.min(settings.mask.height, heightLimit);
    const x = Math.round((screen.width - width) / 2);
    const y = Math.round((screen.height - height) / 2);
    const key = [
      screen.width,
      screen.height,
      x,
      y,
      width,
      height,
      settings.mask.borderEnabled,
      settings.mask.borderColor,
      settings.mask.borderWidth
    ].join(":");

    if (key === this.lastMaskKey) {
      return;
    }

    this.lastMaskKey = key;
    this.maskRect = {
      x,
      y,
      width,
      height,
      stageWidth: screen.width,
      stageHeight: screen.height
    };

    this.maskShape
      .clear()
      .rect(x, y, width, height)
      .fill({ color: 0xffffff, alpha: 0.001 });
    this.border.clear();
    if (settings.mask.borderEnabled && settings.mask.borderWidth > 0) {
      this.border
        .rect(x, y, width, height)
        .stroke({
          width: settings.mask.borderWidth,
          color: hexColorToNumber(settings.mask.borderColor),
          alpha: 0.95
        });
    }
    this.onMaskRectChange(this.maskRect);
  }

  private createCurrentInstance(
    triggerIndex: number,
    triggerTimeSec: number,
    settings: AppSettings
  ): RuntimeInstance {
    const media = this.requireMedia();
    const instance = this.createInstance(media.texture, false, triggerIndex, triggerTimeSec);
    const axis = getFlipAxis(settings);
    const shouldFlip = triggerIndex >= 0 && triggerIndex % 2 === 1;

    instance.flipX = shouldFlip && (axis === "horizontal" || axis === "both");
    instance.flipY = shouldFlip && (axis === "vertical" || axis === "both");
    this.currentLayer.addChild(instance.container);

    return instance;
  }

  private createInstance(
    texture: Texture,
    ownsTexture: boolean,
    triggerIndex: number,
    triggerTimeSec: number
  ): RuntimeInstance {
    const container = new Container();
    const blurFilter = new BlurFilter({
      strength: 0,
      quality: 3,
      kernelSize: 7
    });
    blurFilter.repeatEdgePixels = true;
    const sprites: Sprite[] = [];

    for (let y = -TILE_RADIUS; y <= TILE_RADIUS; y += 1) {
      for (let x = -TILE_RADIUS; x <= TILE_RADIUS; x += 1) {
        const sprite = new Sprite({ texture });
        sprite.anchor.set(0.5);
        sprite.label = `${x}:${y}`;
        container.addChild(sprite);
        sprites.push(sprite);
      }
    }

    return {
      container,
      sprites,
      blurFilter,
      texture,
      ownsTexture,
      triggerIndex,
      triggerTimeSec,
      flipX: false,
      flipY: false
    };
  }

  private updateCurrent(
    settings: AppSettings,
    triggers: MidiTrigger[],
    timeSec: number,
    isPlaying: boolean
  ): void {
    if (!this.current) {
      return;
    }

    const ageSec = Math.max(0, timeSec - this.current.triggerTimeSec);
    this.updateVideoFrame(settings, ageSec);
    const enterTransform = getTransformForPhase(settings, "enter", ageSec);
    const nextTrigger = getNextTrigger(triggers, this.current.triggerIndex);
    const transform = nextTrigger
      ? combineTransforms(
          enterTransform,
          getExitTransformForTarget(settings, timeSec, nextTrigger.timeSec)
        )
      : enterTransform;
    this.applyInstanceState(this.current, transform, settings);
  }

  private updateVideoFrame(settings: AppSettings, ageSec: number): void {
    const media = this.media;
    if (
      !media ||
      media.kind !== "video" ||
      !media.videoCanvas ||
      !media.videoContext ||
      !isVideoFrameCacheReady(media, settings)
    ) {
      return;
    }

    const { fps, startFrame: start, endFrame: end } =
      getVideoFrameCacheSpec(settings);
    const span = end - start;
    const durationSec = span / fps;
    const progress = durationSec <= 0 ? 1 : Math.min(1, ageSec / durationSec);
    const eased = evaluateBezier(settings.media.timeCurve, progress);
    const frame = start + span * eased;
    drawCachedVideoFrame(media, frame);
  }

  private applyInstanceState(
    instance: RuntimeInstance,
    transform: TransformState,
    settings: AppSettings
  ): void {
    const media = this.requireMedia();
    const rect = this.maskRect;
    const container = instance.container;
    const coverScale = Math.max(rect.width / media.width, rect.height / media.height);
    const mediaScale = settings.media.scale;
    const mediaScaleX = coverScale * mediaScale * settings.media.aspectX;
    const mediaScaleY = coverScale * mediaScale * settings.media.aspectY;
    const tileWidth = media.width * mediaScaleX;
    const tileHeight = media.height * mediaScaleY;
    const shiftX = wrapCentered(transform.offsetX + settings.media.offsetX, tileWidth);
    const shiftY = wrapCentered(transform.offsetY + settings.media.offsetY, tileHeight);
    const flipScaleX = instance.flipX ? -1 : 1;
    const flipScaleY = instance.flipY ? -1 : 1;
    const patternMode = settings.media.patternMode;

    container.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2);
    container.rotation = (transform.rotationDeg * Math.PI) / 180;
    container.scale.set(transform.scale * flipScaleX, transform.scale * flipScaleY);

    let spriteIndex = 0;
    for (let tileY = -TILE_RADIUS; tileY <= TILE_RADIUS; tileY += 1) {
      for (let tileX = -TILE_RADIUS; tileX <= TILE_RADIUS; tileX += 1) {
        const sprite = instance.sprites[spriteIndex];
        const mirrorX = patternMode === "mirror" && Math.abs(tileX) % 2 === 1 ? -1 : 1;
        const mirrorY = patternMode === "mirror" && Math.abs(tileY) % 2 === 1 ? -1 : 1;
        sprite.position.set(tileX * tileWidth + shiftX, tileY * tileHeight + shiftY);
        sprite.scale.set(mediaScaleX * mirrorX, mediaScaleY * mirrorY);
        spriteIndex += 1;
      }
    }

    if (transform.blurStrength > BLUR_EPSILON) {
      const radians = (transform.blurAngleDeg * Math.PI) / 180;
      instance.blurFilter.strengthX = Math.abs(Math.cos(radians) * transform.blurStrength);
      instance.blurFilter.strengthY = Math.abs(Math.sin(radians) * transform.blurStrength);
      instance.blurFilter.padding = Math.ceil(transform.blurStrength * 2);
      container.filters = [instance.blurFilter];
    } else {
      container.filters = [];
    }
  }

  private clearInstances(): void {
    this.clearCurrent();
  }

  private clearCurrent(): void {
    if (!this.current) {
      return;
    }

    this.destroyInstance(this.current);
    this.current = null;
  }

  private destroyInstance(instance: RuntimeInstance): void {
    if (instance.container.parent) {
      instance.container.parent.removeChild(instance.container);
    }
    instance.container.destroy({ children: true });
    if (instance.ownsTexture) {
      instance.texture.destroy(true);
    }
  }

  private requireApp(): Application {
    if (!this.app) {
      throw new Error("Preview renderer has not been initialized.");
    }

    return this.app;
  }

  private requireMedia(): MediaAsset {
    if (!this.media) {
      throw new Error("No media asset is loaded.");
    }

    return this.media;
  }
}

function triggerTimeForIndex(triggers: MidiTrigger[], index: number): number {
  return index >= 0 ? triggers[index]?.timeSec ?? 0 : 0;
}

function getNextTrigger(
  triggers: MidiTrigger[],
  currentIndex: number
): MidiTrigger | null {
  if (currentIndex < 0) {
    return null;
  }

  return triggers[currentIndex + 1] ?? null;
}

function hexColorToNumber(color: string): number {
  const normalized = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : "ffffff";
  return Number.parseInt(normalized, 16);
}

function pauseVideo(media: MediaAsset | null): void {
  if (!media?.video) {
    return;
  }

  if (!media.video.paused) {
    media.video.pause();
  }
}

function wrapCentered(value: number, size: number): number {
  if (size <= 0) {
    return 0;
  }

  return ((((value + size / 2) % size) + size) % size) - size / 2;
}

function hasWebGlSupport(): boolean {
  const canvas = document.createElement("canvas");
  return Boolean(
    canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")
  );
}
