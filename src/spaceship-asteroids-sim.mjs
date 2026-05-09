import { BY_TRD_NOTE, TRD_PADS } from "./trd-mapping.mjs";

export const WIDTH = 64;
export const HEIGHT = 32;

const SHIP_X = 8;
const SHIP_Y = 16;
const LESSON_TARGET_X = SHIP_X + 15;
const ASTEROID_START_X = 66;
const LESSON_FIRST_TARGET_MS = 2400;
const LESSON_EARLY_MS = 180;
const LESSON_LATE_MS = 220;
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
function lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }

export const LESSONS = Object.freeze([
  {
    id: "free",
    name: "Free Asteroids",
    description: "Shoot matching-color asteroids in any rhythm.",
    mode: "free"
  },
  {
    id: "snare-stars",
    name: "Snare Stars",
    description: "Learn a steady beat: yellow snare asteroids land every pulse.",
    mode: "lesson",
    bpm: 80,
    travelMs: 2400,
    lengthBeats: 4,
    pattern: [
      { beat: 0, note: 26, laneY: 16 },
      { beat: 1, note: 26, laneY: 16 },
      { beat: 2, note: 26, laneY: 16 },
      { beat: 3, note: 26, laneY: 16 }
    ]
  },
  {
    id: "robot-rock",
    name: "Robot Rock Beat",
    description: "Kick and snare take turns: kick on 1/3, snare on 2/4.",
    mode: "lesson",
    bpm: 80,
    travelMs: 2400,
    lengthBeats: 4,
    pattern: [
      { beat: 0, note: 24, laneY: 21 },
      { beat: 1, note: 26, laneY: 15 },
      { beat: 2, note: 24, laneY: 21 },
      { beat: 3, note: 26, laneY: 15 }
    ]
  }
]);

export class SpaceshipAsteroidsSim {
  constructor() { this.reset(0); }
  reset(nowMs = 0, { lessonId = this.lessonId || "free" } = {}) {
    this.startMs = nowMs;
    this.lessonId = lessonId;
    this.lesson = LESSONS.find(l => l.id === lessonId) || LESSONS[0];
    this.lessonMode = this.lesson.mode === "lesson";
    this.lessonStartMs = nowMs;
    this.nextLessonSeq = 0;
    this.lastSpawnMs = nowMs - 900;
    this.asteroids = [];
    this.lasers = [];
    this.explosions = [];
    this.score = 0;
    this.combo = 0;
    this.level = 1;
    this.nextId = 1;
    this.shipFlashMs = -9999;
    this.aimUntilMs = -9999;
    this.aimX = SHIP_X + 18;
    this.aimY = SHIP_Y;
    this.lastJudgement = this.lessonMode ? `${this.lesson.name}: wait for the asteroid to touch the beat line` : "shoot matching color asteroids";
    if (this.lessonMode) this.ensureLessonAsteroids(nowMs);
    else this.spawnAsteroid(nowMs);
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
    this.asteroids.push({ id: this.nextId++, note, x: ASTEROID_START_X, y, r: big ? 4 : 3, hp, maxHp: hp, speed, born: nowMs });
    this.lastSpawnMs = nowMs;
  }

