import { BLOCK, HEX_SIZE, WORM } from '../game/config.ts';
import { computeStats } from '../game/economy.ts';
import { segmentPos, type GameEvent, type GameState } from '../game/state.ts';
import { fmt } from '../ui/format.ts';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  spin: number;
  angle: number;
  color: string;
  home: boolean; // flies into the worm's mouth
}

interface Ring {
  x: number;
  y: number;
  r: number;
  grow: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
}

interface Pop {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
}

interface Spit {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
}

const MAX_PARTICLES = 1100;
const HEX_INSET = 0.88;
const CORNERS = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return [Math.cos(a), Math.sin(a)] as const;
});

function hexPath(path: Path2D | CanvasRenderingContext2D, x: number, y: number, size: number): void {
  for (let i = 0; i < 6; i++) {
    const px = x + CORNERS[i][0] * size;
    const py = y + CORNERS[i][1] * size;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }
  path.closePath();
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private camX = 0;
  private camY = 0;
  private zoom = 1;
  private overview = false;
  private shake = 0;
  private flash = 0;
  private flashColor = '255,255,255';
  private time = 0;
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private pops: Pop[] = [];
  private spits: Spit[] = [];
  private hits = new Map<number, number>();
  private stars: { x: number; y: number; depth: number; size: number }[] = [];
  private title: { name: string; sub: string; left: number } | null = null;
  private reducedMotion = false;
  private canvas: HTMLCanvasElement;

  onEvent: (e: GameEvent) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas is not available');
    this.ctx = ctx;
    for (let i = 0; i < 110; i++) {
      this.stars.push({ x: Math.random(), y: Math.random(), depth: 0.1 + Math.random() * 0.5, size: Math.random() < 0.12 ? 3 : 1.4 });
    }
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
  }

  toggleOverview(): boolean {
    this.overview = !this.overview;
    return this.overview;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.width / 2) / this.zoom + this.camX,
      y: (sy - this.height / 2) / this.zoom + this.camY,
    };
  }

  showTitle(name: string, sub: string): void {
    this.title = { name, sub, left: 3 };
  }

  // Effects ---------------------------------------------------------------

  private spawn(p: Partial<Particle> & { x: number; y: number; color: string }): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    const maxLife = p.maxLife ?? 0.6;
    this.particles.push({
      vx: 0, vy: 0, size: 4, spin: 0, angle: Math.random() * 6.28, home: false,
      life: maxLife, ...p, maxLife,
    });
  }

  private shards(x: number, y: number, color: string, count: number, speed: number, life = 0.6): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.28;
      const v = speed * (0.4 + Math.random());
      this.spawn({ x, y, color, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: 3 + Math.random() * 4, spin: (Math.random() - 0.5) * 14, maxLife: life * (0.6 + Math.random() * 0.6) });
    }
  }

  private ring(x: number, y: number, r: number, grow: number, life: number, color: string, width = 2): void {
    this.rings.push({ x, y, r, grow, life, maxLife: life, color, width });
  }

  private addShake(amount: number): void {
    if (!this.reducedMotion) this.shake = Math.min(14, this.shake + amount);
  }

  private consume(s: GameState): void {
    for (const e of s.events) {
      this.onEvent(e);
      switch (e.t) {
        case 'hit':
          this.hits.set(e.cell, 0.12);
          break;
        case 'eat': {
          if (e.kind === 0) {
            this.shards(e.x, e.y, `hsl(${e.hue} 70% 65%)`, 1, 150, 1.6);
            break;
          }
          const color = e.kind === BLOCK.NECTAR ? '#ffd76a' : e.kind === BLOCK.PULSE ? '#7fe9ff' : e.kind === BLOCK.BLISTER ? '#ff6f61' : `hsl(${e.hue} 70% 70%)`;
          this.shards(e.x, e.y, color, e.kind === BLOCK.CRUST ? 3 : 7, 60);
          this.spawn({ x: e.x, y: e.y, color: '#ffb454', home: true, size: 2, maxLife: 0.8, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60 });
          if (e.kind === BLOCK.NECTAR) {
            this.pops.push({ x: e.x, y: e.y, text: `+${fmt(e.value)}`, life: 1, color: '#ffd76a' });
            this.ring(e.x, e.y, 4, 60, 0.4, '#ffd76a');
          } else if (e.kind === BLOCK.PULSE) {
            this.ring(e.x, e.y, 4, 110, 0.5, '#7fe9ff');
          }
          break;
        }
        case 'burst':
          this.ring(e.x, e.y, 6, 170, 0.45, '#ff6f61', 3);
          this.ring(e.x, e.y, 2, 90, 0.35, '#ffd0a8', 2);
          this.shards(e.x, e.y, '#ff9d6f', 14, 150);
          this.addShake(3);
          break;
        case 'spit':
          this.spits.push({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, t: 0 });
          break;
        case 'heart':
          this.flash = 0.9;
          this.flashColor = `255,255,255`;
          this.addShake(14);
          for (let i = 0; i < 4; i++) {
            this.ring(e.x, e.y, 10 + i * 14, 420 - i * 70, 1.2 + i * 0.25, i % 2 ? '#ffb454' : '#ffffff', 4 - i * 0.6);
          }
          this.shards(e.x, e.y, '#ffffff', 60, 320, 1.4);
          this.shards(e.x, e.y, '#ffb454', 60, 200, 1.8);
          if (e.bonus > 0) this.pops.push({ x: e.x, y: e.y - 20, text: `COLLAPSE +${fmt(e.bonus)}`, life: 2, color: '#ffb454' });
          break;
        case 'planet':
          this.showTitle(s.planet.name, `World ${e.index + 1}`);
          this.overview = false;
          break;
        case 'frenzy':
          this.flash = 0.4;
          this.flashColor = '255,95,162';
          this.ring(s.worm.x, s.worm.y, 10, 300, 0.7, '#ff5fa2', 4);
          this.addShake(5);
          break;
        case 'lure':
          this.ring(e.x, e.y, 26, -30, 0.7, '#7df0d0', 2);
          this.ring(e.x, e.y, 2, 40, 0.5, '#7df0d0', 1.5);
          break;
      }
    }
    s.events.length = 0;
  }

  // Drawing ---------------------------------------------------------------

  frame(s: GameState, dt: number): void {
    this.time += dt;
    this.consume(s);
    this.updateCamera(s, dt);
    const { ctx } = this;
    const frenzy = s.frenzyLeft > 0;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(s, frenzy);

    const sx = this.shake > 0.1 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0.1 ? (Math.random() - 0.5) * this.shake : 0;
    this.shake *= Math.exp(-7 * dt);

    ctx.save();
    ctx.translate(this.width / 2 + sx, this.height / 2 + sy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);

    this.drawPlanet(s, dt);
    this.drawSpits(dt);
    this.drawBrood(s);
    this.drawWorm(s, frenzy);
    this.drawEffects(s, dt);
    ctx.restore();

    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(${this.flashColor},${this.flash * 0.7})`;
      ctx.fillRect(0, 0, this.width, this.height);
      this.flash *= Math.exp(-5 * dt);
    }
    if (frenzy) {
      ctx.strokeStyle = `rgba(255,95,162,${0.35 + 0.2 * Math.sin(this.time * 10)})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, this.width - 3, this.height - 3);
    }
    this.drawTitle(dt);
  }

  private updateCamera(s: GameState, dt: number): void {
    const w = s.worm;
    const p = s.planet;
    const fit = Math.min(this.width, this.height) / (p.worldRadius * 2 + 60);
    const wide = this.overview || s.phase === 'collapse';
    const targetZoom = wide ? fit : Math.max(fit, Math.min(this.width / 210, 2.6));
    const tx = wide ? 0 : w.x + Math.cos(w.angle) * 18;
    const ty = wide ? 0 : w.y + Math.sin(w.angle) * 18;
    const ease = 1 - Math.exp(-3.5 * dt);
    this.camX += (tx - this.camX) * ease;
    this.camY += (ty - this.camY) * ease;
    this.zoom += (targetZoom - this.zoom) * ease;
  }

  private drawBackground(s: GameState, frenzy: boolean): void {
    const { ctx, width, height } = this;
    const hue = s.planet.hue;
    const g = ctx.createRadialGradient(width / 2, height * 0.45, 20, width / 2, height * 0.45, Math.max(width, height) * 0.8);
    g.addColorStop(0, frenzy ? `hsl(335 45% 11%)` : `hsl(${hue} 40% 9%)`);
    g.addColorStop(1, '#07060f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(220,215,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const st of this.stars) {
      const x = (((st.x * width - this.camX * st.depth) % width) + width) % width;
      const y = (((st.y * height - this.camY * st.depth) % height) + height) % height;
      ctx.moveTo(x - st.size, y);
      ctx.lineTo(x + st.size, y);
      if (st.size > 2) {
        ctx.moveTo(x, y - st.size);
        ctx.lineTo(x, y + st.size);
      }
    }
    ctx.stroke();
  }

  private drawPlanet(s: GameState, dt: number): void {
    const { ctx } = this;
    const p = s.planet;
    const hue = p.hue;
    const line = 1.3 / this.zoom;
    const viewW = this.width / this.zoom / 2 + HEX_SIZE * 2;
    const viewH = this.height / this.zoom / 2 + HEX_SIZE * 2;

    if (s.phase === 'eating') {
      ctx.strokeStyle = `hsla(${hue},70%,70%,0.12)`;
      ctx.lineWidth = 2 / this.zoom;
      ctx.beginPath();
      ctx.arc(0, 0, p.worldRadius + 8, 0, 6.3);
      ctx.stroke();
    }

    const size = HEX_SIZE * HEX_INSET;
    // One path per look: a single stroke call per colour keeps phones at 60fps.
    const crust = [new Path2D(), new Path2D(), new Path2D()];
    const cracks = new Path2D();
    const nectar = new Path2D();
    const pulse = new Path2D();
    const blister = new Path2D();
    const flashes = new Path2D();
    const beat = 0.5 + 0.5 * Math.sin(this.time * 4);

    for (const i of p.cells) {
      const kind = p.kind[i];
      if (kind === BLOCK.EMPTY) continue;
      const x = p.wx[i];
      const y = p.wy[i];
      if (Math.abs(x - this.camX) > viewW || Math.abs(y - this.camY) > viewH) continue;

      if (kind === BLOCK.CRUST) hexPath(crust[Math.min(2, Math.floor(p.depth[i] * 3))], x, y, size);
      else if (kind === BLOCK.NECTAR) {
        hexPath(nectar, x, y, size);
        hexPath(nectar, x, y, size * 0.45);
      } else if (kind === BLOCK.PULSE) {
        hexPath(pulse, x, y, size);
        pulse.moveTo(x + size * 0.3, y);
        pulse.arc(x, y, size * (0.22 + 0.12 * beat), 0, 6.3);
      } else if (kind === BLOCK.BLISTER) {
        hexPath(blister, x, y, size);
        blister.moveTo(x + size * 0.55, y);
        blister.arc(x, y, size * 0.55, 0, 6.3);
        blister.moveTo(x + size * 0.2, y - size * 0.2);
        blister.arc(x, y - size * 0.2, size * 0.14, 0, 6.3);
      }

      const health = p.hp[i] / p.maxHp[i];
      if (kind !== BLOCK.HEART && health < 0.7) {
        const seed = (i * 7) % 6;
        const count = health < 0.35 ? 3 : 1;
        for (let c = 0; c < count; c++) {
          const corner = CORNERS[(seed + c * 2) % 6];
          cracks.moveTo(x + corner[0] * size, y + corner[1] * size);
          cracks.lineTo(x + corner[1] * size * 0.2, y - corner[0] * size * 0.2);
        }
      }
      if (this.hits.has(i)) hexPath(flashes, x, y, size);
    }

    const shades = [`hsl(${hue} 46% 24%)`, `hsl(${hue} 42% 17%)`, `hsl(${hue} 38% 12%)`];
    const strokes = [`hsl(${hue} 70% 68%)`, `hsl(${hue} 66% 58%)`, `hsl(${hue} 62% 50%)`];
    ctx.lineWidth = line;
    ctx.lineJoin = 'round';
    for (let t = 0; t < 3; t++) {
      ctx.fillStyle = shades[t];
      ctx.strokeStyle = strokes[t];
      ctx.fill(crust[t]);
      ctx.stroke(crust[t]);
    }
    ctx.fillStyle = 'rgba(255,215,106,0.16)';
    ctx.strokeStyle = '#ffd76a';
    ctx.fill(nectar);
    ctx.stroke(nectar);
    ctx.fillStyle = 'rgba(127,233,255,0.14)';
    ctx.strokeStyle = '#7fe9ff';
    ctx.fill(pulse);
    ctx.stroke(pulse);
    ctx.fillStyle = 'rgba(255,111,97,0.18)';
    ctx.strokeStyle = '#ff6f61';
    ctx.fill(blister);
    ctx.stroke(blister);
    ctx.strokeStyle = 'rgba(7,6,15,0.85)';
    ctx.lineWidth = line * 1.2;
    ctx.stroke(cracks);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill(flashes);

    for (const [cell, left] of this.hits) {
      if (left - dt <= 0) this.hits.delete(cell);
      else this.hits.set(cell, left - dt);
    }

    if (p.kind[p.heart] === BLOCK.HEART) {
      const x = p.wx[p.heart];
      const y = p.wy[p.heart];
      const health = p.hp[p.heart] / p.maxHp[p.heart];
      const pump = 1 + 0.08 * Math.max(0, Math.sin(this.time * 5)) ** 3;
      ctx.lineWidth = 1.8 / this.zoom;
      ctx.strokeStyle = '#ff3d71';
      ctx.fillStyle = `rgba(255,61,113,${0.2 + 0.25 * (1 - health)})`;
      for (let r = 0; r < 3; r++) {
        ctx.beginPath();
        hexPath(ctx, x, y, size * pump * (1 - r * 0.28));
        if (r === 0) ctx.fill();
        ctx.stroke();
      }
      if (health < 1) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.4 / this.zoom;
        ctx.beginPath();
        ctx.arc(x, y, size * 1.25, -1.57, -1.57 + 6.283 * health);
        ctx.stroke();
      }
    }
  }

  private drawSpits(dt: number): void {
    const { ctx } = this;
    ctx.lineCap = 'round';
    ctx.lineWidth = 3 / this.zoom;
    ctx.strokeStyle = '#b7ff6a';
    for (let i = this.spits.length - 1; i >= 0; i--) {
      const sp = this.spits[i];
      sp.t += dt * 3.2;
      if (sp.t >= 1) {
        this.ring(sp.x1, sp.y1, 4, 90, 0.35, '#b7ff6a');
        this.shards(sp.x1, sp.y1, '#b7ff6a', 8, 80);
        this.spits.splice(i, 1);
        continue;
      }
      const x = sp.x0 + (sp.x1 - sp.x0) * sp.t;
      const y = sp.y0 + (sp.y1 - sp.y0) * sp.t;
      const bx = sp.x0 + (sp.x1 - sp.x0) * Math.max(0, sp.t - 0.14);
      const by = sp.y0 + (sp.y1 - sp.y0) * Math.max(0, sp.t - 0.14);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }

  private drawBrood(s: GameState): void {
    const { ctx } = this;
    ctx.strokeStyle = '#ffd9a0';
    ctx.lineWidth = 1.6 / this.zoom;
    ctx.lineCap = 'round';
    ctx.beginPath();
    s.brood.forEach((b, i) => {
      const wiggle = Math.sin(this.time * 12 + i) * 2;
      ctx.moveTo(b.x - 4, b.y + wiggle);
      ctx.quadraticCurveTo(b.x, b.y - wiggle, b.x + 4, b.y + wiggle);
    });
    ctx.stroke();
  }

  private drawWorm(s: GameState, frenzy: boolean): void {
    const { ctx } = this;
    const w = s.worm;
    const st = computeStats(s);
    const n = st.segments;
    const pos = { x: 0, y: 0 };
    const xs = new Float32Array(n + 1);
    const ys = new Float32Array(n + 1);
    xs[0] = w.x;
    ys[0] = w.y;
    for (let i = 0; i < n; i++) {
      segmentPos(w, i, pos);
      xs[i + 1] = pos.x;
      ys[i + 1] = pos.y;
    }

    const color = frenzy ? '#ff7db8' : '#ffb454';
    const left = new Path2D();
    const right = new Path2D();
    const ribs = new Path2D();
    for (let i = 0; i <= n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n, i + 1);
      const dx = xs[a] - xs[b];
      const dy = ys[a] - ys[b];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const taper = 1 - (i / (n + 1)) ** 2 * 0.8;
      const swell = 1 + 0.1 * Math.sin(this.time * 7 - i * 0.7);
      const r = WORM.bodyRadius * taper * swell;
      const lx = xs[i] + nx * r;
      const ly = ys[i] + ny * r;
      const rx = xs[i] - nx * r;
      const ry = ys[i] - ny * r;
      if (i === 0) {
        left.moveTo(lx, ly);
        right.moveTo(rx, ry);
      } else {
        left.lineTo(lx, ly);
        right.lineTo(rx, ry);
      }
      ribs.moveTo(lx, ly);
      ribs.quadraticCurveTo(xs[i] - (dx / len) * r * 0.6, ys[i] - (dy / len) * r * 0.6, rx, ry);
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // A wide faint pass under the crisp lines reads as glow, for far less
    // cost than canvas shadowBlur.
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = color;
    ctx.lineWidth = 9 / this.zoom;
    ctx.stroke(left);
    ctx.stroke(right);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.7 / this.zoom;
    ctx.stroke(left);
    ctx.stroke(right);
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.2 / this.zoom;
    ctx.stroke(ribs);
    ctx.globalAlpha = 1;

    // Head: a blunt wedge with working mandibles.
    const chew = w.biting ? 0.35 + 0.35 * Math.abs(Math.sin(this.time * Math.min(st.biteRate, 12) * 3.14)) : 0.2;
    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.rotate(w.angle);
    ctx.fillStyle = '#07060f';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / this.zoom;
    ctx.beginPath();
    ctx.moveTo(-5, -7.5);
    ctx.quadraticCurveTo(5, -9, 8, -3.5);
    ctx.lineTo(8, 3.5);
    ctx.quadraticCurveTo(5, 9, -5, 7.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(7, side * 3);
      ctx.rotate(side * chew);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(6, side * 2.5, 9, -side * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = frenzy ? '#ffffff' : '#7df0d0';
    ctx.beginPath();
    ctx.arc(2, -4, 1.3, 0, 6.3);
    ctx.arc(2, 4, 1.3, 0, 6.3);
    ctx.fill();
    ctx.restore();
  }

  private drawEffects(s: GameState, dt: number): void {
    const { ctx } = this;
    const w = s.worm;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const lineWidth = 1.5 / this.zoom;
    ctx.lineWidth = lineWidth;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        continue;
      }
      if (p.home) {
        const k = 1 - p.life / p.maxLife;
        p.vx += (w.x - p.x) * k * 40 * dt;
        p.vy += (w.y - p.y) * k * 40 * dt;
        p.vx *= 1 - 3 * dt;
        p.vy *= 1 - 3 * dt;
        if (Math.hypot(w.x - p.x, w.y - p.y) < 8) p.life = 0;
      } else {
        p.vx *= 1 - 1.5 * dt;
        p.vy *= 1 - 1.5 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      ctx.globalAlpha = Math.min(1, (p.life / p.maxLife) * 1.5);
      ctx.strokeStyle = p.color;
      const c = Math.cos(p.angle) * p.size;
      const n = Math.sin(p.angle) * p.size;
      ctx.beginPath();
      ctx.moveTo(p.x - c, p.y - n);
      ctx.lineTo(p.x + c, p.y + n);
      ctx.stroke();
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      r.r = Math.max(0.1, r.r + r.grow * dt);
      ctx.globalAlpha = r.life / r.maxLife;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width / this.zoom;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, 6.3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (s.lure) {
      ctx.strokeStyle = `rgba(125,240,208,${Math.min(1, s.lure.left)})`;
      ctx.lineWidth = 1.5 / this.zoom;
      const t = this.time * 3;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        ctx.arc(s.lure.x, s.lure.y, 9, t + i * 2.09, t + i * 2.09 + 1.2);
      }
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.font = `700 ${13 / this.zoom}px ui-monospace, monospace`;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.life -= dt;
      p.y -= (24 / this.zoom) * dt;
      if (p.life <= 0) {
        this.pops.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  private drawTitle(dt: number): void {
    if (!this.title) return;
    const t = this.title;
    t.left -= dt;
    if (t.left <= 0) {
      this.title = null;
      return;
    }
    const { ctx, width, height } = this;
    const age = 3 - t.left;
    ctx.globalAlpha = Math.min(1, age * 3, t.left * 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9a93bb';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText(t.sub.toUpperCase(), width / 2, height * 0.3);
    ctx.fillStyle = '#ece7ff';
    ctx.font = '700 24px ui-monospace, monospace';
    ctx.fillText(t.name, width / 2, height * 0.3 + 28);
    ctx.globalAlpha = 1;
  }
}
