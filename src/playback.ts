import { secondsToBeats, beatsToSeconds } from "./midi";
import type { LoopSettings, MidiTrigger } from "./types";

export function applyLoop(
  elapsedSec: number,
  bpm: number,
  durationBeats: number,
  loop: LoopSettings
): { timeSec: number; beat: number; wrapped: boolean } {
  const rawBeat = secondsToBeats(Math.max(0, elapsedSec), bpm);

  if (loop.mode === "full" && durationBeats > 0) {
    const beat = wrap(rawBeat, 0, durationBeats);
    return {
      timeSec: beatsToSeconds(beat, bpm),
      beat,
      wrapped: rawBeat >= durationBeats
    };
  }

  if (loop.mode === "ab" && loop.endBeat > loop.startBeat) {
    const beat = wrap(rawBeat, loop.startBeat, loop.endBeat);
    return {
      timeSec: beatsToSeconds(beat, bpm),
      beat,
      wrapped: rawBeat >= loop.endBeat || rawBeat < loop.startBeat
    };
  }

  return {
    timeSec: elapsedSec,
    beat: rawBeat,
    wrapped: false
  };
}

export function findCurrentTriggerIndex(
  triggers: MidiTrigger[],
  timeSec: number
): number {
  let lower = 0;
  let upper = triggers.length - 1;
  let result = -1;

  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (triggers[middle].timeSec <= timeSec + 0.00001) {
      result = middle;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }

  return result;
}

function wrap(value: number, start: number, end: number): number {
  const span = end - start;
  if (span <= 0) {
    return start;
  }

  return ((((value - start) % span) + span) % span) + start;
}
