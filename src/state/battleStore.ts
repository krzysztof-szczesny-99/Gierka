// Kontroler walki po stronie UI: trzyma stan silnika, model widoku i odtwarza zdarzenia z animacjami.

import { create } from 'zustand';
import type { ItemId } from '../config/items';
import { forceSwitch, resolveTurn } from '../engine/battle/battleEngine';
import type { BattleEvent, BattleState, PlayerAction, SideIndex } from '../engine/battle/types';
import { gameRng } from '../engine/rng';
import type { Creature, Gender, MajorStatus, SpeciesData, TypeName } from '../engine/types';
import { useGame } from './gameStore';

export type AnimKind = 'enter' | 'attack' | 'hit' | 'faint' | 'withdraw' | 'boost-up' | 'boost-down';

export interface ViewCreature {
  uid: string;
  pokemon: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  status: MajorStatus | null;
  types: TypeName[];
  shiny: boolean;
  mighty: boolean;
  gender: Gender;
  exp: number;
  growthRate: string;
}

export interface CapsuleView {
  item: ItemId;
  phase: 'throw' | 'shake' | 'caught' | 'broke';
  shake: number;
}

export interface BattleView {
  active: [string | null, string | null];
  creatures: Record<string, ViewCreature>;
  message: string;
  anim: Record<string, { kind: AnimKind; key: number }>;
  hidden: Record<string, boolean>;
  capsule: CapsuleView | null;
}

export type BattlePhase = 'intro' | 'playing' | 'choose' | 'forcedSwitch' | 'ended';
export type BattleMenu = 'root' | 'fight' | 'bag' | 'party';

export interface BattleMeta {
  /** Spotkanie z centralnej blokady, do którego należy ta walka. */
  encounterId: string | null;
  actorId: string | null;
  /** Spotkanie specjalne (widoczne na mapie), jeśli walka z niego pochodzi. */
  staticId: string | null;
  zoneId: string | null;
  enemySpecies: SpeciesData | null;
  /** Walka z trenerem (Sprint 5): jego id, rewanż (bez nagrody) i gatunki drużyny (Atlas) wg uid. */
  trainerId?: string | null;
  rematch?: boolean;
  trainerSpecies?: Record<string, SpeciesData>;
}

interface BattleStore {
  engine: BattleState | null;
  view: BattleView | null;
  phase: BattlePhase;
  menu: BattleMenu;
  meta: BattleMeta;
  begin(state: BattleState, intro: BattleEvent[], meta: BattleMeta): void;
  submit(action: PlayerAction): void;
  chooseSwitch(partyIndex: number): void;
  setMenu(menu: BattleMenu): void;
  skip(): void;
  clear(): void;
}

function toView(c: Creature): ViewCreature {
  return {
    uid: c.uid,
    pokemon: c.pokemon,
    name: c.nickname?.trim() || c.name,
    level: c.level,
    hp: c.hp,
    maxHp: c.stats.hp,
    status: c.status,
    types: c.types,
    shiny: c.shiny,
    mighty: c.mighty,
    gender: c.gender,
    exp: c.exp,
    growthRate: c.growthRate,
  };
}

function initialView(state: BattleState): BattleView {
  const creatures: Record<string, ViewCreature> = {};
  for (const side of state.sides) for (const c of side.party) creatures[c.uid] = toView(c);
  return { active: [null, null], creatures, message: '', anim: {}, hidden: {}, capsule: null };
}

// ── odtwarzanie zdarzeń ──
let playToken = 0;
let animCounter = 0;
let pendingWait: (() => void) | null = null;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      if (pendingWait === finish) pendingWait = null;
      resolve();
    }
    pendingWait = finish;
  });
}

function vibrate(ms: number) {
  if (!useGame.getState().settings.vibration) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* iOS: brak wsparcia */
  }
}

