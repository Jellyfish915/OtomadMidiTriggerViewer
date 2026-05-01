import "./style.css";
import { Midi } from "@tonejs/midi";
import { Texture } from "pixi.js";
import { evaluateBezier, normalizeCurve } from "./easing";
import {
  beatsToSeconds,
  buildMidiTriggers,
  parseMidiProject,
  secondsToBeats
} from "./midi";
import { applyLoop, findCurrentTriggerIndex } from "./playback";
import { PixiPreviewRenderer, type MaskRect } from "./renderer";
import {
  loadSettings,
  normalizeSettings,
  saveSettings
} from "./settings";
import {
  buildVideoFrameCache,
  drawCachedVideoFrame,
  getVideoFrameCacheSize,
  isVideoFrameCacheReady,
  releaseVideoFrameCache
} from "./videoFrames";
import type {
  AnimationEffect,
  AppSettings,
  BezierCurve,
  EffectPhase,
  MediaAsset,
  MidiTrigger,
  ParsedMidiProject
} from "./types";

type DomRefs = {
  previewStage: HTMLElement;
  previewEmpty: HTMLElement;
  maskHandle: HTMLElement;
  midiInput: HTMLInputElement;
  mediaInput: HTMLInputElement;
  bpmInput: HTMLInputElement;
  playButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  loopButtons: NodeListOf<HTMLButtonElement>;
  loopRange: HTMLElement;
  loopStartInput: HTMLInputElement;
  loopEndInput: HTMLInputElement;
  exportFpsInput: HTMLInputElement;
  exportStartInput: HTMLInputElement;
  exportEndInput: HTMLInputElement;
  exportButton: HTMLButtonElement;
  exportStatus: HTMLElement;
  mediaName: HTMLElement;
  midiName: HTMLElement;
  triggerStatus: HTMLElement;
  clockStatus: HTMLElement;
  trackList: HTMLElement;
  videoPanel: HTMLElement;
  fpsInput: HTMLInputElement;
  startFrameInput: HTMLInputElement;
  endFrameInput: HTMLInputElement;
  patternButtons: NodeListOf<HTMLButtonElement>;
  mediaOffsetXInput: HTMLInputElement;
  mediaOffsetYInput: HTMLInputElement;
  mediaScaleInput: HTMLInputElement;
  mediaAspectXInput: HTMLInputElement;
  mediaAspectYInput: HTMLInputElement;
  videoCurveMount: HTMLElement;
  backgroundInput: HTMLInputElement;
  maskWidthInput: HTMLInputElement;
  maskHeightInput: HTMLInputElement;
  borderEnabledInput: HTMLInputElement;
  borderColorInput: HTMLInputElement;
  borderWidthInput: HTMLInputElement;
  enterEffects: HTMLElement;
  exitEffects: HTMLElement;
};

type AppState = {
  settings: AppSettings;
  renderer: PixiPreviewRenderer;
  refs: DomRefs;
  midi: Midi | null;
  project: ParsedMidiProject | null;
  triggers: MidiTrigger[];
  media: MediaAsset | null;
  isPlaying: boolean;
  isExporting: boolean;
  playbackStartedAt: number;
  pausedElapsedSec: number;
  forceRenderReset: boolean;
  rafId: number | null;
  videoCacheBuildToken: number;
};

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("App root was not found.");
}

void bootstrap(appRoot);

async function bootstrap(root: HTMLElement): Promise<void> {
  root.innerHTML = createShellHtml();
  const refs = collectRefs(root);
  const settings = loadSettings();
  const renderer = new PixiPreviewRenderer(refs.previewStage, (rect) =>
    positionMaskHandle(refs, rect)
  );

  const state: AppState = {
    settings,
    renderer,
    refs,
    midi: null,
    project: null,
    triggers: [],
    media: null,
    isPlaying: false,
    isExporting: false,
    playbackStartedAt: performance.now(),
    pausedElapsedSec: 0,
    forceRenderReset: true,
    rafId: null,
    videoCacheBuildToken: 0
  };

  try {
    await renderer.init();
  } catch (error) {
    refs.previewEmpty.hidden = false;
    refs.previewEmpty.textContent =
      error instanceof Error ? error.message : String(error);
  }

  renderAnimationEffects(state, "enter");
  renderAnimationEffects(state, "exit");
  new BezierEditor(refs.videoCurveMount, settings.media.timeCurve, (curve) => {
    state.settings.media.timeCurve = curve;
    state.forceRenderReset = true;
    persist(state);
  });

  bindControls(state);
  syncAllControls(state);
  loop(state);
}

