import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import { buildMidiTriggers, getTrackId, parseMidiProject } from "../src/midi";

describe("MIDI trigger extraction", () => {
  it("merges simultaneous notes on the same tick", () => {
    const midi = new Midi();
    midi.header.setTempo(120);
    const track = midi.addTrack();
    track.addNote({ midi: 60, ticks: 0, durationTicks: 120 });
    track.addNote({ midi: 64, ticks: 0, durationTicks: 120 });
    track.addNote({ midi: 67, ticks: midi.header.ppq, durationTicks: 120 });

    const triggers = buildMidiTriggers(midi, 120, [
      { id: getTrackId(0), name: "Track", noteCount: 3, selected: true }
    ]);

    expect(triggers).toHaveLength(2);
    expect(triggers[0]).toMatchObject({ tick: 0, beat: 0, timeSec: 0 });
    expect(triggers[1].beat).toBeCloseTo(1);
    expect(triggers[1].timeSec).toBeCloseTo(0.5);
  });

  it("excludes unselected tracks", () => {
    const midi = new Midi();
    const first = midi.addTrack();
    const second = midi.addTrack();
    first.addNote({ midi: 60, ticks: 0, durationTicks: 120 });
    second.addNote({ midi: 72, ticks: midi.header.ppq, durationTicks: 120 });

    const triggers = buildMidiTriggers(midi, 120, [
      { id: getTrackId(0), name: "A", noteCount: 1, selected: true },
      { id: getTrackId(1), name: "B", noteCount: 1, selected: false }
    ]);

    expect(triggers).toHaveLength(1);
    expect(triggers[0].tick).toBe(0);
  });

  it("parses track metadata from an encoded MIDI file", () => {
    const midi = new Midi();
    midi.addTrack().addNote({ midi: 60, ticks: 0, durationTicks: 120 });

    const bytes = midi.toArray();
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const parsed = parseMidiProject(buffer, {});

    expect(parsed.project.ppq).toBeGreaterThan(0);
    expect(parsed.project.tracks[0]).toMatchObject({
      id: getTrackId(0),
      noteCount: 1,
      selected: true
    });
  });
});