export const useBattle = create<BattleStore>()((set, get) => {
  const patchView = (fn: (v: BattleView) => Partial<BattleView>) => {
    const v = get().view;
    if (v) set({ view: { ...v, ...fn(v) } });
  };
  const patchCreature = (uid: string, p: Partial<ViewCreature>) =>
    patchView((v) => (v.creatures[uid] ? { creatures: { ...v.creatures, [uid]: { ...v.creatures[uid], ...p } } } : {}));
  const animate = (uid: string, kind: AnimKind) =>
    patchView((v) => ({ anim: { ...v.anim, [uid]: { kind, key: ++animCounter } } }));
  const setActive = (side: SideIndex, uid: string | null) =>
    patchView((v) => {
      const active: [string | null, string | null] = [...v.active];
      active[side] = uid;
      return { active };
    });

  async function playEvent(ev: BattleEvent, token: number): Promise<void> {
    const fast = useGame.getState().settings.fastText;
    switch (ev.t) {
      case 'msg':
        patchView(() => ({ message: ev.text }));
        await wait(fast ? 600 : 1150);
        return;
      case 'sendOut':
        patchView((v) => ({ hidden: { ...v.hidden, [ev.uid]: false } }));
        setActive(ev.side, ev.uid);
        animate(ev.uid, 'enter');
        await wait(450);
        return;
      case 'withdraw':
        animate(ev.uid, 'withdraw');
        await wait(380);
        if (token === playToken) setActive(ev.side, null);
        return;
      case 'useMove':
        animate(ev.uid, 'attack');
        await wait(320);
        return;
      case 'hp': {
        patchCreature(ev.uid, { hp: ev.hp, maxHp: ev.maxHp });
        const isActive = get().view?.active[ev.side] === ev.uid;
        if (ev.delta < 0 && isActive) {
          animate(ev.uid, 'hit');
          if (ev.side === 0) vibrate(ev.crit ? 60 : 25);
        }
        await wait(isActive ? 650 : 0);
        return;
      }
      case 'status':
        patchCreature(ev.uid, { status: ev.status });
        await wait(150);
        return;
      case 'boost':
        animate(ev.uid, ev.change > 0 ? 'boost-up' : 'boost-down');
        await wait(300);
        return;
      case 'miss':
        await wait(150);
        return;
      case 'faint':
        animate(ev.uid, 'faint');
        await wait(700);
        if (token === playToken) patchView((v) => ({ hidden: { ...v.hidden, [ev.uid]: true } }));
        return;
      case 'capsule': {
        patchView(() => ({ capsule: { item: ev.item, phase: 'throw', shake: 0 } }));
        await wait(650);
        const enemyUid = get().view?.active[1];
        if (enemyUid) patchView((v) => ({ hidden: { ...v.hidden, [enemyUid]: true } }));
        for (let i = 1; i <= ev.shakes; i++) {
          if (token !== playToken) return;
          patchView(() => ({ capsule: { item: ev.item, phase: 'shake', shake: i } }));
          await wait(700);
        }
        if (token !== playToken) return;
        if (ev.caught) {
          patchView(() => ({ capsule: { item: ev.item, phase: 'caught', shake: ev.shakes } }));
          vibrate(80);
          await wait(800);
        } else {
          patchView(() => ({ capsule: { item: ev.item, phase: 'broke', shake: ev.shakes } }));
          if (enemyUid) patchView((v) => ({ hidden: { ...v.hidden, [enemyUid]: false } }));
          if (enemyUid) animate(enemyUid, 'enter');
          await wait(450);
          patchView(() => ({ capsule: null }));
        }
        return;
      }
      case 'exp':
        patchCreature(ev.uid, { exp: ev.exp, level: ev.level });
        await wait(ev.gained > 0 ? 600 : 250);
        return;
      case 'levelUp':
        patchCreature(ev.uid, { level: ev.level, hp: ev.hp, maxHp: ev.maxHp });
        animate(ev.uid, 'boost-up');
        await wait(350);
        return;
      case 'needSwitch':
      case 'end':
        return;
    }
  }

  async function play(events: BattleEvent[], token: number): Promise<void> {
    for (const ev of events) {
      if (token !== playToken) return;
      await playEvent(ev, token);
    }
    if (token !== playToken) return;
    const st = get().engine;
    if (!st) return;
    set({ phase: st.outcome ? 'ended' : st.awaitingSwitch ? 'forcedSwitch' : 'choose', menu: 'root' });
  }

  function run(state: BattleState, events: BattleEvent[]) {
    playToken += 1;
    const token = playToken;
    set({ engine: state, phase: 'playing', menu: 'root' });
    void play(events, token);
  }

  return {
    engine: null,
    view: null,
    phase: 'intro',
    menu: 'root',
    meta: { encounterId: null, actorId: null, staticId: null, zoneId: null, enemySpecies: null },

    begin: (state, intro, meta) => {
      playToken += 1;
      const token = playToken;
      set({ engine: state, view: initialView(state), phase: 'intro', menu: 'root', meta });
      void play(intro, token);
    },

    submit: (action) => {
      const s = get();
      if (s.phase !== 'choose' || !s.engine) return;
      if (action.kind === 'item' && !useGame.getState().removeItem(action.item, 1)) return;
      const { state, events } = resolveTurn(s.engine, action, gameRng);
      run(state, events);
    },

    chooseSwitch: (partyIndex) => {
      const s = get();
      if (!s.engine) return;
      if (s.phase === 'forcedSwitch') {
        const { state, events } = forceSwitch(s.engine, partyIndex);
        if (state.awaitingSwitch) return;
        run(state, events);
      } else if (s.phase === 'choose') {
        get().submit({ kind: 'switch', partyIndex });
      }
    },

    setMenu: (menu) => set({ menu }),
    skip: () => pendingWait?.(),
    clear: () => {
      playToken += 1;
      pendingWait?.();
      set({ engine: null, view: null, phase: 'intro', menu: 'root', meta: { encounterId: null, actorId: null, staticId: null, zoneId: null, enemySpecies: null } });
    },
  };
});