function createShellHtml(): string {
  return `
    <main class="app-shell">
      <section class="preview-panel" aria-label="プレビュー">
        <div class="preview-toolbar">
          <div>
            <span class="status-label">現在位置</span>
            <strong data-status="clock">0.00s / 0.00拍</strong>
          </div>
          <div>
            <span class="status-label">トリガー</span>
            <strong data-status="triggers">0件</strong>
          </div>
        </div>
        <div class="preview-stage" data-preview-stage>
          <p class="preview-empty" data-preview-empty>素材とMIDIを読み込んでください</p>
          <button class="mask-handle" data-mask-handle type="button" aria-label="マスクサイズ変更"></button>
        </div>
      </section>

      <aside class="settings-panel" aria-label="設定">
        <header class="settings-header">
          <p>Otomad MIDI Trigger Viewer</p>
          <h1>MIDIトリガープレビュー</h1>
        </header>

        <section class="panel-section">
          <h2>入力</h2>
          <label class="file-control">
            <span>MIDIファイル</span>
            <input data-input="midi" type="file" accept=".mid,.midi,audio/midi,audio/x-midi" aria-label="MIDIファイル" />
          </label>
          <strong class="file-status" data-status="midi-name">未読込</strong>
          <div class="track-list" data-track-list>未読込</div>
          <label class="file-control">
            <span>画像 / 動画</span>
            <input data-input="media" type="file" accept="image/*,video/*" aria-label="画像 / 動画" />
          </label>
          <strong class="file-status" data-status="media-name">未読込</strong>
          <label class="control">
            <span>BPM</span>
            <input data-input="bpm" type="number" min="30" max="300" step="1" />
          </label>
        </section>

        <section class="panel-section">
          <h2>プレビュー操作</h2>
          <div class="button-row">
            <button class="primary-button" data-action="play" type="button">再生</button>
            <button class="plain-button" data-action="reset" type="button">先頭</button>
          </div>
          <div class="segmented" aria-label="ループ">
            <button data-loop-mode="none" type="button">なし</button>
            <button data-loop-mode="full" type="button">全体</button>
            <button data-loop-mode="ab" type="button">A-B</button>
          </div>
          <div class="control-grid two loop-range" data-loop-range>
            <label class="control">
              <span>A開始拍</span>
              <input data-input="loop-start" type="number" min="0" step="0.25" />
            </label>
            <label class="control">
              <span>B終了拍</span>
              <input data-input="loop-end" type="number" min="0.25" step="0.25" />
            </label>
          </div>
        </section>

        <section class="panel-section">
          <h2>動画書き出し</h2>
          <div class="control-grid three">
            <label class="control">
              <span>FPS</span>
              <input data-input="export-fps" type="number" min="1" max="120" step="1" />
            </label>
            <label class="control">
              <span>開始拍</span>
              <input data-input="export-start" type="number" min="0" step="0.25" />
            </label>
            <label class="control">
              <span>終了拍</span>
              <input data-input="export-end" type="number" min="0.25" step="0.25" />
            </label>
          </div>
          <div class="button-row export-row">
            <button class="primary-button" data-action="export-video" type="button">WebMを書き出し</button>
            <strong class="export-status" data-status="export">待機中</strong>
          </div>
        </section>

        <section class="panel-section">
          <h2>素材</h2>
          <div class="segmented" aria-label="外領域パターン">
            <button data-pattern-mode="mirror" type="button">ミラー</button>
            <button data-pattern-mode="repeat" type="button">複製</button>
          </div>
          <div class="control-grid three">
            <label class="control">
              <span>素材X</span>
              <input data-input="media-offset-x" type="number" step="1" />
            </label>
            <label class="control">
              <span>素材Y</span>
              <input data-input="media-offset-y" type="number" step="1" />
            </label>
            <label class="control">
              <span>拡大率</span>
              <input data-input="media-scale" type="number" min="0.01" step="0.01" />
            </label>
            <label class="control">
              <span>横比率</span>
              <input data-input="media-aspect-x" type="number" min="0.01" step="0.01" />
            </label>
            <label class="control">
              <span>縦比率</span>
              <input data-input="media-aspect-y" type="number" min="0.01" step="0.01" />
            </label>
          </div>
          <div class="video-panel" data-panel="video">
            <div class="control-grid three">
              <label class="control">
                <span>FPS</span>
                <input data-input="fps" type="number" min="1" max="240" step="1" />
              </label>
              <label class="control">
                <span>開始フレーム</span>
                <input data-input="start-frame" type="number" min="0" step="1" />
              </label>
              <label class="control">
                <span>終了フレーム</span>
                <input data-input="end-frame" type="number" min="0" step="1" />
              </label>
            </div>
            <div class="curve-block">
              <span>時間制御</span>
              <div data-curve="video-time"></div>
            </div>
          </div>
        </section>

        <section class="panel-section">
          <h2>表示領域</h2>
          <div class="control-grid three">
            <label class="control">
              <span>背景色</span>
              <input data-input="background" type="color" />
            </label>
            <label class="control">
              <span>マスク幅</span>
              <input data-input="mask-width" type="number" min="80" step="1" />
            </label>
            <label class="control">
              <span>マスク高さ</span>
              <input data-input="mask-height" type="number" min="80" step="1" />
            </label>
            <label class="control checkbox-control">
              <span>枠</span>
              <span class="checkbox-row">
                <input data-input="border-enabled" type="checkbox" />
                <span>有効化</span>
              </span>
            </label>
            <label class="control">
              <span>枠色</span>
              <input data-input="border-color" type="color" />
            </label>
            <label class="control">
              <span>枠幅</span>
              <input data-input="border-width" type="number" min="0" max="32" step="1" />
            </label>
          </div>
        </section>

        <section class="panel-section">
          <h2>入り</h2>
          <div class="effect-list" data-effects="enter"></div>
        </section>

        <section class="panel-section">
          <h2>抜き</h2>
          <div class="effect-list" data-effects="exit"></div>
        </section>
      </aside>
    </main>
  `;
}

function collectRefs(root: HTMLElement): DomRefs {
  return {
    previewStage: mustQuery(root, "[data-preview-stage]"),
    previewEmpty: mustQuery(root, "[data-preview-empty]"),
    maskHandle: mustQuery(root, "[data-mask-handle]"),
    midiInput: mustQuery(root, '[data-input="midi"]'),
    mediaInput: mustQuery(root, '[data-input="media"]'),
    bpmInput: mustQuery(root, '[data-input="bpm"]'),
    playButton: mustQuery(root, '[data-action="play"]'),
    resetButton: mustQuery(root, '[data-action="reset"]'),
    loopButtons: root.querySelectorAll("[data-loop-mode]"),
    loopRange: mustQuery(root, "[data-loop-range]"),
    loopStartInput: mustQuery(root, '[data-input="loop-start"]'),
    loopEndInput: mustQuery(root, '[data-input="loop-end"]'),
    exportFpsInput: mustQuery(root, '[data-input="export-fps"]'),
    exportStartInput: mustQuery(root, '[data-input="export-start"]'),
    exportEndInput: mustQuery(root, '[data-input="export-end"]'),
    exportButton: mustQuery(root, '[data-action="export-video"]'),
    exportStatus: mustQuery(root, '[data-status="export"]'),
    mediaName: mustQuery(root, '[data-status="media-name"]'),
    midiName: mustQuery(root, '[data-status="midi-name"]'),
    triggerStatus: mustQuery(root, '[data-status="triggers"]'),
    clockStatus: mustQuery(root, '[data-status="clock"]'),
    trackList: mustQuery(root, "[data-track-list]"),
    videoPanel: mustQuery(root, '[data-panel="video"]'),
    fpsInput: mustQuery(root, '[data-input="fps"]'),
    startFrameInput: mustQuery(root, '[data-input="start-frame"]'),
    endFrameInput: mustQuery(root, '[data-input="end-frame"]'),
    patternButtons: root.querySelectorAll("[data-pattern-mode]"),
    mediaOffsetXInput: mustQuery(root, '[data-input="media-offset-x"]'),
    mediaOffsetYInput: mustQuery(root, '[data-input="media-offset-y"]'),
    mediaScaleInput: mustQuery(root, '[data-input="media-scale"]'),
    mediaAspectXInput: mustQuery(root, '[data-input="media-aspect-x"]'),
    mediaAspectYInput: mustQuery(root, '[data-input="media-aspect-y"]'),
    videoCurveMount: mustQuery(root, '[data-curve="video-time"]'),
    backgroundInput: mustQuery(root, '[data-input="background"]'),
    maskWidthInput: mustQuery(root, '[data-input="mask-width"]'),
    maskHeightInput: mustQuery(root, '[data-input="mask-height"]'),
    borderEnabledInput: mustQuery(root, '[data-input="border-enabled"]'),
    borderColorInput: mustQuery(root, '[data-input="border-color"]'),
    borderWidthInput: mustQuery(root, '[data-input="border-width"]'),
    enterEffects: mustQuery(root, '[data-effects="enter"]'),
    exitEffects: mustQuery(root, '[data-effects="exit"]')
  };
}

