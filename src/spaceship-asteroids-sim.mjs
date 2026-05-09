import { BY_TRD_NOTE, TRD_PADS } from "./trd-mapping.mjs";

export const WIDTH = 64;
export const HEIGHT = 32;

const SHIP_X = 8;
const SHIP_Y = 16;
const ASTEROID_COLORS = [24, 26, 34, 37, 45, 39, 31, 35, 36];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function addPixel(px, x, y, [r, g, b], a = 1) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  px[y][x][0] = clamp(px[y][x][0] + Math.round(r * a), 0, 255);
  px[y][x][1] = clamp(px[y][x][1] + Math.round(g * a), 0, 255);
  px[y][x][2] = clamp(px[y][x][2] + Math.round(b * a), 0, 255);
}
function line(px, x0, y0, x1, y1, color, a = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) addPixel(px, x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, color, a);
}
function fillCircle(px, cx, cy, r, color, a = 1) {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= r) addPixel(px, x, y, color, a * (1 - d / (r + 1) * 0.45));
  }
}
function padColor(note) { return BY_TRD_NOTE.get(note)?.color || [255,255,255]; }

export class SpaceshipAsteroidsSim {
  constructor() { this.reset(0); }
  reset(nowMs = 0) {
    this.startMs = nowMs;
    this.lastSpawnMs = nowMs - 900;
    this.asteroids = [];
    this.lasers = [];
    this.explosions = [];
    this.score = 0;
    this.combo = 0;
    this.level = 1;
    this.nextId = 1;
    this.shipFlashMs = -9999;
    this.lastJudgement = "shoot matching color asteroids";
    this.spawnAsteroid(nowMs);
  }
  spawnDelay() { return Math.max(850, 1900 - this.level * 150); }
  maxAsteroids() { return Math.min(1 + Math.floor(this.level / 3), 4); }
  updateLevel() { this.level = 1 + Math.floor(this.score / 5); }
  spawnAsteroid(nowMs, forcedSize = null) {
    const note = ASTEROID_COLORS[(this.nextId + this.level + Math.floor(this.score / 2)) % ASTEROID_COLORS.length];
    const big = forcedSize ?? (this.level >= 4 && this.nextId % 5 === 0);
    const hp = big ? 2 : 1;
    const y = 6 + ((this.nextId * 7 + this.level * 3) % 21);
    const speed = 0.006 + this.level * 0.0008;
    this.asteroids.push({ id: this.nextId++, note, x: 66, y, r: big ? 4 : 3, hp, maxHp: hp, speed, born: nowMs });
    this.lastSpawnMs = nowMs;
  }
  update(nowMs) {
    this.updateLevel();
    if (this.asteroids.length < this.maxAsteroids() && nowMs - this.lastSpawnMs > this.spawnDelay()) this.spawnAsteroid(nowMs);
    for (const a of this.asteroids) a.x -= a.speed * Math.max(0, nowMs - (a.lastMs || nowMs));
    for (const a of this.asteroids) a.lastMs = nowMs;
    const survivors = [];
    for (const a of this.asteroids) {
      if (a.x < SHIP_X + 3) { this.combo = 0; this.lastJudgement = "asteroid got through — combo reset"; this.explosions.push({ x: SHIP_X + 2, y: SHIP_Y, color: [255, 80, 40], at: nowMs, ttl: 500, power: 2 }); }
      else survivors.push(a);
    }
    this.asteroids = survivors;
    this.lasers = this.lasers.filter(l => nowMs - l.at < 180);
    this.explosions = this.explosions.filter(e => nowMs - e.at < e.ttl);
  }
  shoot(note, nowMs = 0) {
    this.update(nowMs);
    const color = padColor(note);
    this.shipFlashMs = nowMs;
    this.lasers.push({ note, color, at: nowMs });
    const candidates = this.asteroids.filter(a => a.note === note).sort((a,b) => a.x - b.x);
    const target = candidates[0];
    if (!target) { this.lastJudgement = `${BY_TRD_NOTE.get(note)?.label || note} laser: wrong color`; return false; }
    target.hp--;
    this.explosions.push({ x: target.x, y: target.y, color, at: nowMs, ttl: target.hp > 0 ? 360 : 680, power: target.hp > 0 ? 1 : 3 + Math.floor(this.combo / 3) });
    if (target.hp > 0) {
      target.r = Math.max(2, target.r - 1);
      target.x += 3;
      this.lastJudgement = "hit! big asteroid cracked — shoot again";
      return true;
    }
    this.asteroids = this.asteroids.filter(a => a !== target);
    this.score++;
    this.combo++;
    this.updateLevel();
    this.lastJudgement = `boom! score ${this.score} combo x${this.combo}`;
    if (this.asteroids.length === 0) this.spawnAsteroid(nowMs + 120);
    return true;
  }
  drawStars(px, nowMs) {
    for (let i = 0; i < 90; i++) {
      const layer = 1 + (i % 3);
      const speed = layer * 0.006;
      const x = (WIDTH + ((i * 19) % WIDTH) - ((nowMs * speed + i * 7) % WIDTH)) % WIDTH;
      const y = (i * 11 + layer * 5) % HEIGHT;
      const a = [0.35, 0.65, 1][layer - 1];
      addPixel(px, x, y, [120 + layer * 35, 170 + layer * 20, 255], a);
      if (layer === 3) addPixel(px, x + 1, y, [120, 210, 255], 0.35);
    }
    // occasional suns/planets drifting in the background
    const planetX = WIDTH - ((nowMs * 0.004) % 110);
    if (planetX > -10 && planetX < WIDTH + 10) fillCircle(px, planetX, 6, 4, [255, 160, 35], 0.45);
    const moonX = WIDTH - ((nowMs * 0.002 + 45) % 120);
    if (moonX > -8 && moonX < WIDTH + 8) fillCircle(px, moonX, 25, 3, [80, 180, 255], 0.45);
  }
  drawShip(px, nowMs) {
    const flash = nowMs - this.shipFlashMs < 130;
    const body = flash ? [255, 255, 255] : [95, 190, 255];
    line(px, SHIP_X - 4, SHIP_Y - 5, SHIP_X + 5, SHIP_Y, body, 1);
    line(px, SHIP_X - 4, SHIP_Y + 5, SHIP_X + 5, SHIP_Y, body, 1);
    line(px, SHIP_X - 2, SHIP_Y, SHIP_X + 6, SHIP_Y, [255, 235, 90], 1);
    line(px, SHIP_X - 5, SHIP_Y - 2, SHIP_X - 9, SHIP_Y - 4, [255, 80, 20], 0.8);
    line(px, SHIP_X - 5, SHIP_Y + 2, SHIP_X - 9, SHIP_Y + 4, [255, 80, 20], 0.8);
  }
  drawAsteroids(px) {
    for (const a of this.asteroids) {
      const color = padColor(a.note);
      fillCircle(px, a.x, a.y, a.r, color, 0.9);
      line(px, a.x - a.r, a.y - 1, a.x + a.r, a.y + 1, [255,255,255], 0.35);
      if (a.hp > 1) fillCircle(px, a.x, a.y, 1, [255,255,255], 1);
    }
  }
  drawLasers(px, nowMs) {
    for (const l of this.lasers) {
      const age = nowMs - l.at;
      const a = 1 - age / 180;
      line(px, SHIP_X + 6, SHIP_Y, 63, SHIP_Y, l.color, a);
      line(px, SHIP_X + 8, SHIP_Y - 1, 63, SHIP_Y - 1, [255,255,255], a * 0.45);
    }
  }
  drawExplosions(px, nowMs) {
    for (const e of this.explosions) {
      const p = (nowMs - e.at) / e.ttl;
      const life = 1 - p;
      const r = 2 + Math.round((8 + e.power * 3) * p);
      for (let y = e.y - r - 2; y <= e.y + r + 2; y++) for (let x = e.x - r - 2; x <= e.x + r + 2; x++) {
        const d = Math.hypot(x - e.x, y - e.y);
        const ring = 1 - Math.abs(d - r) / 2.2;
        const spark = ((x * 7 + y * 13 + Math.floor(nowMs / 22)) % Math.max(3, 13 - e.power)) === 0 ? 0.8 : 0;
        const a = Math.max(0, ring * life + spark * life);
        if (a > 0.05) addPixel(px, x, y, e.color, a);
      }
    }
  }
  frame(nowMs) {
    this.update(nowMs);
    const px = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => [0, 2, 12]));
    this.drawStars(px, nowMs);
    this.drawShip(px, nowMs);
    this.drawLasers(px, nowMs);
    this.drawAsteroids(px);
    this.drawExplosions(px, nowMs);
    return px;
  }
}

export { TRD_PADS };
