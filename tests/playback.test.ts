import { describe, expect, it } from "vitest";
import { applyLoop, findCurrentTriggerIndex } from "../src/playback";
import type { MidiTrigger } from "../src/types";

describe("playback helpers", () => {
  it("wraps full MIDI loops by beat length", () => {
    const result = applyLoop(5, 120, 4, {
      mode: "full",
      startBeat: 0,
      endBeat: 4
    });

    expect(result.beat).toBeCloseTo(2);
    expect(result.timeSec).toBeCloseTo(1);
    expect(result.wrapped).toBe(true);
  });

  it("wraps A-B loops by beat range", () => {
    const result = applyLoop(5, 120, 16, {
      mode: "ab",
      startBeat: 4,
      endBeat: 8
    });

    expect(result.beat).toBeCloseTo(6);
    expect(result.timeSec).toBeCloseTo(3);
  });

  it("finds the latest trigger at or before the current time", () => {
    const triggers: MidiTrigger[] = [
      { tick: 0, beat: 0, timeSec: 0 },
      { tick: 480, beat: 1, timeSec: 0.5 },
      { tick: 960, beat: 2, timeSec: 1 }
    ];

    expect(findCurrentTriggerIndex(triggers, -0.1)).toBe(-1);
    expect(findCurrentTriggerIndex(triggers, 0.5)).toBe(1);
    expect(findCurrentTriggerIndex(triggers, 0.9)).toBe(1);
    expect(findCurrentTriggerIndex(triggers, 2)).toBe(2);
  });
});