function bindControls(state: AppState): void {
  const { refs } = state;

  refs.midiInput.addEventListener("change", () => {
    void loadMidiFile(state);
  });
  refs.mediaInput.addEventListener("change", () => {
    void loadMediaFile(state);
  });

  bindNumericInput(refs.bpmInput, () => {
    state.settings.bpm = parseClampedNumber(refs.bpmInput.value, 30, 300, 120);
    refs.bpmInput.value = String(state.settings.bpm);
    rebuildTriggers(state);
    persist(state);
  });

  refs.playButton.addEventListener("click", () => {
    if (state.isPlaying) {
      pausePlayback(state);
    } else {
      startPlayback(state);
    }
  });

  refs.resetButton.addEventListener("click", () => {
    state.isPlaying = false;
    state.pausedElapsedSec = beatsToSeconds(
      state.settings.loop.mode === "ab" ? state.settings.loop.startBeat : 0,
      state.settings.bpm
    );
    state.forceRenderReset = true;
    syncTransport(state);
  });

  refs.loopButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.loopMode;
      if (mode === "none" || mode === "full" || mode === "ab") {
        state.settings.loop.mode = mode;
        state.forceRenderReset = true;
        syncTransport(state);
        persist(state);
      }
    });
  });

  bindNumericInput(refs.loopStartInput, () => {
    state.settings.loop.startBeat = parseClampedNumber(
      refs.loopStartInput.value,
      0,
      99999,
      0
    );
    refs.loopStartInput.value = String(state.settings.loop.startBeat);
    if (state.settings.loop.endBeat <= state.settings.loop.startBeat) {
      state.settings.loop.endBeat = state.settings.loop.startBeat + 0.25;
      refs.loopEndInput.value = String(state.settings.loop.endBeat);
    }
    state.forceRenderReset = true;
    persist(state);
  });

  bindNumericInput(refs.loopEndInput, () => {
    state.settings.loop.endBeat = Math.max(
      state.settings.loop.startBeat + 0.25,
      parseClampedNumber(refs.loopEndInput.value, 0.25, 99999, 16)
    );
    refs.loopEndInput.value = String(state.settings.loop.endBeat);
    state.forceRenderReset = true;
    persist(state);
  });

  bindNumericInput(refs.exportFpsInput, () => {
    state.settings.export.fps = parseClampedNumber(
      refs.exportFpsInput.value,
      1,
      120,
      30
    );
    refs.exportFpsInput.value = String(state.settings.export.fps);
    persist(state);
  });

  bindNumericInput(refs.exportStartInput, () => {
    state.settings.export.startBeat = parseClampedNumber(
      refs.exportStartInput.value,
      0,
      99999,
      0
    );
    refs.exportStartInput.value = String(state.settings.export.startBeat);
    if (state.settings.export.endBeat <= state.settings.export.startBeat) {
      state.settings.export.endBeat = state.settings.export.startBeat + 0.25;
      refs.exportEndInput.value = String(state.settings.export.endBeat);
    }
    persist(state);
  });

  bindNumericInput(refs.exportEndInput, () => {
    state.settings.export.endBeat = Math.max(
      state.settings.export.startBeat + 0.25,
      parseClampedNumber(refs.exportEndInput.value, 0.25, 99999, 16)
    );
    refs.exportEndInput.value = String(state.settings.export.endBeat);
    persist(state);
  });

  refs.exportButton.addEventListener("click", () => {
    void exportVideo(state);
  });

  refs.patternButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.patternMode;
      if (mode === "mirror" || mode === "repeat") {
        state.settings.media.patternMode = mode;
        syncPatternButtons(state);
        persist(state);
      }
    });
  });

  bindNumericInput(refs.mediaOffsetXInput, () => {
    state.settings.media.offsetX = parseClampedNumber(
      refs.mediaOffsetXInput.value,
      -100000,
      100000,
      0
    );
    refs.mediaOffsetXInput.value = String(state.settings.media.offsetX);
    persist(state);
  });

  bindNumericInput(refs.mediaOffsetYInput, () => {
    state.settings.media.offsetY = parseClampedNumber(
      refs.mediaOffsetYInput.value,
      -100000,
      100000,
      0
    );
    refs.mediaOffsetYInput.value = String(state.settings.media.offsetY);
    persist(state);
  });

  bindNumericInput(refs.mediaScaleInput, () => {
    state.settings.media.scale = parseClampedNumber(
      refs.mediaScaleInput.value,
      0.01,
      100,
      1
    );
    refs.mediaScaleInput.value = String(state.settings.media.scale);
    persist(state);
  });

  bindNumericInput(refs.mediaAspectXInput, () => {
    state.settings.media.aspectX = parseClampedNumber(
      refs.mediaAspectXInput.value,
      0.01,
      100,
      1
    );
    refs.mediaAspectXInput.value = String(state.settings.media.aspectX);
    persist(state);
  });

  bindNumericInput(refs.mediaAspectYInput, () => {
    state.settings.media.aspectY = parseClampedNumber(
      refs.mediaAspectYInput.value,
      0.01,
      100,
      1
    );
    refs.mediaAspectYInput.value = String(state.settings.media.aspectY);
    persist(state);
  });

  bindNumericInput(refs.fpsInput, () => {
    state.settings.media.fps = parseClampedNumber(refs.fpsInput.value, 1, 240, 30);
    refs.fpsInput.value = String(state.settings.media.fps);
    state.forceRenderReset = true;
    persist(state);
    void rebuildVideoFrameCache(state);
  });
  bindNumericInput(refs.startFrameInput, () => {
    state.settings.media.startFrame = Math.max(
      0,
      Math.round(Number(refs.startFrameInput.value))
    );
    refs.startFrameInput.value = String(state.settings.media.startFrame);
    if (state.settings.media.endFrame < state.settings.media.startFrame) {
      state.settings.media.endFrame = state.settings.media.startFrame;
      refs.endFrameInput.value = String(state.settings.media.endFrame);
    }
    state.forceRenderReset = true;
    persist(state);
    void rebuildVideoFrameCache(state);
  });
  bindNumericInput(refs.endFrameInput, () => {
    state.settings.media.endFrame = Math.max(
      state.settings.media.startFrame,
      Math.round(Number(refs.endFrameInput.value))
    );
    refs.endFrameInput.value = String(state.settings.media.endFrame);
    state.forceRenderReset = true;
    persist(state);
    void rebuildVideoFrameCache(state);
  });

  bindCommittedInput(refs.backgroundInput, () => {
    state.settings.mask.backgroundColor = refs.backgroundInput.value;
    refs.previewStage.style.backgroundColor = state.settings.mask.backgroundColor;
    persist(state);
  });

  bindNumericInput(refs.maskWidthInput, () => {
    state.settings.mask.width = parseClampedNumber(
      refs.maskWidthInput.value,
      80,
      4000,
      640
    );
    refs.maskWidthInput.value = String(state.settings.mask.width);
    persist(state);
  });
  bindNumericInput(refs.maskHeightInput, () => {
    state.settings.mask.height = parseClampedNumber(
      refs.maskHeightInput.value,
      80,
      4000,
      360
    );
    refs.maskHeightInput.value = String(state.settings.mask.height);
    persist(state);
  });

  refs.borderEnabledInput.addEventListener("change", () => {
    state.settings.mask.borderEnabled = refs.borderEnabledInput.checked;
    persist(state);
  });

  bindCommittedInput(refs.borderColorInput, () => {
    state.settings.mask.borderColor = refs.borderColorInput.value;
    persist(state);
  });

  bindNumericInput(refs.borderWidthInput, () => {
    state.settings.mask.borderWidth = parseClampedNumber(
      refs.borderWidthInput.value,
      0,
      32,
      2
    );
    refs.borderWidthInput.value = String(state.settings.mask.borderWidth);
    persist(state);
  });

  bindMaskDrag(state);
}

