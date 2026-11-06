import { SAGA, RUNES, PERKS, UPGRADES, type RuneId, type PerkId, type UpgradeId } from '../game/config.ts';
import {
  buyPerk, buyUpgrade, gloryPreview, chooseRune, computeStats, isUnlocked, maxAffordable, passSaga,
  openRuneOffer, perkCost, upgradeCost,
} from '../game/economy.ts';
import { triggerBerserk } from '../game/sim.ts';
import { SAGA_READY, offlineCapSeconds, offlineShare, type GameState } from '../game/state.ts';
import { fmt, fmtTime } from './format.ts';
import { runeGlyph } from './runes.ts';

type Tab = 'forge' | 'saga' | 'clan';
type BuyMode = 1 | 10 | 'max';

export interface UiHooks {
  onBuy(): void;
  onCarve(): void;
  onSagaPassed(): void;
  toggleView(): void;
  toggleSound(): boolean;
  hardReset(): void;
}

const el = <T extends HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

export class Ui {
  private s: GameState;
  private hooks: UiHooks;
  private tab: Tab = 'forge';
  private mode: BuyMode = 1;
  private armedSaga = false;
  private armedReset = false;
  private hud: HTMLElement;
  private panel: HTMLElement;
  private modal: HTMLElement;
  private pane!: HTMLElement;
  private refs: Record<string, HTMLElement> = {};
  private upgradeRows = new Map<UpgradeId, HTMLButtonElement>();
  private perkRows = new Map<PerkId, HTMLButtonElement>();

  constructor(s: GameState, hooks: UiHooks) {
    this.s = s;
    this.hooks = hooks;
    this.hud = document.getElementById('hud') as HTMLElement;
    this.panel = document.getElementById('panel') as HTMLElement;
    this.modal = document.getElementById('modal') as HTMLElement;
    this.buildHud();
    this.buildPanel();
    this.renderTab();
  }

  setState(s: GameState): void {
    this.s = s;
    this.renderTab();
  }

