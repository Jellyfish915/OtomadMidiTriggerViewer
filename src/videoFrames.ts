import type { AppSettings, MediaAsset, VideoFrameCache } from "./types";

const MAX_PREVIEW_VIDEO_FRAMES = 240;
const MAX_VIDEO_FRAME_CACHE_EDGE = 720;
const VIDEO_SEEK_EPSILON_SEC = 0.005;
const VIDEO_SEEK_TIMEOUT_MS = 2000;

export type VideoFrameCacheSpec = {
  fps: number;
  startFrame: number;
  endFrame: number;
  frameCount: number;
};

export function getVideoFrameCacheSpec(settings: AppSettings): VideoFrameCacheSpec {
  const fps = Math.max(1, Math.min(240, settings.media.fps));
  const startFrame = Math.max(0, Math.round(settings.media.startFrame));
  const endFrame = Math.max(startFrame, Math.round(settings.media.endFrame));

  return {
    fps,
    startFrame,
    endFrame,
    frameCount: endFrame - startFrame + 1
  };
}

export function getVideoFrameCacheSize(
  sourceWidth: number,
  sourceHeight: number
): { width: number; height: number } {
  const width = Math.max(1, sourceWidth);
  const height = Math.max(1, sourceHeight);
  const scale = Math.min(1, MAX_VIDEO_FRAME_CACHE_EDGE / Math.max(width, height));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

export function isVideoFrameCacheReady(
  media: MediaAsset,
  settings: AppSettings
): boolean {
  const cache = media.videoFrameCache;
  if (!cache) {
    return false;
  }

  const spec = getVideoFrameCacheSpec(settings);
  return (
    cache.fps === spec.fps &&
    cache.startFrame === spec.startFrame &&
    cache.endFrame === spec.endFrame &&
    cache.frames.length === spec.frameCount
  );
}

export async function buildVideoFrameCache(
  video: HTMLVideoElement,
  settings: AppSettings,
  width: number,
  height: number,
  onProgress?: (done: number, total: number) => void
): Promise<VideoFrameCache> {
  const spec = getVideoFrameCacheSpec(settings);
  if (spec.frameCount > MAX_PREVIEW_VIDEO_FRAMES) {
    throw new Error(
      `Preview frame range is ${spec.frameCount} frames. Use ${MAX_PREVIEW_VIDEO_FRAMES} frames or fewer.`
    );
  }

  const frames: CanvasImageSource[] = [];
  const scratchCanvas = document.createElement("canvas");
  scratchCanvas.width = width;
  scratchCanvas.height = height;
  const scratchContext = scratchCanvas.getContext("2d");
  if (!scratchContext) {
    throw new Error("Could not create a video frame canvas.");
  }
  onProgress?.(0, spec.frameCount);

  try {
    for (let frame = spec.startFrame; frame <= spec.endFrame; frame += 1) {
      await seekVideo(video, frame / spec.fps);
      frames.push(
        await captureVideoFrame(video, width, height, scratchCanvas, scratchContext)
      );
      onProgress?.(frames.length, spec.frameCount);

      if (frames.length % 8 === 0) {
        await delay(0);
      }
    }
  } catch (error) {
    releaseVideoFrameCache({
      fps: spec.fps,
      startFrame: spec.startFrame,
      endFrame: spec.endFrame,
      frames
    });
    throw error;
  }

  video.pause();
  return {
    fps: spec.fps,
    startFrame: spec.startFrame,
    endFrame: spec.endFrame,
    frames
  };
}

export function drawCachedVideoFrame(
  media: MediaAsset,
  frameNumber: number
): boolean {
  const cache = media.videoFrameCache;
  if (!cache || !media.videoCanvas || !media.videoContext) {
    return false;
  }

  const frameIndex = Math.min(
    cache.endFrame,
    Math.max(cache.startFrame, Math.round(frameNumber))
  );
  if (media.displayedVideoFrame === frameIndex) {
    return true;
  }

  const source = cache.frames[frameIndex - cache.startFrame];
  if (!source) {
    return false;
  }

  media.videoContext.drawImage(
    source,
    0,
    0,
    media.videoCanvas.width,
    media.videoCanvas.height
  );
  media.texture.source.update();
  media.displayedVideoFrame = frameIndex;
  return true;
}

export function releaseVideoFrameCache(cache: VideoFrameCache | undefined): void {
  if (!cache) {
    return;
  }

  for (const frame of cache.frames) {
    const close = (frame as { close?: unknown }).close;
    if (typeof close === "function") {
      close.call(frame);
    }
  }
  cache.frames.length = 0;
}

async function captureVideoFrame(
  video: HTMLVideoElement,
  width: number,
  height: number,
  scratchCanvas: HTMLCanvasElement,
  scratchContext: CanvasRenderingContext2D
): Promise<CanvasImageSource> {
  scratchContext.drawImage(video, 0, 0, width, height);

  if (typeof createImageBitmap === "function") {
    return createImageBitmap(scratchCanvas);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a video frame canvas.");
  }
  context.drawImage(scratchCanvas, 0, 0, width, height);
  return canvas;
}

function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  const duration = Number.isFinite(video.duration) ? video.duration : timeSec;
  const targetTime = Math.min(Math.max(0, timeSec), Math.max(0, duration));

  if (
    Math.abs(video.currentTime - targetTime) < VIDEO_SEEK_EPSILON_SEC &&
    video.readyState >= 2
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let timeoutId: number | undefined;
    const cleanup = (): void => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error("Video frame seek failed."));
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = targetTime;
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Video frame seek timed out."));
    }, VIDEO_SEEK_TIMEOUT_MS);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
}