function loop(state: AppState): void {
  const tick = (): void => {
    if (state.isExporting) {
      state.rafId = window.requestAnimationFrame(tick);
      return;
    }

    const playback = getPlaybackState(state);
    const durationBeats = getProjectDurationBeats(state);
    const looped = applyLoop(
      playback.elapsedSec,
      state.settings.bpm,
      durationBeats,
      state.settings.loop
    );

    state.renderer.render({
      settings: state.settings,
      triggers: state.triggers,
      timeSec: looped.timeSec,
      isPlaying: state.isPlaying,
      forceReset: state.forceRenderReset
    });
    state.forceRenderReset = false;
    syncRuntimeStatus(state, looped.timeSec, looped.beat);
    state.rafId = window.requestAnimationFrame(tick);
  };

  tick();
}

async function loadMidiFile(state: AppState): Promise<void> {
  const file = state.refs.midiInput.files?.[0];
  if (!file) {
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const parsed = parseMidiProject(buffer, state.settings.tracks);
    state.midi = parsed.midi;
    state.project = parsed.project;
    state.refs.midiName.textContent = file.name;
    for (const track of parsed.project.tracks) {
      state.settings.tracks[track.id] = track.selected;
    }
    rebuildTriggers(state);
    renderTrackList(state);
    state.forceRenderReset = true;
    persist(state);
  } catch (error) {
    state.refs.midiName.textContent =
      error instanceof Error ? `読込失敗: ${error.message}` : "読込失敗";
  }
}

async function loadMediaFile(state: AppState): Promise<void> {
  const file = state.refs.mediaInput.files?.[0];
  if (!file) {
    return;
  }

  disposeMedia(state);
  const loadToken = ++state.videoCacheBuildToken;
  state.refs.playButton.disabled = true;
  state.refs.exportButton.disabled = true;
  state.refs.mediaName.textContent = `${file.name} loading...`;

  try {
    const asset = file.type.startsWith("video/")
      ? await loadVideoAsset(file, state.settings, (done, total) => {
          if (state.videoCacheBuildToken === loadToken) {
            state.refs.mediaName.textContent = `${file.name} preparing frames ${done}/${total}`;
          }
        })
      : await loadImageAsset(file);
    if (state.videoCacheBuildToken !== loadToken) {
      disposeMediaAsset(asset);
      return;
    }
    state.media = asset;
    state.settings.media.kind = asset.kind;
    state.renderer.setMedia(asset);
    state.refs.mediaName.textContent = formatMediaAssetName(asset);
    state.refs.previewEmpty.hidden = true;
    syncMediaControls(state);
    state.forceRenderReset = true;
    persist(state);
  } catch (error) {
    if (state.videoCacheBuildToken !== loadToken) {
      return;
    }
    state.refs.mediaName.textContent =
      error instanceof Error ? `読込失敗: ${error.message}` : "読込失敗";
  } finally {
    if (state.videoCacheBuildToken === loadToken) {
      state.refs.playButton.disabled = false;
      state.refs.exportButton.disabled = false;
    }
  }
}

async function loadImageAsset(file: File): Promise<MediaAsset> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();

  return {
    kind: "image",
    name: file.name,
    url,
    width: image.naturalWidth,
    height: image.naturalHeight,
    texture: Texture.from(image, true)
  };
}

async function loadVideoAsset(
  file: File,
  settings: AppSettings,
  onProgress?: (done: number, total: number) => void
): Promise<MediaAsset> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  await waitForEvent(video, "loadedmetadata");
  if (video.readyState < 2) {
    await waitForEvent(video, "loadeddata");
  }
  const sourceWidth = video.videoWidth || 1920;
  const sourceHeight = video.videoHeight || 1080;
  const { width, height } = getVideoFrameCacheSize(sourceWidth, sourceHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("動画フレーム用canvasを作成できませんでした。");
  }

  const cache = await buildVideoFrameCache(video, settings, width, height, onProgress);
  const asset: MediaAsset = {
    kind: "video",
    name: file.name,
    url,
    width,
    height,
    texture: Texture.from(canvas, true),
    video,
    videoCanvas: canvas,
    videoContext: context,
    videoFrameCache: cache
  };
  drawCachedVideoFrame(asset, cache.startFrame);
  return asset;
}

