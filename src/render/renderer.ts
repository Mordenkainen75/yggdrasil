import { BLOCK, HEX_SIZE, RANKS, SHIP } from '../game/config.ts';
import { computeStats, upgradeDef } from '../game/economy.ts';
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
  color: string;
  home: boolean; // flies into the ship's hold
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

interface Bolt {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
}

const GOLD = '#ffd76a';
const MEAD = '#ff9f45';
const GAS = '#9be37a';
const FORGE = '#ffb454';
const BERSERK = '#ff6a3c';
const ICE = '#9fe8ff';
const THUNDER = '#9fdcff';
const STEEL = '#b9d6f2';
const NEUTRAL = '#d3dae2';

const MAX_PARTICLES = 1100;
const MAX_TICKS = 24; // silver numbers for plain blocks, so a big blast can't flood the screen
const SPRITE_SIZE = 24;
const HEX_INSET = 0.88;
const CORNERS = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return [Math.cos(a), Math.sin(a)] as const;
});

// Each block has a full-color look, then fades paler as it's damaged.
type Hsl = readonly [hue: number, saturation: number, lightness: number];
const DAMAGE_STEPS = 5;
const LOOK = { GOLD: 3, MEAD: 4, GAS: 5, FIND: 6 } as const; // 0 to 2 are rock, by depth
const SPECIAL_LOOKS: Hsl[] = [[44, 88, 52], [28, 88, 50], [104, 58, 46], [194, 86, 56]];

function rockLooks(hue: number): Hsl[] {
  return [[hue, 52, 44], [hue, 55, 35], [hue, 58, 27]];
}

function shade([hue, saturation, lightness]: Hsl, step: number): string {
  const worn = step / (DAMAGE_STEPS - 1);
  return `hsl(${hue} ${saturation * (1 - 0.72 * worn)}% ${lightness + (86 - lightness) * 0.82 * worn}%)`;
}

