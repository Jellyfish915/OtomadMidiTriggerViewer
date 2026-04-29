import { Midi } from "@tonejs/midi";
import type { MidiTrigger, ParsedMidiProject, TrackSelection } from "./types";

export function parseMidiProject(
  buffer: ArrayBuffer,
  savedTrackSelection: Record<string, boolean>
): { midi: Midi; project: ParsedMidiProject } {
  const midi = new Midi(buffer);
  const tracks: TrackSelection[] = midi.tracks.map((track, index) => {
    const id = getTrackId(index);
    const fallbackName =
      track.name.trim() ||
      track.instrument.name ||
      `トラック ${index + 1}`;

    return {
      id,
      name: fallbackName,
      noteCount: track.notes.length,
      selected: savedTrackSelection[id] ?? true
    };
  });

  const durationTicks = Math.max(
    midi.durationTicks,
    ...midi.tracks.map((track) => track.durationTicks)
  );

  return {
    midi,
    project: {
      name: midi.name || "Untitled MIDI",
      ppq: midi.header.ppq,
      durationTicks,
      durationBeats: ticksToBeats(durationTicks, midi.header.ppq),
      tracks
    }
  };
}

export function buildMidiTriggers(
  midi: Midi | null,
  bpm: number,
  tracks: TrackSelection[]
): MidiTrigger[] {
  if (!midi) {
    return [];
  }

  const selectedTrackIds = new Set(
    tracks.filter((track) => track.selected).map((track) => track.id)
  );
  const uniqueTicks = new Set<number>();

  midi.tracks.forEach((track, index) => {
    if (!selectedTrackIds.has(getTrackId(index))) {
      return;
    }

    for (const note of track.notes) {
      uniqueTicks.add(note.ticks);
    }
  });

  return Array.from(uniqueTicks)
    .sort((left, right) => left - right)
    .map((tick) => {
      const beat = ticksToBeats(tick, midi.header.ppq);
      return {
        tick,
        beat,
        timeSec: beatsToSeconds(beat, bpm)
      };
    });
}

export function beatsToSeconds(beat: number, bpm: number): number {
  return beat * (60 / bpm);
}

export function secondsToBeats(seconds: number, bpm: number): number {
  return seconds / (60 / bpm);
}

export function ticksToBeats(ticks: number, ppq: number): number {
  return ppq > 0 ? ticks / ppq : 0;
}

export function getTrackId(index: number): string {
  return `track-${index}`;
}