function disposeMedia(state: AppState): void {
  if (!state.media) {
    return;
  }

  state.videoCacheBuildToken += 1;
  state.renderer.setMedia(null);
  disposeMediaAsset(state.media);
  state.media = null;
}

function disposeMediaAsset(media: MediaAsset): void {
  media.video?.pause();
  releaseVideoFrameCache(media.videoFrameCache);
  media.texture.destroy(true);
  URL.revokeObjectURL(media.url);
}

async function rebuildVideoFrameCache(state: AppState): Promise<void> {
  const media = state.media;
  if (
    !media ||
    media.kind !== "video" ||
    !media.video ||
    !media.videoCanvas ||
    !media.videoContext ||
    isVideoFrameCacheReady(media, state.settings)
  ) {
    return;
  }

  const buildToken = ++state.videoCacheBuildToken;
  state.isPlaying = false;
  state.refs.playButton.disabled = true;
  state.refs.exportButton.disabled = true;
  state.refs.mediaName.textContent = `${media.name} preparing frames...`;
  syncTransport(state);

  try {
    const cache = await buildVideoFrameCache(
      media.video,
      state.settings,
      media.width,
      media.height,
      (done, total) => {
        if (state.videoCacheBuildToken === buildToken && state.media === media) {
          state.refs.mediaName.textContent = `${media.name} preparing frames ${done}/${total}`;
        }
      }
    );

    if (state.videoCacheBuildToken !== buildToken || state.media !== media) {
      releaseVideoFrameCache(cache);
      return;
    }

    releaseVideoFrameCache(media.videoFrameCache);
    media.videoFrameCache = cache;
    media.displayedVideoFrame = undefined;
    drawCachedVideoFrame(media, cache.startFrame);
    state.forceRenderReset = true;
    state.refs.mediaName.textContent = formatMediaAssetName(media);
  } catch (error) {
    if (state.videoCacheBuildToken === buildToken && state.media === media) {
      state.refs.mediaName.textContent =
        error instanceof Error ? `Frame cache failed: ${error.message}` : "Frame cache failed";
    }
  } finally {
    if (state.videoCacheBuildToken === buildToken && state.media === media) {
      state.refs.playButton.disabled = false;
      state.refs.exportButton.disabled = false;
      syncTransport(state);
    }
  }
}

function formatMediaAssetName(media: MediaAsset): string {
  const frameCount = media.videoFrameCache?.frames.length;
  const frameSuffix = frameCount ? `, ${frameCount} frames cached` : "";
  return `${media.name} (${media.width}x${media.height}${frameSuffix})`;
}

async function exportVideo(state: AppState): Promise<void> {
  if (state.isExporting) {
    return;
  }

  if (!state.media) {
    state.refs.exportStatus.textContent = "素材を読み込んでください";
    return;
  }

  if (state.media.kind === "video" && !isVideoFrameCacheReady(state.media, state.settings)) {
    await rebuildVideoFrameCache(state);
    if (!state.media || !isVideoFrameCacheReady(state.media, state.settings)) {
      state.refs.exportStatus.textContent = "Video frames are not ready.";
      return;
    }
  }

  const sourceCanvas = state.renderer.getCanvas();
  const exportCanvas = document.createElement("canvas");
  if (typeof exportCanvas.captureStream !== "function") {
    state.refs.exportStatus.textContent = "このブラウザは書き出し非対応です";
    return;
  }

  if (typeof MediaRecorder === "undefined") {
    state.refs.exportStatus.textContent = "MediaRecorder非対応です";
    return;
  }

  const mimeType = getSupportedVideoMimeType();
  if (!mimeType) {
    state.refs.exportStatus.textContent = "WebM書き出し非対応です";
    return;
  }

  const fps = Math.max(1, Math.min(120, state.settings.export.fps));
  const startBeat = Math.max(0, state.settings.export.startBeat);
  const endBeat = Math.max(startBeat + 0.25, state.settings.export.endBeat);
  const startSec = beatsToSeconds(startBeat, state.settings.bpm);
  const endSec = beatsToSeconds(endBeat, state.settings.bpm);
  const durationSec = Math.max(1 / fps, endSec - startSec);
  const previousElapsedSec = getPlaybackState(state).elapsedSec;

  state.isExporting = true;
  state.isPlaying = false;
  state.refs.exportButton.disabled = true;
  state.refs.exportStatus.textContent = "準備中";
  syncTransport(state);

  state.renderer.render({
    settings: state.settings,
    triggers: state.triggers,
    timeSec: startSec,
    isPlaying: false,
    forceReset: true
  });
  const cropRect = state.renderer.getMaskRect();
  exportCanvas.width = Math.max(1, Math.round(cropRect.width));
  exportCanvas.height = Math.max(1, Math.round(cropRect.height));
  const exportContext = exportCanvas.getContext("2d");
  if (!exportContext) {
    state.refs.exportStatus.textContent = "書き出し用canvasを作成できませんでした";
    state.isExporting = false;
    state.refs.exportButton.disabled = false;
    syncTransport(state);
    return;
  }
  copyPreviewCrop(
    sourceCanvas,
    cropRect,
    exportCanvas,
    exportContext,
    state.settings.mask.backgroundColor
  );

  const stream = exportCanvas.captureStream(fps);
  const track = stream.getVideoTracks()[0];
  const requestFrame =
    track && "requestFrame" in track
      ? (): void => {
          (track as CanvasCaptureMediaStreamTrack).requestFrame();
        }
      : (): void => {};
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 12_000_000
  });
  const chunks: BlobPart[] = [];
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    });
    recorder.addEventListener("error", () => {
      reject(new Error("動画の書き出しに失敗しました。"));
    });
    recorder.addEventListener("stop", () => {
      resolve(new Blob(chunks, { type: mimeType }));
    });
  });

  try {
    state.renderer.render({
      settings: state.settings,
      triggers: state.triggers,
      timeSec: startSec,
      isPlaying: false,
      forceReset: true
    });
    copyPreviewCrop(
      sourceCanvas,
      cropRect,
      exportCanvas,
      exportContext,
      state.settings.mask.backgroundColor
    );
    requestFrame();
    await delay(120);

    recorder.start(250);
    const totalFrames = Math.max(1, Math.ceil(durationSec * fps));
    const startedAt = performance.now();

    for (let frame = 0; frame <= totalFrames; frame += 1) {
      const targetTime = startedAt + (frame / fps) * 1000;
      const waitMs = targetTime - performance.now();
      if (waitMs > 0) {
        await delay(waitMs);
      }

      const elapsedSec = Math.min(durationSec, frame / fps);
      const timeSec = startSec + elapsedSec;
      state.renderer.render({
        settings: state.settings,
        triggers: state.triggers,
        timeSec,
        isPlaying: frame < totalFrames,
        forceReset: frame === 0
      });
      copyPreviewCrop(
        sourceCanvas,
        cropRect,
        exportCanvas,
        exportContext,
        state.settings.mask.backgroundColor
      );
      requestFrame();
      syncRuntimeStatus(state, timeSec, secondsToBeats(timeSec, state.settings.bpm));
      state.refs.exportStatus.textContent = `書き出し中 ${Math.round(
        (elapsedSec / durationSec) * 100
      )}%`;
    }

    await delay(120);
    recorder.stop();
    const blob = await stopped;
    if (blob.size <= 0) {
      throw new Error("書き出しデータが空です。");
    }

    downloadBlob(blob, createExportFileName());
    state.refs.exportStatus.textContent = "書き出し完了";
  } catch (error) {
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    state.refs.exportStatus.textContent =
      error instanceof Error ? error.message : "書き出しに失敗しました";
  } finally {
    stream.getTracks().forEach((streamTrack) => streamTrack.stop());
    state.pausedElapsedSec = previousElapsedSec;
    state.isPlaying = false;
    state.isExporting = false;
    state.refs.exportButton.disabled = false;
    state.renderer.render({
      settings: state.settings,
      triggers: state.triggers,
      timeSec: previousElapsedSec,
      isPlaying: false,
      forceReset: true
    });
    syncRuntimeStatus(
      state,
      previousElapsedSec,
      secondsToBeats(previousElapsedSec, state.settings.bpm)
    );
    syncTransport(state);
    state.forceRenderReset = false;
  }
}

