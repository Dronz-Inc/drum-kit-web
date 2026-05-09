export const TRD_PADS = Object.freeze([
  { id: "kick", label: "Kick", trdNote: 24, gmNote: 36, color: [0, 115, 48], region: "bottom-center" },
  { id: "snare", label: "Snare", trdNote: 26, gmNote: 38, color: [255, 232, 20], region: "center" },
  { id: "hihat_closed", label: "Hi-hat Closed", trdNote: 30, gmNote: 42, color: [255, 170, 220], region: "left" },
  { id: "hihat_pedal", label: "Hi-hat Pedal", trdNote: 32, gmNote: 44, color: [255, 205, 235], region: "bottom-left" },
  { id: "hihat_open", label: "Hi-hat Open", trdNote: 34, gmNote: 46, color: [190, 0, 115], region: "left-wide" },
  { id: "floor_tom", label: "Floor Tom", trdNote: 31, gmNote: 43, color: [150, 55, 255], region: "lower-right" },
  { id: "mid_tom", label: "Mid Tom", trdNote: 35, gmNote: 47, color: [85, 205, 255], region: "upper-middle" },
  { id: "high_tom", label: "High Tom", trdNote: 36, gmNote: 48, color: [0, 45, 190], region: "upper-left" },
  { id: "crash1", label: "Crash 1", trdNote: 37, gmNote: 49, color: [210, 82, 0], region: "top-left" },
  { id: "ride", label: "Ride", trdNote: 39, gmNote: 51, color: [255, 18, 25], region: "right" },
  { id: "crash2", label: "Crash 2", trdNote: 45, gmNote: 57, color: [255, 170, 45], region: "top-right" }
]);

export const BY_TRD_NOTE = new Map(TRD_PADS.map((pad) => [pad.trdNote, pad]));
export const BY_GM_NOTE = new Map(TRD_PADS.map((pad) => [pad.gmNote, pad]));
export const BY_ID = new Map(TRD_PADS.map((pad) => [pad.id, pad]));

// The TRD1 over USB reports a few pads differently from the BLE/native notes
// documented earlier. Prefer these raw USB observations for live browser input.
export const BY_USB_NOTE = new Map([
  [36, BY_ID.get("kick")],
  [35, BY_ID.get("high_tom")]
]);

export function normalizeMidiNote(note, { prefer = "trd" } = {}) {
  if (prefer === "usb" && BY_USB_NOTE.has(note)) {
    const pad = BY_USB_NOTE.get(note);
    return { note: pad.trdNote, source: "usb", pad };
  }
  if (prefer === "gm" && BY_GM_NOTE.has(note)) {
    const pad = BY_GM_NOTE.get(note);
    return { note: pad.trdNote, source: "gm", pad };
  }
  if (BY_TRD_NOTE.has(note)) return { note, source: "trd", pad: BY_TRD_NOTE.get(note) };
  if (BY_GM_NOTE.has(note)) {
    const pad = BY_GM_NOTE.get(note);
    return { note: pad.trdNote, source: "gm", pad };
  }
  return { note, source: "unknown", pad: null };
}

export function parseMidiMessage(bytes, { prefer = "usb" } = {}) {
  if (!bytes || bytes.length < 1) return { kind: "empty" };
  const [status, d1 = 0, d2 = 0] = Array.from(bytes);
  const command = status & 0xF0;
  const channel = (status & 0x0F) + 1;
  if (command === 0x90 && d2 > 0) {
    return { kind: "note-on", channel, rawNote: d1, velocity: d2, ...normalizeMidiNote(d1, { prefer }) };
  }
  if (command === 0x80 || (command === 0x90 && d2 === 0)) {
    return { kind: "note-off", channel, rawNote: d1, velocity: d2, ...normalizeMidiNote(d1, { prefer }) };
  }
  if (command === 0xB0) return { kind: "cc", channel, cc: d1, value: d2 };
  return { kind: "other", channel, status, data1: d1, data2: d2 };
}
