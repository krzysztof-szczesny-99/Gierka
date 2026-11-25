import type { Rng } from '../rng';
import { effectiveness } from '../typeChart';
import type { Creature, MoveData, TypeChart } from '../types';
import { abilityBlocksStatus } from './effects';
import { AILMENT_TO_STATUS, canReceiveStatus } from './status';

/** Profile AI trenerów (Sprint 5). */
export type AiProfile = 'BASIC' | 'BALANCED' | 'AGGRESSIVE';
export const AI_PROFILES: readonly AiProfile[] = ['BASIC', 'BALANCED', 'AGGRESSIVE'];

/** 'random' — dzikie stworzenia; profile — trenerzy. */
export type AiMode = 'random' | AiProfile;

export function isAiProfile(v: unknown): v is AiProfile {
  return typeof v === 'string' && (AI_PROFILES as readonly string[]).includes(v);
}

interface Usable {
  index: number;
  move: MoveData | undefined;
}

function usableMoves(user: Creature, moves: Record<string, MoveData>): Usable[] {
  return user.moves.map((slot, index) => ({ slot, index })).filter((x) => x.slot.pp > 0).map((x) => ({ index: x.index, move: moves[x.slot.name] }));
}

const isDamaging = (m: MoveData | undefined): m is MoveData => !!m && m.damageClass !== 'status' && (m.power ?? 0) > 0;

/**
 * Oczekiwane obrażenia ruchu (bez losowości): moc × skuteczność typu × STAB × celność × stosunek
 * ataku do obrony. Służy wyłącznie do porównania ruchów — AI nie korzysta z przyszłych wartości losowych.
 */
export function expectedDamageScore(user: Creature, target: Creature, move: MoveData, chart: TypeChart): number {
  if (!isDamaging(move)) return 0;
  const eff = effectiveness(chart, move.type, target.types);
  if (eff === 0) return 0;
  const stab = user.types.includes(move.type as never) ? 1.5 : 1;
  const physical = move.damageClass === 'physical';
  const ratio = (physical ? user.stats.atk : user.stats.spa) / Math.max(1, physical ? target.stats.def : target.stats.spd);
  return (move.power ?? 0) * eff * stab * ((move.accuracy ?? 100) / 100) * ratio;
}

/** Czy ruch statusowy ma sens wobec celu (nie nakłada statusu, który i tak nie zadziała). */
function statusMoveUseful(user: Creature, target: Creature, move: MoveData): boolean {
  const status = move.meta ? AILMENT_TO_STATUS[move.meta.ailment] : undefined;
  if (status) return canReceiveStatus(target, status) && !abilityBlocksStatus(target, status);
  if (move.meta?.healing) return user.hp < user.stats.hp;
  return true;
}

/** Ocena ruchu statusowego w profilu BALANCED (porównywalna z oczekiwanymi obrażeniami). */
function statusScore(user: Creature, target: Creature, move: MoveData, bestDamage: number): number {
  if (!statusMoveUseful(user, target, move)) return 0;
  const status = move.meta ? AILMENT_TO_STATUS[move.meta.ailment] : undefined;
  if (status) return Math.max(20, bestDamage * 0.6);
  if (move.meta?.healing) return user.hp < user.stats.hp / 2 ? bestDamage * 1.2 + 30 : 0;
  return move.statChanges.length ? Math.max(10, bestDamage * 0.3) : 1;
}

/**
 * Wybór ruchu. Zwraca indeks ruchu albo -1 (ruch awaryjny, gdy żaden ruch nie ma PP).
 * - random (dzikie): losowo spośród ruchów z PP — jedno losowanie, jak dotąd,
 * - BASIC: losowo spośród sensownych ruchów (pomija ruchy bez efektu i bezużyteczne statusy) — jedno losowanie,
 * - BALANCED: najwyższa ocena (oczekiwane obrażenia albo sensowny status) — bez losowania,
 * - AGGRESSIVE: największe oczekiwane obrażenia — bez losowania.
 */
export function chooseMove(
  user: Creature,
  target: Creature,
  moves: Record<string, MoveData>,
  chart: TypeChart,
  rng: Rng,
  mode: AiMode,
): number {
  const usable = usableMoves(user, moves);
  if (usable.length === 0) return -1;
  if (mode === 'random') return rng.pick(usable).index;

  const damage = (u: Usable) => (u.move ? expectedDamageScore(user, target, u.move, chart) : 0);

  if (mode === 'BASIC') {
    const sensible = usable.filter((u) => (isDamaging(u.move) ? damage(u) > 0 : !!u.move && statusMoveUseful(user, target, u.move)));
    return rng.pick(sensible.length ? sensible : usable).index;
  }

  const bestDamage = Math.max(0, ...usable.map(damage));
  let best = usable[0].index;
  let bestScore = -1;
  for (const u of usable) {
    let score: number;
    if (isDamaging(u.move)) score = damage(u);
    else if (u.move && mode === 'BALANCED') score = statusScore(user, target, u.move, bestDamage);
    else score = 0;
    // Remis — niższy indeks (deterministycznie).
    if (score > bestScore) {
      bestScore = score;
      best = u.index;
    }
  }
  return best;
}

/** Najlepsze oczekiwane obrażenia stworzenia wobec celu (ruchy z PP). */
export function bestDamageAgainst(user: Creature, target: Creature, moves: Record<string, MoveData>, chart: TypeChart): number {
  return Math.max(0, ...usableMoves(user, moves).map((u) => (u.move ? expectedDamageScore(user, target, u.move, chart) : 0)));
}

/**
 * Zmiana stworzenia (profil BALANCED): gdy aktywne stworzenie praktycznie nie może zaszkodzić celowi
 * (najlepszy ruch ≤ 1/4 tego, co osiągnąłby ktoś z drużyny), a w drużynie jest sprawne stworzenie z wyraźnie
 * lepszym ruchem. Zwraca indeks w drużynie albo null. Bez losowania.
 */
export function chooseSwitch(
  active: Creature,
  party: Creature[],
  activeIndex: number,
  target: Creature,
  moves: Record<string, MoveData>,
  chart: TypeChart,
): number | null {
  const current = bestDamageAgainst(active, target, moves, chart);
  let bestIdx: number | null = null;
  let bestScore = 0;
  party.forEach((c, i) => {
    if (i === activeIndex || c.hp <= 0) return;
    const s = bestDamageAgainst(c, target, moves, chart);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  });
  if (bestIdx === null) return null;
  return current * 4 <= bestScore ? bestIdx : null;
}
