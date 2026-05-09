import { BY_TRD_NOTE } from "./trd-mapping.mjs";

export const WIDTH = 64;
export const HEIGHT = 32;

const GAME_BPM = 100;
const BEAT_MS = 60000 / GAME_BPM;
const FIRST_TARGET_MS = 2400;
const BAR_TRAVEL_MS = 1800;
const HIT_WINDOW_MS = 300;
const TARGET_X = 13;
const HIT_ZONE_HALF_WIDTH = 5;
const BAR_START_X = 63;
const LANE_Y = 16;
const NOTE_LEFT_PIXELS = 1;
const NOTE_RIGHT_PIXELS = 5;
const SNARE_NOTE = 26;
const KICK_NOTE = 24;
const HIHAT_OPEN_NOTE = 34;

function color565ish([r, g, b], strength = 1) {
  return [Math.min(255, Math.round(r * strength)), Math.min(255, Math.round(g * strength)), Math.min(255, Math.round(b * strength))];
}

function addPixel(px, x, y, [r, g, b], strength = 1) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  px[y][x][0] = Math.min(255, px[y][x][0] + Math.round(r * strength));
  px[y][x][1] = Math.min(255, px[y][x][1] + Math.round(g * strength));
  px[y][x][2] = Math.min(255, px[y][x][2] + Math.round(b * strength));
}

function fillRect(px, x, y, w, h, color, strength = 1) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) addPixel(px, xx, yy, color, strength);
}

function drawLine(px, x0, y0, x1, y1, color, strength = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) addPixel(px, x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, color, strength);
}

export class RhythmGameSim {
  constructor() { this.reset(0); }

  reset(nowMs = 0) {
    this.started = true;
    this.gameStartMs = nowMs;
    this.lastResolvedTarget = -1;
    this.combo = 0;
    this.level = 1;
    this.hits = [];
    this.robotHitStartMs = -9999;
    this.lastJudgement = "hit the snare on beats 1 and 3";
  }

  expectedNoteForTarget(target) {
    if (this.level === 1) return SNARE_NOTE;
    if (this.level === 2) return (target & 1) ? KICK_NOTE : SNARE_NOTE;
    if (this.level === 3) return [SNARE_NOTE, KICK_NOTE, SNARE_NOTE, HIHAT_OPEN_NOTE][target & 3];
    return [SNARE_NOTE, KICK_NOTE, HIHAT_OPEN_NOTE, KICK_NOTE, SNARE_NOTE, KICK_NOTE, HIHAT_OPEN_NOTE, SNARE_NOTE][target & 7];
  }

  targetTimeFor(target) {
    const measure = Math.floor(target / 2);
    const beatInMeasure = (target & 1) ? 2 : 0;
    return this.gameStartMs + FIRST_TARGET_MS + measure * 4 * BEAT_MS + beatInMeasure * BEAT_MS;
  }

  noteXForTargetAt(target, nowMs) {
    const t = this.targetTimeFor(target);
    if (t - nowMs > BAR_TRAVEL_MS) return BAR_START_X + 99;
    const remaining = Math.max(0, (t - nowMs) / BAR_TRAVEL_MS);
    return TARGET_X + Math.round((BAR_START_X - TARGET_X) * remaining);
  }

  noteOverlapsHitZone(target, nowMs) {
    const x = this.noteXForTargetAt(target, nowMs);
    const noteLeft = x - NOTE_LEFT_PIXELS;
    const noteRight = x + NOTE_RIGHT_PIXELS;
    return noteRight >= TARGET_X - HIT_ZONE_HALF_WIDTH && noteLeft <= TARGET_X + HIT_ZONE_HALF_WIDTH;
  }

  updateMisses(nowMs) {
    while (this.targetTimeFor(this.lastResolvedTarget + 1) + HIT_WINDOW_MS < nowMs) {
      this.lastResolvedTarget++;
      this.combo = 0;
      this.lastJudgement = "miss — combo reset";
    }
  }

  promoteLevelIfNeeded() {
    if (this.combo >= 5 && this.level < 2) this.level = 2;
    if (this.combo >= 14 && this.level < 3) this.level = 3;
    if (this.combo >= 24 && this.level < 4) this.level = 4;
  }

  hit(note, nowMs = 0, velocity = 100) {
    this.updateMisses(nowMs);
    this.robotHitStartMs = nowMs;
    let hitTarget = -1;
    for (let n = this.lastResolvedTarget + 1; n < this.lastResolvedTarget + 5; n++) {
      if (this.targetTimeFor(n) - nowMs > BAR_TRAVEL_MS) break;
      if (this.noteOverlapsHitZone(n, nowMs) && note === this.expectedNoteForTarget(n)) { hitTarget = n; break; }
    }
    if (hitTarget >= 0) {
      this.combo = Math.min(24, this.combo + 1);
      this.promoteLevelIfNeeded();
      this.lastResolvedTarget = hitTarget;
      const pad = BY_TRD_NOTE.get(note);
      this.hits.push({ note, color: pad?.color || [255,255,255], atMs: nowMs, ttlMs: 780, power: Math.min(10, this.level + 1 + Math.floor(this.combo / 2)), seq: this.combo });
      this.lastJudgement = `perfect ${pad?.label || note}! combo x${this.combo}`;
      return true;
    }
    const pad = BY_TRD_NOTE.get(note);
    this.lastJudgement = `${pad?.label || note}: robot swings, no explosion`;
    return false;
  }

