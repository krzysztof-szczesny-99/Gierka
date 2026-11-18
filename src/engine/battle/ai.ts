import type { Rng } from '../rng';
import { effectiveness } from '../typeChart';
import type { Creature, MoveData, TypeChart } from '../types';
import { AILMENT_TO_STATUS, canReceiveStatus } from './status';

export type AiMode = 'random' | 'smart';

/**
 * Wybór ruchu przez AI. Zwraca indeks ruchu albo -1 (ruch awaryjny, gdy brak PP).
 * - random: dzikie stworzenia (losowo spośród dostępnych),
 * - smart: tropiciele (etap 2) — ocena oczekiwanych obrażeń z odrobiną losowości.
 */
export function chooseMove(
  user: Creature,
  target: Creature,
  moves: Record<string, MoveData>,
  chart: TypeChart,
  rng: Rng,
  mode: AiMode,
): number {
  const usable = user.moves.map((slot, index) => ({ slot, index })).filter((x) => x.slot.pp > 0);
  if (usable.length === 0) return -1;
  if (mode === 'random') return rng.pick(usable).index;

  let best = usable[0].index;
  let bestScore = -Infinity;
  for (const { slot, index } of usable) {
    const move = moves[slot.name];
    if (!move) continue;
    let score: number;
    if (move.damageClass === 'status') {
      const status = move.meta ? AILMENT_TO_STATUS[move.meta.ailment] : undefined;
      if (status) score = canReceiveStatus(target, status) ? 45 : 0;
      else if (move.meta?.healing) score = user.hp < user.stats.hp / 2 ? 60 : 5;
      else score = move.statChanges.length ? 20 : 5;
    } else {
      const eff = effectiveness(chart, move.type, target.types);
      const stab = user.types.includes(move.type as never) ? 1.5 : 1;
      score = (move.power ?? 60) * eff * stab * ((move.accuracy ?? 100) / 100);
    }
    score *= 0.85 + rng.next() * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}