  private buildHud(): void {
    this.hud.innerHTML = `
      <div class="hud-top">
        <div><div class="silver" data-r="silver">0</div><div class="rate" data-r="rate"></div></div>
        <div class="world"><div class="world-name" data-r="world"></div><div class="world-sub" data-r="sub"></div></div>
      </div>
      <div class="bar"><i data-r="bar"></i></div>
      <div class="hud-bottom">
        <div class="hud-left">
          <button class="chip" data-a="view">View</button>
          <button class="chip" data-a="sound">Sound</button>
        </div>
        <div class="hud-right">
          <button class="chip carve" data-a="carve" data-r="carve" hidden>Carve rune</button>
          <button class="chip berserk" data-a="berserk" data-r="berserkBtn"><i data-r="berserkFill"></i><span data-r="berserkText">Berserk</span></button>
        </div>
      </div>`;
    this.hud.querySelectorAll<HTMLElement>('[data-r]').forEach((n) => (this.refs[n.dataset.r as string] = n));
    this.hud.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (action === 'berserk') triggerBerserk(this.s);
      else if (action === 'view') this.hooks.toggleView();
      else if (action === 'carve') this.showRuneChoice();
      else if (action === 'sound') {
        const on = this.hooks.toggleSound();
        (e.target as HTMLElement).textContent = on ? 'Sound' : 'Muted';
      }
    });
  }

  private buildPanel(): void {
    this.panel.innerHTML = `
      <div class="tabs">
        <button class="tab" data-tab="forge">FORGE</button>
        <button class="tab" data-tab="saga">SAGA</button>
        <button class="tab" data-tab="clan">CLAN</button>
      </div>
      <div class="pane"></div>`;
    this.pane = this.panel.querySelector('.pane') as HTMLElement;
    this.panel.querySelector('.tabs')?.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
      if (!tab) return;
      this.tab = tab;
      this.armedSaga = false;
      this.armedReset = false;
      this.renderTab();
    });
  }

  private renderTab(): void {
    this.panel.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    this.pane.replaceChildren();
    this.upgradeRows.clear();
    this.perkRows.clear();
    if (this.tab === 'forge') this.renderForge();
    else if (this.tab === 'saga') this.renderSaga();
    else this.renderClan();
    this.update();
  }

  private renderForge(): void {
    const modes = el<HTMLElement>(`<div class="modes">
      <button class="mode" data-m="1">Buy 1</button>
      <button class="mode" data-m="10">Buy 10</button>
      <button class="mode" data-m="max">Buy all I can</button>
    </div>`);
    const paint = () => modes.querySelectorAll<HTMLElement>('.mode').forEach((b) => b.classList.toggle('on', b.dataset.m === String(this.mode)));
    paint();
    modes.addEventListener('click', (e) => {
      const m = (e.target as HTMLElement).dataset.m;
      if (!m) return;
      this.mode = m === 'max' ? 'max' : (Number(m) as 1 | 10);
      paint();
      this.update();
    });
    this.pane.append(modes);

    for (const def of UPGRADES) {
      const row = el<HTMLButtonElement>(`<button class="row">
        <span class="row-main"><span class="row-name">${def.name}<span class="row-level"></span></span>
        <span class="row-blurb" style="display:block"></span></span>
        <span class="row-price"></span></button>`);
      row.addEventListener('click', () => {
        const count = this.buyCount(def.id);
        if (count > 0 && buyUpgrade(this.s, def.id, count)) {
          this.hooks.onBuy();
          this.update();
        }
      });
      this.upgradeRows.set(def.id, row);
      this.pane.append(row);
    }
  }

  private buyCount(id: UpgradeId): number {
    const affordable = maxAffordable(this.s, id);
    return this.mode === 'max' ? affordable : affordable >= this.mode ? this.mode : 0;
  }

  private renderSaga(): void {
    const box = el<HTMLElement>(`<div class="saga-box">
      <p data-r="sagaText"></p>
      <button class="btn" data-r="sagaBtn"></button>
    </div>`);
    const btn = box.querySelector('button') as HTMLButtonElement;
    this.refs.sagaText = box.querySelector('p') as HTMLElement;
    this.refs.sagaBtn = btn;
    btn.addEventListener('click', () => {
      if (!SAGA_READY(this.s)) return;
      if (!this.armedSaga) {
        this.armedSaga = true;
        this.update();
        return;
      }
      this.armedSaga = false;
      if (passSaga(this.s)) {
        this.hooks.onSagaPassed();
        this.renderTab();
      }
    });
    this.pane.append(box, el(`<div class="section">Sagas (permanent)</div>`));

    for (const def of PERKS) {
      const row = el<HTMLButtonElement>(`<button class="row perk">
        <span class="row-main"><span class="row-name">${def.name}<span class="row-level"></span></span>
        <span class="row-blurb" style="display:block">${def.blurb}</span></span>
        <span class="row-price"></span></button>`);
      row.addEventListener('click', () => {
        if (buyPerk(this.s, def.id)) {
          this.hooks.onBuy();
          this.update();
        }
      });
      this.perkRows.set(def.id, row);
      this.pane.append(row);
    }
  }

  private renderClan(): void {
    const s = this.s;
    const st = computeStats(s);
    const owned = RUNES.filter((m) => s.runes[m.id] > 0);
    const chips = owned.length
      ? owned.map((m) => `<span class="rune-chip">${runeGlyph(m.id)}${m.name} <small>${s.runes[m.id] > 1 ? `x${s.runes[m.id]}` : ''}</small></span>`).join('')
      : `<span class="row-blurb">None yet. Clear a region to carve one.</span>`;
    this.pane.append(el(`<div>
      <div class="section">This generation's runes</div>
      <div class="rune-list">${chips}</div>
      <div class="section">Ship</div>
      <dl class="stats">
        <dt>Drill</dt><dd>${fmt(st.drillDamage)} x ${st.drillRate.toFixed(1)}/s</dd>
        <dt>Hauler cutting</dt><dd>${fmt(st.grindDamage)} x ${st.segments} haulers</dd>
        <dt>Silver multiplier</dt><dd>x${fmt(st.silverMul)}</dd>
        <dt>Away earnings</dt><dd>${Math.round(offlineShare(s) * 100)}%, up to ${fmtTime(offlineCapSeconds(s))}</dd>
      </dl>
      <div class="section">All time</div>
      <dl class="stats">
        <dt>Regions mined</dt><dd>${s.regionsMined}</dd>
        <dt>Deepest region</dt><dd>${s.bestRegion + 1}</dd>
        <dt>Generations</dt><dd>${s.sagas}</dd>
        <dt>Silver mined</dt><dd>${fmt(s.lifetimeSilver)}</dd>
      </dl>
    </div>`));
    const reset = el<HTMLButtonElement>(`<button class="btn quiet">Erase save and start over</button>`);
    reset.addEventListener('click', () => {
      if (!this.armedReset) {
        this.armedReset = true;
        reset.textContent = 'Tap again to erase everything';
        return;
      }
      this.hooks.hardReset();
    });
    this.pane.append(reset);
  }

  showRuneChoice(): void {
    openRuneOffer(this.s);
    const offer = this.s.runeOffer;
    if (!offer) return;
    const cards = offer.map((id) => {
      const m = RUNES.find((x) => x.id === id);
      if (!m) return '';
      const level = this.s.runes[id];
      return `<button class="rune-card" data-m="${id}">
        <span class="rune-tag">${m.tag}</span>${runeGlyph(id)}<b>${m.name}</b> <small>${m.meaning}</small>
        <span class="rune-gain">${m.gain}</span>
        ${m.cost ? `<span class="rune-cost">${m.cost}</span>` : ''}
        ${level > 0 ? `<span class="rune-owned">You have ${level} of ${m.maxLevel}</span>` : ''}
      </button>`;
    }).join('');
    this.showModal(`<div class="sheet">
      <h2>Carve a rune</h2>
      <p>Pick one. It lasts until this generation passes on the saga.</p>
      ${cards}
      <button class="btn quiet" data-close>Decide later</button>
    </div>`, (target) => {
      const id = target.closest<HTMLElement>('[data-m]')?.dataset.m as RuneId | undefined;
      if (id && chooseRune(this.s, id)) {
        this.hooks.onCarve();
        this.closeModal();
        if (this.tab === 'clan') this.renderTab();
      }
    });
  }

  showWelcomeBack(seconds: number, gained: number): void {
    this.showModal(`<div class="sheet">
      <h2>Your crew kept mining</h2>
      <p>Away for ${fmtTime(seconds)}.</p>
      <span class="big">+${fmt(gained)} hacksilver</span>
      <button class="btn" data-close>Nice</button>
    </div>`);
  }

  private showModal(html: string, onClick?: (target: HTMLElement) => void): void {
    this.modal.innerHTML = html;
    this.modal.hidden = false;
    this.modal.onclick = (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-close]')) this.closeModal();
      else onClick?.(target);
    };
  }

  private closeModal(): void {
    this.modal.hidden = true;
    this.modal.replaceChildren();
    this.modal.onclick = null;
  }

  /** Refreshes text and button states. Called a few times a second, not every frame. */
  update(): void {
    const s = this.s;
    const r = this.refs;
    const p = s.region;
    r.silver.textContent = fmt(s.silver);
    r.rate.textContent = `${fmt(s.rate)}/s`;
    r.world.textContent = p.name;
    r.sub.textContent = `Midgard, region ${s.regionIndex + 1}${s.glory > 0 ? `  |  ${fmt(s.glory)} glory` : ''}`;
    r.bar.style.width = `${(1 - p.remaining / p.total) * 100}%`;

    const berserkOn = s.berserkLeft > 0;
    const ready = !berserkOn && s.berserkCharge >= 1;
    r.berserkFill.style.width = `${(berserkOn ? s.berserkLeft / computeStats(s).berserkSeconds : s.berserkCharge) * 100}%`;
    r.berserkBtn.classList.toggle('ready', ready);
    r.berserkBtn.classList.toggle('active', berserkOn);
    r.berserkText.textContent = berserkOn ? `${s.berserkLeft.toFixed(1)}s` : ready ? 'BERSERK!' : 'Berserk';

    r.carve.hidden = s.runePicks <= 0;
    r.carve.textContent = s.runePicks > 1 ? `Carve rune x${s.runePicks}` : 'Carve rune';

    for (const def of UPGRADES) {
      const row = this.upgradeRows.get(def.id);
      if (!row) continue;
      const level = s.upgrades[def.id];
      const open = isUnlocked(s, def);
      const capped = level >= def.maxLevel;
      const count = this.buyCount(def.id);
      const shown = this.mode === 'max' ? Math.max(1, count) : this.mode;
      const fits = Math.min(shown, def.maxLevel - level);
      row.classList.toggle('locked', !open);
      row.classList.toggle('buyable', open && count > 0);
      row.disabled = !open || capped;
      (row.querySelector('.row-level') as HTMLElement).textContent = open ? `Lv ${level}` : '';
      (row.querySelector('.row-blurb') as HTMLElement).textContent = open ? def.blurb : `Unlocks on region ${def.unlockRegion + 1}`;
      (row.querySelector('.row-price') as HTMLElement).innerHTML = !open ? '' : capped ? 'MAX'
        : `${fmt(upgradeCost(def.id, level, fits))}${this.mode === 'max' && count > 1 ? `<small>+${count} levels</small>` : ''}`;
    }

    if (this.tab === 'saga') {
      const gain = gloryPreview(s);
      const canPass = SAGA_READY(s);
      r.sagaText.innerHTML = canPass
        ? `This generation hangs up its tools, and the next one starts from region 1. Upgrades and runes go. Glory and sagas stay. You'd gain <strong>${fmt(gain)} glory</strong>. Reach further for more. You have <strong>${fmt(s.glory)}</strong>.`
        : `Your saga is worth passing on from region ${SAGA.unlockRegion + 1}. You have <strong>${fmt(s.glory)} glory</strong>.`;
      const btn = r.sagaBtn as HTMLButtonElement;
      btn.disabled = !canPass;
      btn.classList.toggle('armed', this.armedSaga);
      btn.textContent = this.armedSaga ? 'Tap again to pass it on' : canPass ? `Pass on the saga for ${fmt(gain)} glory` : 'Not ready';
    }

    for (const def of PERKS) {
      const row = this.perkRows.get(def.id);
      if (!row) continue;
      const level = s.perks[def.id];
      const capped = level >= def.maxLevel;
      const cost = perkCost(def.id, level);
      row.classList.toggle('buyable', !capped && cost <= s.glory);
      row.disabled = capped;
      (row.querySelector('.row-level') as HTMLElement).textContent = def.maxLevel > 1 ? `Lv ${level}` : capped ? 'Owned' : '';
      (row.querySelector('.row-price') as HTMLElement).textContent = capped ? 'MAX' : `${fmt(cost)} glory`;
    }
  }
}
