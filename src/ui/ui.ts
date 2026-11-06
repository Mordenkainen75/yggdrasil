import { MOLT, MUTATIONS, PERKS, UPGRADES, type MutationId, type PerkId, type UpgradeId } from '../game/config.ts';
import {
  buyPerk, buyUpgrade, chitinPreview, chooseMutation, computeStats, isUnlocked, maxAffordable, molt,
  openMutationOffer, perkCost, upgradeCost,
} from '../game/economy.ts';
import { triggerFrenzy } from '../game/sim.ts';
import { MOLT_READY, offlineCapSeconds, offlineShare, type GameState } from '../game/state.ts';
import { fmt, fmtTime } from './format.ts';

type Tab = 'grow' | 'molt' | 'wyrm';
type BuyMode = 1 | 10 | 'max';

export interface UiHooks {
  onBuy(): void;
  onMutate(): void;
  onMolt(): void;
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
  private tab: Tab = 'grow';
  private mode: BuyMode = 1;
  private armedMolt = false;
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
        <div><div class="biomass" data-r="biomass">0</div><div class="rate" data-r="rate"></div></div>
        <div class="world"><div class="world-name" data-r="world"></div><div class="world-sub" data-r="sub"></div></div>
      </div>
      <div class="bar"><i data-r="bar"></i></div>
      <div class="hud-bottom">
        <div class="hud-left">
          <button class="chip" data-a="view">View</button>
          <button class="chip" data-a="sound">Sound</button>
        </div>
        <div class="hud-right">
          <button class="chip mutate" data-a="mutate" data-r="mutate" hidden>Mutate</button>
          <button class="chip frenzy" data-a="frenzy" data-r="frenzyBtn"><i data-r="frenzyFill"></i><span data-r="frenzyText">Frenzy</span></button>
        </div>
      </div>`;
    this.hud.querySelectorAll<HTMLElement>('[data-r]').forEach((n) => (this.refs[n.dataset.r as string] = n));
    this.hud.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (action === 'frenzy') triggerFrenzy(this.s);
      else if (action === 'view') this.hooks.toggleView();
      else if (action === 'mutate') this.showMutationChoice();
      else if (action === 'sound') {
        const on = this.hooks.toggleSound();
        (e.target as HTMLElement).textContent = on ? 'Sound' : 'Muted';
      }
    });
  }

  private buildPanel(): void {
    this.panel.innerHTML = `
      <div class="tabs">
        <button class="tab" data-tab="grow">GROW</button>
        <button class="tab" data-tab="molt">MOLT</button>
        <button class="tab" data-tab="wyrm">WYRM</button>
      </div>
      <div class="pane"></div>`;
    this.pane = this.panel.querySelector('.pane') as HTMLElement;
    this.panel.querySelector('.tabs')?.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
      if (!tab) return;
      this.tab = tab;
      this.armedMolt = false;
      this.armedReset = false;
      this.renderTab();
    });
  }

  private renderTab(): void {
    this.panel.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    this.pane.replaceChildren();
    this.upgradeRows.clear();
    this.perkRows.clear();
    if (this.tab === 'grow') this.renderGrow();
    else if (this.tab === 'molt') this.renderMolt();
    else this.renderWyrm();
    this.update();
  }

  private renderGrow(): void {
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

  private renderMolt(): void {
    const box = el<HTMLElement>(`<div class="molt-box">
      <p data-r="moltText"></p>
      <button class="btn" data-r="moltBtn"></button>
    </div>`);
    const btn = box.querySelector('button') as HTMLButtonElement;
    this.refs.moltText = box.querySelector('p') as HTMLElement;
    this.refs.moltBtn = btn;
    btn.addEventListener('click', () => {
      if (!MOLT_READY(this.s)) return;
      if (!this.armedMolt) {
        this.armedMolt = true;
        this.update();
        return;
      }
      this.armedMolt = false;
      if (molt(this.s)) {
        this.hooks.onMolt();
        this.renderTab();
      }
    });
    this.pane.append(box, el(`<div class="section">Chitin perks (permanent)</div>`));

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

  private renderWyrm(): void {
    const s = this.s;
    const st = computeStats(s);
    const owned = MUTATIONS.filter((m) => s.mutations[m.id] > 0);
    const chips = owned.length
      ? owned.map((m) => `<span class="mut-chip">${m.name} <small>${s.mutations[m.id] > 1 ? `x${s.mutations[m.id]}` : ''}</small></span>`).join('')
      : `<span class="row-blurb">None yet. Eat a planet to mutate.</span>`;
    this.pane.append(el(`<div>
      <div class="section">This run's mutations</div>
      <div class="mut-list">${chips}</div>
      <div class="section">Body</div>
      <dl class="stats">
        <dt>Bite</dt><dd>${fmt(st.jawDamage)} x ${st.biteRate.toFixed(1)}/s</dd>
        <dt>Body grind</dt><dd>${fmt(st.grindDamage)} x ${st.segments} segments</dd>
        <dt>Biomass multiplier</dt><dd>x${fmt(st.biomassMul)}</dd>
        <dt>Away earnings</dt><dd>${Math.round(offlineShare(s) * 100)}%, up to ${fmtTime(offlineCapSeconds(s))}</dd>
      </dl>
      <div class="section">All time</div>
      <dl class="stats">
        <dt>Worlds eaten</dt><dd>${s.planetsEaten}</dd>
        <dt>Deepest world</dt><dd>${s.bestPlanet + 1}</dd>
        <dt>Molts</dt><dd>${s.molts}</dd>
        <dt>Biomass eaten</dt><dd>${fmt(s.lifetimeBiomass)}</dd>
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