function rebuildTriggers(state: AppState): void {
  state.triggers = buildMidiTriggers(
    state.midi,
    state.settings.bpm,
    state.project?.tracks ?? []
  );
  state.refs.triggerStatus.textContent = `${state.triggers.length}件`;
}

function renderTrackList(state: AppState): void {
  const project = state.project;
  if (!project) {
    state.refs.trackList.textContent = "未読込";
    return;
  }

  state.refs.trackList.innerHTML = project.tracks
    .map(
      (track) => `
        <label class="track-row">
          <input
            type="checkbox"
            data-track-id="${track.id}"
            ${track.selected ? "checked" : ""}
          />
          <span>${escapeHtml(track.name)}</span>
          <strong>${track.noteCount}</strong>
        </label>
      `
    )
    .join("");

  state.refs.trackList.querySelectorAll<HTMLInputElement>("[data-track-id]").forEach(
    (input) => {
      input.addEventListener("change", () => {
        const track = project.tracks.find((entry) => entry.id === input.dataset.trackId);
        if (!track) {
          return;
        }
        track.selected = input.checked;
        state.settings.tracks[track.id] = track.selected;
        rebuildTriggers(state);
        state.forceRenderReset = true;
        persist(state);
      });
    }
  );
}

function renderAnimationEffects(state: AppState, phase: EffectPhase): void {
  const container = phase === "enter" ? state.refs.enterEffects : state.refs.exitEffects;
  const effects = state.settings.animations[phase];
  container.innerHTML = effects.map(renderEffectHtml).join("");

  container.querySelectorAll<HTMLElement>("[data-effect-id]").forEach((card) => {
    const effectId = card.dataset.effectId;
    const effect = effects.find((entry) => entry.id === effectId);
    if (!effect) {
      return;
    }

    const handleEffectChange = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
        return;
      }
      const liveEffect = findEffect(state, phase, effect.id);
      if (!liveEffect) {
        return;
      }
      updateEffectFromControl(liveEffect, target);
      applyAnimationChange(state);
    };

    card.addEventListener("change", handleEffectChange);

    const curveMount = card.querySelector<HTMLElement>("[data-effect-curve]");
    if (curveMount && effect.type !== "flip") {
      new BezierEditor(curveMount, effect.curve, (curve) => {
        const liveEffect = findEffect(state, phase, effect.id);
        if (!liveEffect) {
          return;
        }
        liveEffect.curve = curve;
        applyAnimationChange(state);
      });
    }
  });
}

function applyAnimationChange(state: AppState): void {
  state.forceRenderReset = true;
  persist(state);
}

function findEffect(
  state: AppState,
  phase: EffectPhase,
  effectId: string
): AnimationEffect | null {
  return (
    state.settings.animations[phase].find((effect) => effect.id === effectId) ?? null
  );
}

function renderEffectHtml(effect: AnimationEffect): string {
  return `
    <article class="effect-card" data-effect-id="${effect.id}">
      <label class="effect-card__header">
        <input type="checkbox" data-effect-field="enabled" ${effect.enabled ? "checked" : ""} />
        <span>${effect.label}</span>
      </label>
      ${effect.type === "flip" ? renderFlipParams(effect) : renderTimedEffectParams(effect)}
    </article>
  `;
}

