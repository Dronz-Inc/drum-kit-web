import { BY_TRD_NOTE, normalizeMidiNote } from "./trd-mapping.mjs";

export const MAGIC = 0xA5;
export const VERSION = 0x01;
export const PACKET_SIZE = 8;
export const START_NOTE = 0x7F;

export function colorIdForNote(note) {
  const normalized = normalizeMidiNote(note);
  const pads = [...BY_TRD_NOTE.keys()].sort((a, b) => a - b);
  const idx = pads.indexOf(normalized.note);
  return idx >= 0 ? idx : 255;
}

export function checksum(bytes) {
  let sum = 0;
  for (const b of bytes) sum = (sum + (b & 0xFF)) & 0xFF;
  return sum;
}

export function encodeHit({ note, velocity = 100, ttlMs = 520, sequence = 0 }) {
  const { note: trdNote, pad } = normalizeMidiNote(note);
  if (!pad) throw new Error(`Unknown drum note: ${note}`);
  const ttlTicks = Math.max(1, Math.min(255, Math.round(ttlMs / 10)));
  const payload = [MAGIC, VERSION, trdNote & 0x7F, colorIdForNote(trdNote), Math.max(0, Math.min(127, velocity)), ttlTicks, sequence & 0xFF];
  return Uint8Array.from([...payload, checksum(payload)]);
}

export function encodeStart({ sequence = 0 } = {}) {
  const payload = [MAGIC, VERSION, START_NOTE, 0xFE, 0, 0, sequence & 0xFF];
  return Uint8Array.from([...payload, checksum(payload)]);
}

export function decodeHit(packet) {
  const bytes = Array.from(packet || []);
  if (bytes.length !== PACKET_SIZE) throw new Error(`Expected ${PACKET_SIZE} bytes, got ${bytes.length}`);
  const body = bytes.slice(0, 7);
  if (bytes[0] !== MAGIC) throw new Error("Bad magic");
  if (bytes[1] !== VERSION) throw new Error("Bad version");
  if (checksum(body) !== bytes[7]) throw new Error("Bad checksum");
  const [,, note, colorId, velocity, ttlTicks, sequence] = bytes;
  const { pad } = normalizeMidiNote(note);
  return { note, colorId, velocity, ttlMs: ttlTicks * 10, sequence, pad };
}