  lessonBeatMs() { return 60000 / this.lesson.bpm; }
  lessonTargetForSeq(seq) {
    const pattern = this.lesson.pattern;
    const step = pattern[seq % pattern.length];
    const cycle = Math.floor(seq / pattern.length);
    const beat = cycle * this.lesson.lengthBeats + step.beat;
    const targetMs = this.lessonStartMs + LESSON_FIRST_TARGET_MS + beat * this.lessonBeatMs();
    return { ...step, seq, targetMs, spawnMs: targetMs - this.lesson.travelMs };
  }
  ensureLessonAsteroids(nowMs) {
    while (this.nextLessonSeq < 256) {
      const target = this.lessonTargetForSeq(this.nextLessonSeq);
      if (target.spawnMs > nowMs + 100) break;
      this.asteroids.push({
        id: this.nextId++,
        seq: target.seq,
        note: target.note,
        targetMs: target.targetMs,
        spawnMs: target.spawnMs,
        x: ASTEROID_START_X,
        y: target.laneY,
        r: target.note === 24 ? 4 : 3,
        hp: 1,
        maxHp: 1,
        lesson: true
      });
      this.nextLessonSeq++;
    }
  }
  updateLessonAsteroids(nowMs) {
    this.ensureLessonAsteroids(nowMs);
    const survivors = [];
    for (const a of this.asteroids) {
      const progress = (nowMs - a.spawnMs) / this.lesson.travelMs;
      a.x = lerp(ASTEROID_START_X, LESSON_TARGET_X, progress);
      if (nowMs > a.targetMs + LESSON_LATE_MS) {
        this.combo = 0;
        this.lastJudgement = "miss — next one is coming";
        this.explosions.push({ x: LESSON_TARGET_X, y: a.y, color: [255, 80, 40], at: nowMs, ttl: 420, power: 1 });
      } else {
        survivors.push(a);
      }
    }
    this.asteroids = survivors;
    this.lasers = this.lasers.filter(l => nowMs - l.at < 180);
    this.explosions = this.explosions.filter(e => nowMs - e.at < e.ttl);
  }
  update(nowMs) {
    if (this.lessonMode) { this.updateLessonAsteroids(nowMs); return; }
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

  shootLesson(note, nowMs = 0) {
    this.updateLessonAsteroids(nowMs);
    const color = padColor(note);
    this.shipFlashMs = nowMs;
    const nearestAny = [...this.asteroids].sort((a,b) => Math.abs(a.targetMs - nowMs) - Math.abs(b.targetMs - nowMs))[0];
    const candidates = this.asteroids.filter(a => a.note === note).sort((a,b) => Math.abs(a.targetMs - nowMs) - Math.abs(b.targetMs - nowMs));
    const target = candidates[0];
    const laserTarget = target || nearestAny || { x: 63, y: SHIP_Y, targetMs: nowMs };
    this.aimX = laserTarget.x;
    this.aimY = laserTarget.y;
    this.aimUntilMs = nowMs + 260;
    this.lasers.push({ note, color, at: nowMs, targetX: laserTarget.x, targetY: laserTarget.y, locked: Boolean(target) });
    const nearestIsActive = nearestAny && Math.abs(nearestAny.targetMs - nowMs) <= LESSON_LATE_MS;
    if (!target || (nearestIsActive && nearestAny.note !== note)) {
      const want = BY_TRD_NOTE.get(nearestAny?.note)?.label || "matching color";
      this.lastJudgement = `wrong color — try ${want}`;
      return false;
    }
    const dt = nowMs - target.targetMs;
    if (dt < -LESSON_EARLY_MS) { this.lastJudgement = "right color — wait for the beat line"; return false; }
    if (dt > LESSON_LATE_MS) { this.lastJudgement = "right color — a little sooner"; return false; }
    this.asteroids = this.asteroids.filter(a => a !== target);
    this.score++;
    this.combo++;
    const power = Math.min(7, 2 + Math.floor(this.combo / 3));
    this.explosions.push({ x: target.x, y: target.y, color, at: nowMs, ttl: 700, power });
    const pad = BY_TRD_NOTE.get(note);
    const feel = Math.abs(dt) < 85 ? "perfect" : "good";
    this.lastJudgement = `${feel} ${pad?.label || note}! combo x${this.combo}`;
    return true;
  }
  shoot(note, nowMs = 0) {
    if (this.lessonMode) return this.shootLesson(note, nowMs);
    this.update(nowMs);
    const color = padColor(note);
    this.shipFlashMs = nowMs;
    const candidates = this.asteroids.filter(a => a.note === note).sort((a,b) => a.x - b.x);
    const target = candidates[0];
    const laserTarget = target ? { x: target.x, y: target.y } : { x: 63, y: SHIP_Y };
    this.aimX = laserTarget.x;
    this.aimY = laserTarget.y;
    this.aimUntilMs = nowMs + 260;
    this.lasers.push({ note, color, at: nowMs, targetX: laserTarget.x, targetY: laserTarget.y, locked: Boolean(target) });
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
    // Starfield only: no planets/suns, so asteroids stay visually important.
    // Four layers use different densities, speeds, brightness, and sprite shapes.
    const layers = [
      { count: 26, speed: 0.0024, color: [55, 75, 130], alpha: 0.34, shape: 0, seed: 3 },
      { count: 34, speed: 0.0052, color: [95, 125, 190], alpha: 0.50, shape: 1, seed: 17 },
      { count: 28, speed: 0.0105, color: [160, 205, 255], alpha: 0.76, shape: 2, seed: 31 },
      { count: 16, speed: 0.0185, color: [225, 245, 255], alpha: 0.95, shape: 3, seed: 47 }
    ];
    for (const layer of layers) {
      for (let i = 0; i < layer.count; i++) {
        const lane = i + layer.seed;
        const span = WIDTH + 18;
        const rawX = (lane * 23 + layer.seed * 11 + nowMs * layer.speed) % span;
        const x = rawX < 0 ? rawX + span - 9 : rawX - 9;
        const y = (lane * 13 + layer.seed * 5 + Math.floor(lane / 3) * 7) % HEIGHT;
        const twinkle = 0.74 + 0.26 * Math.sin(nowMs * 0.006 + lane * 1.7);
        const a = layer.alpha * twinkle;
        if (layer.shape === 0) {
          addPixel(px, x, y, layer.color, a);
        } else if (layer.shape === 1) {
          addPixel(px, x, y, layer.color, a);
          addPixel(px, x - 1, y, layer.color, a * 0.28);
        } else if (layer.shape === 2) {
          addPixel(px, x, y, layer.color, a);
          addPixel(px, x - 1, y, layer.color, a * 0.55);
          addPixel(px, x - 2, y, layer.color, a * 0.20);
          if ((lane & 3) === 0) addPixel(px, x, y - 1, [210, 235, 255], a * 0.32);
        } else {
          addPixel(px, x, y, layer.color, a);
          addPixel(px, x - 1, y, layer.color, a * 0.72);
          addPixel(px, x - 2, y, layer.color, a * 0.48);
          addPixel(px, x - 3, y, layer.color, a * 0.22);
          if ((lane & 1) === 0) addPixel(px, x, y + 1, [140, 220, 255], a * 0.36);
        }
      }
    }
  }
  drawShip(px, nowMs) {
    const flash = nowMs - this.shipFlashMs < 130;
    const hull = flash ? [255, 255, 255] : [95, 205, 255];
    const glass = flash ? [255, 255, 190] : [255, 235, 90];
    const trim = [35, 90, 255];
    const flame1 = flash ? [255, 245, 90] : [255, 80, 18];
    const flame2 = flash ? [255, 95, 30] : [90, 190, 255];
    const aiming = nowMs < this.aimUntilMs;
    const targetY = aiming ? this.aimY : SHIP_Y;
    const tilt = clamp(Math.round((targetY - SHIP_Y) / 3), -5, 5);
    const noseX = SHIP_X + 8;
    const noseY = SHIP_Y + tilt;

    // Needle-nose sci-fi rocket with wings, cockpit, engine plume, and highlights.
    line(px, SHIP_X - 5, SHIP_Y - 5, noseX, noseY, hull, 1);
    line(px, SHIP_X - 5, SHIP_Y + 5, noseX, noseY, hull, 1);
    line(px, SHIP_X - 2, SHIP_Y - 2, SHIP_X + 6, SHIP_Y + Math.round(tilt * 0.65), [225, 245, 255], 0.85);
    line(px, SHIP_X - 2, SHIP_Y + 2, SHIP_X + 6, SHIP_Y + Math.round(tilt * 0.65), [70, 145, 255], 0.85);
    line(px, SHIP_X - 3, SHIP_Y - 1, SHIP_X + 5, SHIP_Y + Math.round(tilt * 0.45), hull, 0.72);
    line(px, SHIP_X - 3, SHIP_Y + 1, SHIP_X + 5, SHIP_Y + Math.round(tilt * 0.45), hull, 0.72);
    addPixel(px, noseX, noseY, [255, 255, 255], 1);

    // Cockpit and blue fins follow the nose angle.
    addPixel(px, SHIP_X + 1, SHIP_Y + Math.round(tilt * 0.25), glass, 1);
    addPixel(px, SHIP_X + 2, SHIP_Y + Math.round(tilt * 0.35), glass, 0.8);
    line(px, SHIP_X - 2, SHIP_Y - 2, SHIP_X - 7, SHIP_Y - 7 + Math.round(tilt * 0.35), trim, 0.95);
    line(px, SHIP_X - 1, SHIP_Y - 1, SHIP_X - 5, SHIP_Y - 5 + Math.round(tilt * 0.35), [110, 225, 255], 0.75);
    line(px, SHIP_X - 2, SHIP_Y + 2, SHIP_X - 7, SHIP_Y + 7 + Math.round(tilt * 0.35), trim, 0.95);
    line(px, SHIP_X - 1, SHIP_Y + 1, SHIP_X - 5, SHIP_Y + 5 + Math.round(tilt * 0.35), [110, 225, 255], 0.75);

    // Twin engine trails with animated flicker.
    const flicker = (Math.floor(nowMs / 70) & 1) ? 1 : 0.65;
    line(px, SHIP_X - 5, SHIP_Y - 2, SHIP_X - 11, SHIP_Y - 4 - Math.round(tilt * 0.3), flame1, 0.9 * flicker);
    line(px, SHIP_X - 5, SHIP_Y + 2, SHIP_X - 11, SHIP_Y + 4 - Math.round(tilt * 0.3), flame1, 0.9);
    line(px, SHIP_X - 6, SHIP_Y, SHIP_X - 13, SHIP_Y - Math.round(tilt * 0.25), flame2, 0.65 * flicker);
  }
  drawLessonGuide(px, nowMs) {
    if (!this.lessonMode) return;
    const beatMs = this.lessonBeatMs();
    const phase = ((nowMs - this.lessonStartMs - LESSON_FIRST_TARGET_MS) % beatMs + beatMs) % beatMs;
    const pulse = Math.max(0, 1 - Math.min(phase, beatMs - phase) / 120);
    const guide = [120 + 135 * pulse, 170 + 85 * pulse, 255];
    line(px, LESSON_TARGET_X, 3, LESSON_TARGET_X, HEIGHT - 4, guide, 0.45 + pulse * 0.45);
    if (pulse > 0.05) fillCircle(px, LESSON_TARGET_X, SHIP_Y, 2 + Math.round(2 * pulse), [255,255,255], pulse * 0.45);
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
      const startX = SHIP_X + 7;
      const startY = SHIP_Y + clamp(Math.round((l.targetY - SHIP_Y) / 3), -5, 5);
      const endX = l.targetX;
      const endY = l.targetY;
      line(px, startX, startY, endX, endY, l.color, a);
      line(px, startX + 1, startY - 1, endX, endY - 1, [255,255,255], a * (l.locked ? 0.55 : 0.25));
      if (l.locked) fillCircle(px, endX, endY, 1, [255,255,255], a * 0.9);
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
    this.drawLessonGuide(px, nowMs);
    this.drawShip(px, nowMs);
    this.drawLasers(px, nowMs);
    this.drawAsteroids(px);
    this.drawExplosions(px, nowMs);
    return px;
  }
}

export { TRD_PADS };