function renderTimedEffectParams(effect: Exclude<AnimationEffect, { type: "flip" }>): string {
  const common = `
    <label class="mini-control">
      <span>拍数</span>
      <input data-effect-field="durationBeats" type="number" min="0" step="0.05" value="${effect.durationBeats}" />
    </label>
  `;

  const params =
    effect.type === "move"
      ? `
          <div class="mini-control-row">
            ${numberField("開始X", "startX", effect.params.startX)}
            ${numberField("開始Y", "startY", effect.params.startY)}
          </div>
          <div class="mini-control-row">
            ${numberField("終了X", "endX", effect.params.endX)}
            ${numberField("終了Y", "endY", effect.params.endY)}
          </div>
        `
      : effect.type === "scale"
        ? `
          <div class="mini-control-row">
            ${numberField("開始", "start", effect.params.start, 0.01)}
            ${numberField("終了", "end", effect.params.end, 0.01)}
          </div>
        `
        : effect.type === "rotate"
          ? `
          <div class="mini-control-row">
            ${numberField("開始度", "startDeg", effect.params.startDeg)}
            ${numberField("終了度", "endDeg", effect.params.endDeg)}
          </div>
        `
          : `
          ${numberField("角度", "angleDeg", effect.params.angleDeg)}
          <div class="mini-control-row">
            ${numberField("開始強度", "startStrength", effect.params.startStrength, 0.1)}
            ${numberField("終了強度", "endStrength", effect.params.endStrength, 0.1)}
          </div>
        `;

  return `
    <div class="effect-body">
      <div class="curve-block compact">
        <span>イージング</span>
        <div data-effect-curve></div>
      </div>
      <div class="effect-grid">
        ${common}
        ${params}
      </div>
    </div>
  `;
}

function renderFlipParams(effect: Extract<AnimationEffect, { type: "flip" }>): string {
  return `
    <label class="mini-control">
      <span>方向</span>
      <select data-effect-param="axis">
        <option value="horizontal" ${effect.params.axis === "horizontal" ? "selected" : ""}>左右</option>
        <option value="vertical" ${effect.params.axis === "vertical" ? "selected" : ""}>上下</option>
        <option value="both" ${effect.params.axis === "both" ? "selected" : ""}>上下左右</option>
      </select>
    </label>
  `;
}

function numberField(label: string, field: string, value: number, step = 1): string {
  return `
    <label class="mini-control">
      <span>${label}</span>
      <input data-effect-param="${field}" type="number" step="${step}" value="${value}" />
    </label>
  `;
}

function updateEffectFromControl(
  effect: AnimationEffect,
  target: HTMLInputElement | HTMLSelectElement
): void {
  const effectField = target.dataset.effectField;
  if (effectField === "enabled" && target instanceof HTMLInputElement) {
    effect.enabled = target.checked;
    return;
  }

  if (effectField === "durationBeats" && target instanceof HTMLInputElement) {
    effect.durationBeats = Math.max(0, Number(target.value) || 0);
    return;
  }

  const param = target.dataset.effectParam;
  if (!param) {
    return;
  }

  if (effect.type === "flip" && param === "axis") {
    const axis = target.value;
    if (axis === "horizontal" || axis === "vertical" || axis === "both") {
      effect.params.axis = axis;
    }
    return;
  }

  if (target instanceof HTMLInputElement) {
    const value = Number(target.value);
    if (Number.isFinite(value)) {
      (effect.params as Record<string, number>)[param] = value;
    }
  }
}

function syncAllControls(state: AppState): void {
  const { refs, settings } = state;
  refs.bpmInput.value = String(settings.bpm);
  refs.loopStartInput.value = String(settings.loop.startBeat);
  refs.loopEndInput.value = String(settings.loop.endBeat);
  refs.exportFpsInput.value = String(settings.export.fps);
  refs.exportStartInput.value = String(settings.export.startBeat);
  refs.exportEndInput.value = String(settings.export.endBeat);
  refs.fpsInput.value = String(settings.media.fps);
  refs.startFrameInput.value = String(settings.media.startFrame);
  refs.endFrameInput.value = String(settings.media.endFrame);
  refs.mediaOffsetXInput.value = String(settings.media.offsetX);
  refs.mediaOffsetYInput.value = String(settings.media.offsetY);
  refs.mediaScaleInput.value = String(settings.media.scale);
  refs.mediaAspectXInput.value = String(settings.media.aspectX);
  refs.mediaAspectYInput.value = String(settings.media.aspectY);
  refs.backgroundInput.value = settings.mask.backgroundColor;
  refs.maskWidthInput.value = String(settings.mask.width);
  refs.maskHeightInput.value = String(settings.mask.height);
  refs.borderEnabledInput.checked = settings.mask.borderEnabled;
  refs.borderColorInput.value = settings.mask.borderColor;
  refs.borderWidthInput.value = String(settings.mask.borderWidth);
  refs.previewStage.style.backgroundColor = settings.mask.backgroundColor;
  syncTransport(state);
  syncPatternButtons(state);
  syncMediaControls(state);
  renderTrackList(state);
}

function syncTransport(state: AppState): void {
  state.refs.playButton.textContent = state.isPlaying ? "停止" : "再生";
  state.refs.loopButtons.forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.loopMode === state.settings.loop.mode
    );
  });
  state.refs.loopRange.hidden = state.settings.loop.mode !== "ab";
}

function syncPatternButtons(state: AppState): void {
  state.refs.patternButtons.forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.patternMode === state.settings.media.patternMode
    );
  });
}

function syncMediaControls(state: AppState): void {
  state.refs.videoPanel.hidden = state.media?.kind !== "video";
}

function syncRuntimeStatus(state: AppState, timeSec: number, beat: number): void {
  const triggerIndex = findCurrentTriggerIndex(state.triggers, timeSec);
  const triggerLabel =
    triggerIndex >= 0 ? ` / #${triggerIndex + 1}` : state.triggers.length ? " / 待機" : "";
  state.refs.clockStatus.textContent = `${formatTime(timeSec)} / ${beat.toFixed(2)}拍${triggerLabel}`;
}

function startPlayback(state: AppState): void {
  state.isPlaying = true;
  state.playbackStartedAt = performance.now();
  syncTransport(state);
}

function pausePlayback(state: AppState): void {
  state.pausedElapsedSec = getPlaybackState(state).elapsedSec;
  state.isPlaying = false;
  syncTransport(state);
}

function getPlaybackState(state: AppState): { elapsedSec: number } {
  if (!state.isPlaying) {
    return { elapsedSec: state.pausedElapsedSec };
  }

  return {
    elapsedSec:
      state.pausedElapsedSec + (performance.now() - state.playbackStartedAt) / 1000
  };
}

function getProjectDurationBeats(state: AppState): number {
  if (state.project && state.project.durationBeats > 0) {
    return state.project.durationBeats;
  }

  const lastTrigger = state.triggers.at(-1);
  return Math.max(state.settings.loop.endBeat, lastTrigger ? lastTrigger.beat + 1 : 16);
}