  showMutationChoice(): void {
    openMutationOffer(this.s);
    const offer = this.s.mutationOffer;
    if (!offer) return;
    const cards = offer.map((id) => {
      const m = MUTATIONS.find((x) => x.id === id);
      if (!m) return '';
      const level = this.s.mutations[id];
      return `<button class="mut-card" data-m="${id}">
        <span class="mut-tag">${m.tag}</span><b>${m.name}</b>
        <span class="mut-gain">${m.gain}</span>
        ${m.cost ? `<span class="mut-cost">${m.cost}</span>` : ''}
        ${level > 0 ? `<span class="mut-owned">You have ${level} of ${m.maxLevel}</span>` : ''}
      </button>`;
    }).join('');
    this.showModal(`<div class="sheet">
      <h2>Mutate</h2>
      <p>Pick one. It lasts until your next molt.</p>
      ${cards}
      <button class="btn quiet" data-close>Decide later</button>
    </div>`, (target) => {
      const id = target.closest<HTMLElement>('[data-m]')?.dataset.m as MutationId | undefined;
      if (id && chooseMutation(this.s, id)) {
        this.hooks.onMutate();
        this.closeModal();
        if (this.tab === 'wyrm') this.renderTab();
      }
    });
  }

  showWelcomeBack(seconds: number, gained: number): void {
    this.showModal(`<div class="sheet">
      <h2>Your wyrm kept eating</h2>
      <p>Away for ${fmtTime(seconds)}.</p>
      <span class="big">+${fmt(gained)} biomass</span>
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
    const p = s.planet;
    r.biomass.textContent = fmt(s.biomass);
    r.rate.textContent = `${fmt(s.rate)}/s`;
    r.world.textContent = p.name;
    r.sub.textContent = `World ${s.planetIndex + 1}${s.chitin > 0 ? `  |  ${fmt(s.chitin)} chitin` : ''}`;
    r.bar.style.width = `${(1 - p.remaining / p.total) * 100}%`;

    const frenzyOn = s.frenzyLeft > 0;
    const ready = !frenzyOn && s.frenzyCharge >= 1;
    r.frenzyFill.style.width = `${(frenzyOn ? s.frenzyLeft / computeStats(s).frenzySeconds : s.frenzyCharge) * 100}%`;
    r.frenzyBtn.classList.toggle('ready', ready);
    r.frenzyBtn.classList.toggle('active', frenzyOn);
    r.frenzyText.textContent = frenzyOn ? `${s.frenzyLeft.toFixed(1)}s` : ready ? 'FRENZY!' : 'Frenzy';

    r.mutate.hidden = s.mutationPicks <= 0;
    r.mutate.textContent = s.mutationPicks > 1 ? `Mutate x${s.mutationPicks}` : 'Mutate';

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
      (row.querySelector('.row-blurb') as HTMLElement).textContent = open ? def.blurb : `Unlocks on world ${def.unlockPlanet + 1}`;
      (row.querySelector('.row-price') as HTMLElement).innerHTML = !open ? '' : capped ? 'MAX'
        : `${fmt(upgradeCost(def.id, level, fits))}${this.mode === 'max' && count > 1 ? `<small>+${count} levels</small>` : ''}`;
    }

    if (this.tab === 'molt') {
      const gain = chitinPreview(s);
      const canMolt = MOLT_READY(s);
      r.moltText.innerHTML = canMolt
        ? `Shed this body and start from world 1. Upgrades and mutations go. Chitin and perks stay. You'd gain <strong>${fmt(gain)} chitin</strong>. Reach further for more. You have <strong>${fmt(s.chitin)}</strong>.`
        : `Molting unlocks on world ${MOLT.unlockPlanet + 1}. You have <strong>${fmt(s.chitin)} chitin</strong>.`;
      const btn = r.moltBtn as HTMLButtonElement;
      btn.disabled = !canMolt;
      btn.classList.toggle('armed', this.armedMolt);
      btn.textContent = this.armedMolt ? 'Tap again to molt' : canMolt ? `Molt for ${fmt(gain)} chitin` : 'Not ready';
    }

    for (const def of PERKS) {
      const row = this.perkRows.get(def.id);
      if (!row) continue;
      const level = s.perks[def.id];
      const capped = level >= def.maxLevel;
      const cost = perkCost(def.id, level);
      row.classList.toggle('buyable', !capped && cost <= s.chitin);
      row.disabled = capped;
      (row.querySelector('.row-level') as HTMLElement).textContent = def.maxLevel > 1 ? `Lv ${level}` : capped ? 'Owned' : '';
      (row.querySelector('.row-price') as HTMLElement).textContent = capped ? 'MAX' : `${fmt(cost)} chitin`;
    }
  }
}