  drawBackground(px, nowMs) {
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const shimmer = ((x * 13 + y * 17 + Math.floor(nowMs / 80)) % 41 === 0) ? 18 + this.level * 8 : 0;
      px[y][x] = [0, Math.min(22, 3 + shimmer / 4), Math.min(38, 8 + shimmer)];
    }
  }

  drawRobotAndTarget(px, nowMs) {
    const target = [255, 255, 255];
    fillRect(px, TARGET_X - HIT_ZONE_HALF_WIDTH, 5, HIT_ZONE_HALF_WIDTH * 2 + 1, 23, target, 0.55);
    if ((Math.floor(nowMs / 120) & 1) === 0) fillRect(px, TARGET_X - 1, LANE_Y - 1, 3, 3, target, 1);
    fillRect(px, 2, 10, 8, 12, [60, 90, 150], 1);
    fillRect(px, 3, 11, 6, 5, [35, 180, 255], 1);
    addPixel(px, 4, 13, [255, 245, 80]); addPixel(px, 7, 13, [255, 245, 80]);
    drawLine(px, 3, 9, 1, 6, [170, 220, 255]); drawLine(px, 8, 9, 10, 6, [170, 220, 255]);
    const swing = nowMs - this.robotHitStartMs < 150;
    if (swing) drawLine(px, 10, 14, 14, 10, [255, 210, 90]);
    else drawLine(px, 10, 15, 13, 17, [255, 210, 90]);
  }

  drawBars(px, nowMs) {
    this.updateMisses(nowMs);
    for (let n = this.lastResolvedTarget + 1; n < this.lastResolvedTarget + 7; n++) {
      const t = this.targetTimeFor(n);
      if (t + HIT_WINDOW_MS < nowMs || t - nowMs > BAR_TRAVEL_MS) continue;
      const x = this.noteXForTargetAt(n, nowMs);
      const pad = BY_TRD_NOTE.get(this.expectedNoteForTarget(n));
      const color = pad?.color || [255, 232, 20];
      fillRect(px, x - 1, LANE_Y - 4, 5, 9, color, 1);
      drawLine(px, x + 5, LANE_Y - 5, x + 5, LANE_Y + 5, [255,255,255], 1);
      addPixel(px, x + 2, LANE_Y, [255,255,255], 1);
    }
  }

  drawExplosions(px, nowMs) {
    this.hits = this.hits.filter((ev) => nowMs - ev.atMs <= ev.ttlMs);
    for (const ev of this.hits) {
      const age = nowMs - ev.atMs;
      const progress = age / ev.ttlMs;
      const life = 1 - progress;
      const radius = 5 + Math.round((20 + ev.power * 5.5) * progress);
      for (let y = Math.max(0, LANE_Y - radius - 4); y <= Math.min(HEIGHT - 1, LANE_Y + radius + 4); y++) {
        for (let x = Math.max(0, TARGET_X + 2 - radius - 4); x <= Math.min(WIDTH - 1, TARGET_X + 2 + radius + 4); x++) {
          const d = Math.hypot(x - (TARGET_X + 2), y - LANE_Y);
          const ring1 = 1 - Math.abs(d - radius) / 3.2;
          const ring2 = 1 - Math.abs(d - radius * 0.55) / 2.4;
          const core = Math.max(0, 1 - d / 7) * life;
          const ripple = Math.sin(d * 0.9 + age * 0.035 + ev.power) * 0.22 * life;
          const sparkle = ((x * 11 + y * 7 + Math.floor(age / 18)) % Math.max(5, 27 - ev.power * 3) === 0) ? (0.75 + ev.power * 0.16) * life : 0;
          const strength = Math.max(0, Math.max(ring1, ring2 * 0.75) * life + core + sparkle + ripple);
          if (strength <= 0.04) continue;
          let [r, g, b] = ev.color;
          if (((x + y + ev.seq + Math.floor(age / 45)) & 3) === 0) { r = Math.min(255, r + 80 + ev.power * 8); b = Math.min(255, b + 90 + ev.power * 10); }
          if (((x * 3 + y + Math.floor(age / 35)) & 7) === 0) g = Math.min(255, g + 90 + ev.power * 8);
          if (ev.power >= 5 && ((x * 5 + y * 2 + Math.floor(age / 28)) & 5) === 0) { r = 255 - Math.floor(r / 3); g = Math.min(255, g + 120); b = 255; }
          addPixel(px, x, y, [r,g,b], Math.min(1, strength));
        }
      }
    }
  }

  frame(nowMs) {
    const px = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => [0,0,0]));
    this.drawBackground(px, nowMs);
    this.drawRobotAndTarget(px, nowMs);
    this.drawBars(px, nowMs);
    this.drawExplosions(px, nowMs);
    return px;
  }
}