function bindMaskDrag(state: AppState): void {
  let drag:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        width: number;
        height: number;
      }
    | null = null;

  state.refs.maskHandle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: state.settings.mask.width,
      height: state.settings.mask.height
    };
    state.refs.maskHandle.setPointerCapture(event.pointerId);
  });

  state.refs.maskHandle.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    state.settings.mask.width = Math.max(80, drag.width + (event.clientX - drag.startX) * 2);
    state.settings.mask.height = Math.max(
      80,
      drag.height + (event.clientY - drag.startY) * 2
    );
    state.refs.maskWidthInput.value = String(Math.round(state.settings.mask.width));
    state.refs.maskHeightInput.value = String(Math.round(state.settings.mask.height));
    persist(state);
  });

  state.refs.maskHandle.addEventListener("pointerup", (event) => {
    if (drag?.pointerId === event.pointerId) {
      drag = null;
    }
  });
}

function positionMaskHandle(refs: DomRefs, rect: MaskRect): void {
  const hostRect = refs.previewStage.getBoundingClientRect();
  const left = (rect.x + rect.width) * (hostRect.width / rect.stageWidth);
  const top = (rect.y + rect.height) * (hostRect.height / rect.stageHeight);
  refs.maskHandle.style.left = `${left}px`;
  refs.maskHandle.style.top = `${top}px`;
}

function persist(state: AppState): void {
  normalizeSettings(state.settings);
  saveSettings(state.settings);
}

function bindNumericInput(input: HTMLInputElement, callback: () => void): void {
  bindCommittedInput(input, callback);
}

function bindCommittedInput(input: HTMLInputElement, callback: () => void): void {
  input.addEventListener("change", callback);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      input.blur();
    }
  });
}

function parseClampedNumber(
  value: string,
  min: number,
  max: number,
  fallback: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function copyPreviewCrop(
  sourceCanvas: HTMLCanvasElement,
  cropRect: MaskRect,
  exportCanvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  backgroundColor: string
): void {
  const sourceScaleX = sourceCanvas.width / Math.max(1, cropRect.stageWidth);
  const sourceScaleY = sourceCanvas.height / Math.max(1, cropRect.stageHeight);
  const sourceX = cropRect.x * sourceScaleX;
  const sourceY = cropRect.y * sourceScaleY;
  const sourceWidth = cropRect.width * sourceScaleX;
  const sourceHeight = cropRect.height * sourceScaleY;

  context.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  context.drawImage(
    sourceCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    exportCanvas.width,
    exportCanvas.height
  );
}

function getSupportedVideoMimeType(): string | null {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createExportFileName(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");

  return `otomad-export_${stamp}.webm`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
}

function waitForEvent(target: EventTarget, eventName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLoad = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error("ファイルを読み込めませんでした。"));
    };
    const cleanup = (): void => {
      target.removeEventListener(eventName, onLoad);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(eventName, onLoad, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  const duration = Number.isFinite(video.duration) ? video.duration : timeSec;
  const targetTime = Math.min(Math.max(0, timeSec), Math.max(0, duration));

  if (Math.abs(video.currentTime - targetTime) < 0.005 && video.readyState >= 2) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error("動画フレームのシークに失敗しました。"));
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = targetTime;
  });
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mustQuery<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required element not found: ${selector}`);
  }

  return element;
}

class BezierEditor {
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private curve: BezierCurve;
  private activeHandle: "p1" | "p2" | null = null;

  constructor(
    mount: HTMLElement,
    curve: BezierCurve,
    private readonly onChange: (curve: BezierCurve) => void
  ) {
    this.curve = normalizeCurve(curve);
    this.canvas.width = 220;
    this.canvas.height = 140;
    this.canvas.className = "curve-editor";
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context is unavailable.");
    }
    this.ctx = ctx;
    mount.appendChild(this.canvas);
    this.bind();
    this.draw();
  }

  private bind(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      const point = this.getPoint(event);
      const p1 = this.toCanvasPoint(this.curve.x1, this.curve.y1);
      const p2 = this.toCanvasPoint(this.curve.x2, this.curve.y2);
      this.activeHandle = distance(point, p1) < distance(point, p2) ? "p1" : "p2";
      this.canvas.setPointerCapture(event.pointerId);
      this.updateFromPointer(event);
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.activeHandle) {
        return;
      }
      this.updateFromPointer(event);
    });

    this.canvas.addEventListener("pointerup", () => {
      this.activeHandle = null;
    });
  }

  private updateFromPointer(event: PointerEvent): void {
    const point = this.getPoint(event);
    const normalized = this.fromCanvasPoint(point);
    if (this.activeHandle === "p1") {
      this.curve = { ...this.curve, x1: normalized.x, y1: normalized.y };
    }
    if (this.activeHandle === "p2") {
      this.curve = { ...this.curve, x2: normalized.x, y2: normalized.y };
    }
    this.onChange(this.curve);
    this.draw();
  }

  private draw(): void {
    const { ctx, canvas } = this;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#d8ddd8";
    ctx.lineWidth = 1;

    for (let i = 1; i < 4; i += 1) {
      const x = (width / 4) * i;
      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const p0 = this.toCanvasPoint(0, 0);
    const p1 = this.toCanvasPoint(this.curve.x1, this.curve.y1);
    const p2 = this.toCanvasPoint(this.curve.x2, this.curve.y2);
    const p3 = this.toCanvasPoint(1, 1);

    ctx.strokeStyle = "#aab3aa";
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.stroke();

    ctx.strokeStyle = "#2f7d68";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 64; i += 1) {
      const x = i / 64;
      const y = evaluateBezier(this.curve, x);
      const point = this.toCanvasPoint(x, y);
      if (i === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.stroke();

    this.drawHandle(p1);
    this.drawHandle(p2);
  }

  private drawHandle(point: { x: number; y: number }): void {
    this.ctx.fillStyle = "#d26342";
    this.ctx.beginPath();
    this.ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private getPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * this.canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * this.canvas.height
    };
  }

  private toCanvasPoint(x: number, y: number): { x: number; y: number } {
    return {
      x: x * this.canvas.width,
      y: (1 - y) * this.canvas.height
    };
  }

  private fromCanvasPoint(point: { x: number; y: number }): { x: number; y: number } {
    return {
      x: Math.min(1, Math.max(0, point.x / this.canvas.width)),
      y: Math.min(1, Math.max(0, 1 - point.y / this.canvas.height))
    };
  }
}

function distance(
  left: { x: number; y: number },
  right: { x: number; y: number }
): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