function blockSpark(kind: number, hue: number): string {
  switch (kind) {
    case BLOCK.GOLD: return GOLD;
    case BLOCK.MEAD: return MEAD;
    case BLOCK.GAS: return GAS;
    case BLOCK.FIND: return ICE;
    case BLOCK.CORE: return '#ff4d3d';
    default: return `hsl(${hue} 46% 66%)`;
  }
}

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
  private bolts: Bolt[] = [];
  private ticks: Pop[] = [];
  private sprites = new Map<string, HTMLCanvasElement>();
  private colors: string[] = [];
  private colorsHue = -1;
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
      vx: 0, vy: 0, size: 2, home: false,
      life: maxLife, ...p, maxLife,
    });
  }

  private shards(x: number, y: number, color: string, count: number, speed: number, life = 0.6, scale = 1): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.28;
      const v = speed * (0.4 + Math.random());
      this.spawn({ x, y, color, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: (1.6 + Math.random() * 2) * scale, maxLife: life * (0.6 + Math.random() * 0.6) });
    }
  }

  /** A soft round dot, drawn once per color and then stamped, which phones handle well. */
  private sprite(color: string): HTMLCanvasElement {
    let sprite = this.sprites.get(color);
    if (sprite) return sprite;
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = SPRITE_SIZE;
    const g = sprite.getContext('2d') as CanvasRenderingContext2D;
    const middle = SPRITE_SIZE / 2;
    g.fillStyle = color;
    g.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    const fade = g.createRadialGradient(middle, middle, 0, middle, middle, middle);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(0.35, 'rgba(0,0,0,0.75)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = fade;
    g.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    this.sprites.set(color, sprite);
    return sprite;
  }

  /** Every look at every damage step, rebuilt only when the region's stone changes. */
  private blockColors(hue: number): string[] {
    if (hue !== this.colorsHue) {
      this.colorsHue = hue;
      this.colors = [...rockLooks(hue), ...SPECIAL_LOOKS].flatMap((look) =>
        Array.from({ length: DAMAGE_STEPS }, (_, step) => shade(look, step)));
    }
    return this.colors;
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
        case 'hit': {
          const x = s.region.wx[e.cell];
          const y = s.region.wy[e.cell];
          this.shards(x, y, blockSpark(s.region.kind[e.cell], s.region.hue), e.drill ? 3 : 2, 42, 0.5);
          if (e.drill) this.shards(x, y, FORGE, 1, 85, 0.3, 0.8);
          break;
        }
        case 'reveal':
          this.hits.set(e.cell, 0.25);
          break;
        case 'find':
          this.ring(e.x, e.y, 3, 60, 0.6, ICE, 2);
          this.pops.push({ x: e.x, y: e.y, text: 'FOUND', life: 1.2, color: ICE });
          break;
        case 'lance':
          for (let k = 0; k <= 20; k++) {
            const t = k / 20;
            this.spawn({
              x: e.x0 + (e.x1 - e.x0) * t, y: e.y0 + (e.y1 - e.y0) * t, color: ICE, size: 2.2,
              vx: (Math.random() - 0.5) * 34, vy: (Math.random() - 0.5) * 34, maxLife: 0.2 + Math.random() * 0.25,
            });
          }
          break;
        case 'swing':
          this.shards(e.x + Math.cos(e.angle) * 9, e.y + Math.sin(e.angle) * 9, STEEL, 4, 90, 0.25);
          break;
        case 'pulse':
          this.ring(e.x, e.y, 4, 120, 0.4, ICE, 3);
          this.ring(e.x, e.y, 2, 70, 0.3, '#ffffff', 2);
          this.addShake(2);
          break;
        case 'rank': {
          const rank = RANKS[Math.min(RANKS.length - 1, e.rank)];
          this.showTitle(upgradeDef(e.id).name, `${rank.name} rank`);
          this.ring(s.ship.x, s.ship.y, 6, 150, 0.7, rank.color, 3);
          this.flash = 0.25;
          this.flashColor = '255,255,255';
          break;
        }
        case 'unseal':
          this.ring(e.x, e.y, 4, 150, 0.8, '#ff4d3d', 3);
          this.showTitle('The Worldheart opens', s.region.name);
          break;
        case 'wave':
          break;
        case 'mine': {
          if (e.kind === 0) {
            this.shards(e.x, e.y, blockSpark(BLOCK.ROCK, e.hue), 1, 150, 1.6);
            break;
          }
          const color = blockSpark(e.kind, e.hue);
          this.shards(e.x, e.y, color, e.kind === BLOCK.ROCK ? 9 : 12, 72);
          this.spawn({ x: e.x, y: e.y, color: '#dfe9f2', home: true, size: 2, maxLife: 0.8, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60 });
          if (e.kind === BLOCK.GOLD || e.kind === BLOCK.FIND) {
            this.pops.push({ x: e.x, y: e.y, text: `+${fmt(e.value)}`, life: 1, color: e.kind === BLOCK.FIND ? ICE : GOLD });
            this.ring(e.x, e.y, 4, 60, 0.4, GOLD);
          } else if (e.kind !== BLOCK.CORE && this.ticks.length < MAX_TICKS) {
            this.ticks.push({ x: e.x, y: e.y, text: `+${fmt(e.value)}`, life: 0.8, color: NEUTRAL });
          }
          if (e.kind === BLOCK.MEAD) this.ring(e.x, e.y, 4, 110, 0.5, MEAD);
          break;
        }
        case 'burst':
          this.ring(e.x, e.y, 6, 170, 0.45, FORGE, 3);
          this.ring(e.x, e.y, 2, 90, 0.35, '#fff0c8', 2);
          this.shards(e.x, e.y, '#ff9d4f', 22, 150, 0.6, 1.4);
          this.addShake(3);
          break;
        case 'bolt':
          this.bolts.push({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, t: 0 });
          break;
        case 'core':
          this.flash = 0.9;
          this.flashColor = `255,255,255`;
          this.addShake(14);
          for (let i = 0; i < 4; i++) {
            this.ring(e.x, e.y, 10 + i * 14, 420 - i * 70, 1.2 + i * 0.25, i % 2 ? '#ffb454' : '#ffffff', 4 - i * 0.6);
          }
          this.shards(e.x, e.y, '#ffffff', 60, 320, 1.4, 1.6);
          this.shards(e.x, e.y, '#ffb454', 60, 200, 1.8, 1.8);
          if (e.bonus > 0) this.pops.push({ x: e.x, y: e.y - 20, text: `COLLAPSE +${fmt(e.bonus)}`, life: 2, color: '#ffb454' });
          break;
        case 'region':
          this.showTitle(s.region.name, `Midgard, region ${e.index + 1}`);
          this.overview = false;
          break;
        case 'berserk':
          this.flash = 0.4;
          this.flashColor = '255,106,60';
          this.ring(s.ship.x, s.ship.y, 10, 300, 0.7, BERSERK, 4);
          this.addShake(5);
          break;
        case 'waypoint':
          this.ring(e.x, e.y, 26, -30, 0.7, ICE, 2);
          this.ring(e.x, e.y, 2, 40, 0.5, ICE, 1.5);
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
    const berserk = s.berserkLeft > 0;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(s, berserk);

    const sx = this.shake > 0.1 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0.1 ? (Math.random() - 0.5) * this.shake : 0;
    this.shake *= Math.exp(-7 * dt);

    ctx.save();
    ctx.translate(this.width / 2 + sx, this.height / 2 + sy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);

    this.drawRegion(s, dt);
    this.drawBolts(dt);
    this.drawRavens(s);
    this.drawShip(s, berserk);
    this.drawEffects(s, dt);
    ctx.restore();

    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(${this.flashColor},${this.flash * 0.7})`;
      ctx.fillRect(0, 0, this.width, this.height);
      this.flash *= Math.exp(-5 * dt);
    }
    if (berserk) {
      ctx.strokeStyle = `rgba(255,106,60,${0.35 + 0.2 * Math.sin(this.time * 10)})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, this.width - 3, this.height - 3);
    }
    this.drawTitle(dt);
  }

  private updateCamera(s: GameState, dt: number): void {
    const w = s.ship;
    const p = s.region;
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

  private drawBackground(s: GameState, berserk: boolean): void {
    const { ctx, width, height } = this;
    const hue = s.region.hue;
    const g = ctx.createRadialGradient(width / 2, height * 0.45, 20, width / 2, height * 0.45, Math.max(width, height) * 0.8);
    g.addColorStop(0, berserk ? `hsl(14 50% 11%)` : `hsl(${hue} 24% 9%)`);
    g.addColorStop(1, '#070a10');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(215,228,245,0.5)';
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

  private drawRegion(s: GameState, dt: number): void {
    const { ctx } = this;
    const p = s.region;
    const hue = p.hue;
    const line = 1.3 / this.zoom;
    const viewW = this.width / this.zoom / 2 + HEX_SIZE * 2;
    const viewH = this.height / this.zoom / 2 + HEX_SIZE * 2;

    if (s.phase === 'mining') {
      ctx.strokeStyle = `hsla(${hue},24%,70%,0.12)`;
      ctx.lineWidth = 2 / this.zoom;
      ctx.beginPath();
      ctx.arc(0, 0, p.worldRadius + 8, 0, 6.3);
      ctx.stroke();
    }

    const size = HEX_SIZE * HEX_INSET;
    // One path per color: a single draw call for each keeps phones at 60fps.
    const colors = this.blockColors(hue);
    const bodies = colors.map(() => new Path2D());
    const glyphs = new Path2D();
    const flashes = new Path2D();
    const fog = new Path2D();
    const beat = 0.5 + 0.5 * Math.sin(this.time * 4);

    for (const i of p.cells) {
      const kind = p.kind[i];
      if (kind === BLOCK.EMPTY) continue;
      const x = p.wx[i];
      const y = p.wy[i];
      if (Math.abs(x - this.camX) > viewW || Math.abs(y - this.camY) > viewH) continue;
      if (p.seen[i] === 0) {
        hexPath(fog, x, y, size);
        continue;
      }

      let look = -1;
      if (kind === BLOCK.ROCK) look = Math.min(2, Math.floor(p.depth[i] * 3));
      else if (kind === BLOCK.GOLD) {
        // A faceted nugget.
        look = LOOK.GOLD;
        glyphs.moveTo(x, y - size * 0.44);
        glyphs.lineTo(x + size * 0.38, y);
        glyphs.lineTo(x, y + size * 0.44);
        glyphs.lineTo(x - size * 0.38, y);
        glyphs.closePath();
      } else if (kind === BLOCK.FIND) {
        // A four-pointed gem.
        look = LOOK.FIND;
        const r = size * 0.62;
        glyphs.moveTo(x, y - r);
        glyphs.lineTo(x + r * 0.28, y - r * 0.28);
        glyphs.lineTo(x + r, y);
        glyphs.lineTo(x + r * 0.28, y + r * 0.28);
        glyphs.lineTo(x, y + r);
        glyphs.lineTo(x - r * 0.28, y + r * 0.28);
        glyphs.lineTo(x - r, y);
        glyphs.lineTo(x - r * 0.28, y - r * 0.28);
        glyphs.closePath();
      } else if (kind === BLOCK.MEAD) {
        // A banded cask that swells very slightly.
        look = LOOK.MEAD;
        const r = size * (0.42 + 0.03 * beat);
        glyphs.moveTo(x + r * 0.78, y);
        glyphs.ellipse(x, y, r * 0.78, r * 1.08, 0, 0, 6.3);
        glyphs.moveTo(x - r * 0.76, y - r * 0.4);
        glyphs.lineTo(x + r * 0.76, y - r * 0.4);
        glyphs.moveTo(x - r * 0.76, y + r * 0.4);
        glyphs.lineTo(x + r * 0.76, y + r * 0.4);
      } else if (kind === BLOCK.GAS) {
        // Three rising bubbles.
        look = LOOK.GAS;
        const rise = size * 0.06 * beat;
        glyphs.moveTo(x + size * 0.04, y + size * 0.16);
        glyphs.arc(x - size * 0.2, y + size * 0.16, size * 0.24, 0, 6.3);
        glyphs.moveTo(x + size * 0.44, y - size * 0.1 - rise);
        glyphs.arc(x + size * 0.28, y - size * 0.1 - rise, size * 0.16, 0, 6.3);
        glyphs.moveTo(x + size * 0.08, y - size * 0.38 - rise);
        glyphs.arc(x - size * 0.02, y - size * 0.38 - rise, size * 0.1, 0, 6.3);
      }

      if (look >= 0) {
        // Full color until it's touched, then paler in steps as it's worked.
        const health = p.hp[i] / p.maxHp[i];
        const step = health >= 1 ? 0 : 1 + Math.min(DAMAGE_STEPS - 2, Math.floor((1 - health) * (DAMAGE_STEPS - 1)));
        hexPath(bodies[look * DAMAGE_STEPS + step], x, y, size);
      }
      if (this.hits.has(i)) hexPath(flashes, x, y, size);
    }

    ctx.lineWidth = line;
    ctx.lineJoin = 'round';
    bodies.forEach((body, n) => {
      ctx.fillStyle = colors[n];
      ctx.fill(body);
    });
    ctx.strokeStyle = 'rgba(7,10,16,0.72)';
    ctx.stroke(glyphs);
    ctx.fillStyle = `hsl(${hue} 12% 8%)`;
    ctx.strokeStyle = `hsla(${hue},14%,34%,0.4)`;
    ctx.fill(fog);
    ctx.stroke(fog);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill(flashes);

    for (const [cell, left] of this.hits) {
      if (left - dt <= 0) this.hits.delete(cell);
      else this.hits.set(cell, left - dt);
    }

    if (p.kind[p.core] === BLOCK.CORE && p.seen[p.core] === 1) {
      const x = p.wx[p.core];
      const y = p.wy[p.core];
      const health = p.hp[p.core] / p.maxHp[p.core];
      // Sealed, it sits grey and still. Open, it beats.
      const pump = p.coreOpen ? 1 + 0.08 * Math.max(0, Math.sin(this.time * 5)) ** 3 : 1;
      ctx.lineWidth = 1.8 / this.zoom;
      ctx.strokeStyle = p.coreOpen ? '#ff4d3d' : '#8a95a3';
      ctx.fillStyle = p.coreOpen ? `rgba(255,77,61,${0.2 + 0.25 * (1 - health)})` : 'rgba(138,149,163,0.14)';
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

  private drawBolts(dt: number): void {
    const { ctx } = this;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2 / this.zoom;
    ctx.strokeStyle = THUNDER;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt * 3.2;
      if (b.t >= 1) {
        this.ring(b.x1, b.y1, 4, 90, 0.35, THUNDER);
        this.shards(b.x1, b.y1, THUNDER, 8, 80);
        this.bolts.splice(i, 1);
        continue;
      }
      // A jagged line, redrawn from the ship to the leading edge of the strike.
      const dx = b.x1 - b.x0;
      const dy = b.y1 - b.y0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const links = 7;
      ctx.beginPath();
      for (let k = 0; k <= links; k++) {
        const along = (k / links) * b.t;
        const jag = k === 0 ? 0 : Math.sin(k * 12.9 + b.x0) * 5;
        const x = b.x0 + dx * along + nx * jag;
        const y = b.y0 + dy * along + ny * jag;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  private drawRavens(s: GameState): void {
    const { ctx } = this;
    ctx.strokeStyle = '#d5dcf5';
    ctx.lineWidth = 1.6 / this.zoom;
    ctx.lineCap = 'round';
    ctx.beginPath();
    s.ravens.forEach((b, i) => {
      if (b.state === 'rest') return;
      // Two wings, flapping out of step with each other.
      const flap = Math.sin(this.time * 14 + i * 1.7) * 2.2;
      ctx.moveTo(b.x - 5, b.y - flap);
      ctx.quadraticCurveTo(b.x - 2, b.y - 2 - flap * 0.3, b.x, b.y);
      ctx.quadraticCurveTo(b.x + 2, b.y - 2 - flap * 0.3, b.x + 5, b.y - flap);
    });
    ctx.stroke();
  }

  private drawShip(s: GameState, berserk: boolean): void {
    const { ctx } = this;
    const w = s.ship;
    const st = computeStats(s);
    const n = st.pods;
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

    const color = berserk ? '#ff9a78' : STEEL;
    const accent = berserk ? '#ffe0b0' : FORGE;
    const pods = new Path2D();
    const links = new Path2D();
    const shields = new Path2D();

    // The convoy: rigid hauler pods in single file, each with a shield either
    // side. Hard corners and no swelling keep it reading as machinery.
    for (let i = 1; i <= n; i++) {
      const b = Math.min(n, i + 1);
      const dx = xs[i - 1] - xs[b];
      const dy = ys[i - 1] - ys[b];
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const hl = 2.2;
      const hw = SHIP.haulerRadius * 0.74 * (1 - (i / (n + 1)) ** 2 * 0.3);
      const fx = xs[i] + ux * hl;
      const fy = ys[i] + uy * hl;
      const rx = xs[i] - ux * hl;
      const ry = ys[i] - uy * hl;
      pods.moveTo(fx - uy * hw, fy + ux * hw);
      pods.lineTo(fx + uy * hw, fy - ux * hw);
      pods.lineTo(rx + uy * hw, ry - ux * hw);
      pods.lineTo(rx - uy * hw, ry + ux * hw);
      pods.closePath();
      links.moveTo(fx, fy);
      links.lineTo(xs[i - 1] - ux * (i === 1 ? 7 : hl), ys[i - 1] - uy * (i === 1 ? 7 : hl));
      for (const side of [-1, 1]) {
        const sx = xs[i] - uy * side * (hw + 0.4);
        const sy = ys[i] + ux * side * (hw + 0.4);
        shields.moveTo(sx + 1, sy);
        shields.arc(sx, sy, 1, 0, 6.3);
      }
    }

    ctx.lineJoin = 'miter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    // A wide faint pass under the crisp lines reads as glow, for far less
    // cost than canvas shadowBlur.
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 7 / this.zoom;
    ctx.stroke(pods);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.1 / this.zoom;
    ctx.stroke(links);
    ctx.fillStyle = '#0b1119';
    ctx.fill(pods);
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.stroke(pods);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1 / this.zoom;
    ctx.stroke(shields);

    // The flagship: a longship hull with a dragon's jaws clamped round the drill.
    const spin = w.drilling ? this.time * Math.min(st.drillRate, 12) * 1.2 : this.time * 0.8;
    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.rotate(w.angle);
    ctx.scale(SHIP.drawScale, SHIP.drawScale);
    ctx.lineJoin = 'round';

    // Drill cone, with bands that run towards the tip as it turns.
    ctx.strokeStyle = accent;
    ctx.fillStyle = '#0b1119';
    ctx.lineWidth = 1.6 / this.zoom;
    ctx.beginPath();
    ctx.moveTo(7, -4.2);
    ctx.lineTo(19, 0);
    ctx.lineTo(7, 4.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1.1 / this.zoom;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const t = (spin + k / 3) % 1;
      const x = 7 + 12 * t;
      const half = 4.2 * (1 - t);
      ctx.moveTo(x + 1.6 * (1 - t), -half);
      ctx.lineTo(x - 1.6 * (1 - t), half);
    }
    ctx.stroke();

    // Hull, pointed at both ends like a longship seen from above.
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / this.zoom;
    ctx.beginPath();
    ctx.moveTo(-13, 0);
    ctx.quadraticCurveTo(-6, -8.5, 4, -6.5);
    ctx.lineTo(9, -4);
    ctx.lineTo(9, 4);
    ctx.lineTo(4, 6.5);
    ctx.quadraticCurveTo(-6, 8.5, -13, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Keel line and the dragon's upper jaws.
    ctx.lineWidth = 1.1 / this.zoom;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(3, 0);
    for (const side of [-1, 1]) {
      ctx.moveTo(4, side * 6.5);
      ctx.quadraticCurveTo(10, side * 8, 13, side * 3.4);
      ctx.moveTo(-1, side * 6.8);
      ctx.lineTo(-6, side * 10);
      ctx.lineTo(-4, side * 6.6);
    }
    ctx.stroke();

    // Shields along the gunwale.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1 / this.zoom;
    ctx.beginPath();
    for (const x of [-5, -1, 3]) {
      for (const side of [-1, 1]) {
        const y = side * (x === -5 ? 4.6 : 5);
        ctx.moveTo(x + 1.5, y);
        ctx.arc(x, y, 1.5, 0, 6.3);
      }
    }
    ctx.stroke();

    // Forge-lit eyes.
    ctx.fillStyle = berserk ? '#ffffff' : accent;
    ctx.beginPath();
    ctx.arc(6, -2.2, 1.1, 0, 6.3);
    ctx.arc(6, 2.2, 1.1, 0, 6.3);
    ctx.fill();
    ctx.restore();
  }

  private drawEffects(s: GameState, dt: number): void {
    const { ctx } = this;
    const w = s.ship;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
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
      ctx.globalAlpha = Math.min(1, (p.life / p.maxLife) * 1.5);
      ctx.drawImage(this.sprite(p.color), p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
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

    if (s.waypoint) {
      ctx.strokeStyle = `rgba(159,232,255,0.9)`;
      ctx.lineWidth = 1.5 / this.zoom;
      const t = this.time * 3;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        ctx.arc(s.waypoint.x, s.waypoint.y, 9, t + i * 2.09, t + i * 2.09 + 1.2);
      }
      ctx.stroke();
    }

    // Plain blocks underneath, so gold and gems always read on top.
    ctx.textAlign = 'center';
    this.drawPops(this.ticks, `600 ${11 / this.zoom}px ui-monospace, monospace`, dt);
    this.drawPops(this.pops, `700 ${13 / this.zoom}px ui-monospace, monospace`, dt);
  }

  private drawPops(pops: Pop[], font: string, dt: number): void {
    const { ctx } = this;
    ctx.font = font;
    ctx.strokeStyle = 'rgba(7,10,16,0.8)';
    ctx.lineWidth = 2.4 / this.zoom;
    ctx.lineJoin = 'round';
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      p.life -= dt;
      p.y -= (24 / this.zoom) * dt;
      if (p.life <= 0) {
        pops.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.strokeText(p.text, p.x, p.y);
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
    ctx.fillStyle = '#8fa0b3';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText(t.sub.toUpperCase(), width / 2, height * 0.3);
    ctx.fillStyle = '#e8eef5';
    ctx.font = '700 24px ui-monospace, monospace';
    ctx.fillText(t.name, width / 2, height * 0.3 + 28);
    ctx.globalAlpha = 1;
  }
}
