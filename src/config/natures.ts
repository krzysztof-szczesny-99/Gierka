// Natury stworzeń: jedna statystyka +10%, inna −10% albo natura neutralna (bez zmian).
// Identyfikatory i rozkład statystyk są zgodne z danymi PokéAPI (/nature) — to ogólna mechanika gatunku.
// Polskie nazwy są własne.

import type { StatKey } from '../engine/types';

export type NatureId =
  | 'hardy'
  | 'lonely'
  | 'brave'
  | 'adamant'
  | 'naughty'
  | 'bold'
  | 'docile'
  | 'relaxed'
  | 'impish'
  | 'lax'
  | 'timid'
  | 'hasty'
  | 'serious'
  | 'jolly'
  | 'naive'
  | 'modest'
  | 'mild'
  | 'quiet'
  | 'bashful'
  | 'rash'
  | 'calm'
  | 'gentle'
  | 'sassy'
  | 'careful'
  | 'quirky';

/** Statystyka podnoszona/obniżana przez naturę (PŻ nigdy). */
export type NatureStat = Exclude<StatKey, 'hp'>;

export interface NatureDef {
  id: NatureId;
  name: string;
  increased: NatureStat | null;
  decreased: NatureStat | null;
}

export const NATURE_UP = 1.1;
export const NATURE_DOWN = 0.9;

const n = (id: NatureId, name: string, increased: NatureStat | null, decreased: NatureStat | null): NatureDef => ({
  id,
  name,
  increased,
  decreased,
});

export const NATURES: Record<NatureId, NatureDef> = {
  hardy: n('hardy', 'Twarda', null, null),
  lonely: n('lonely', 'Samotna', 'atk', 'def'),
  brave: n('brave', 'Odważna', 'atk', 'spe'),
  adamant: n('adamant', 'Nieugięta', 'atk', 'spa'),
  naughty: n('naughty', 'Psotna', 'atk', 'spd'),
  bold: n('bold', 'Śmiała', 'def', 'atk'),
  docile: n('docile', 'Potulna', null, null),
  relaxed: n('relaxed', 'Wyluzowana', 'def', 'spe'),
  impish: n('impish', 'Figlarna', 'def', 'spa'),
  lax: n('lax', 'Niedbała', 'def', 'spd'),
  timid: n('timid', 'Lękliwa', 'spe', 'atk'),
  hasty: n('hasty', 'Pochopna', 'spe', 'def'),
  serious: n('serious', 'Poważna', null, null),
  jolly: n('jolly', 'Wesoła', 'spe', 'spa'),
  naive: n('naive', 'Naiwna', 'spe', 'spd'),
  modest: n('modest', 'Skromna', 'spa', 'atk'),
  mild: n('mild', 'Łagodna', 'spa', 'def'),
  quiet: n('quiet', 'Cicha', 'spa', 'spe'),
  bashful: n('bashful', 'Nieśmiała', null, null),
  rash: n('rash', 'Porywcza', 'spa', 'spd'),
  calm: n('calm', 'Spokojna', 'spd', 'atk'),
  gentle: n('gentle', 'Delikatna', 'spd', 'def'),
  sassy: n('sassy', 'Zuchwała', 'spd', 'spe'),
  careful: n('careful', 'Ostrożna', 'spd', 'spa'),
  quirky: n('quirky', 'Dziwaczna', null, null),
};

export const NATURE_IDS = Object.keys(NATURES) as NatureId[];
export const NEUTRAL_NATURES: readonly NatureId[] = NATURE_IDS.filter((id) => NATURES[id].increased === null);

export function isNatureId(v: unknown): v is NatureId {
  return typeof v === 'string' && v in NATURES;
}

/** Mnożnik natury dla statystyki (1,1 / 0,9 / 1). */
export function natureMultiplier(nature: NatureId | null | undefined, stat: StatKey): number {
  const def = nature ? NATURES[nature] : undefined;
  if (!def || stat === 'hp') return 1;
  if (def.increased === stat) return NATURE_UP;
  if (def.decreased === stat) return NATURE_DOWN;
  return 1;
}

/**
 * Natura neutralna wyznaczona stabilnie z identyfikatora stworzenia — dla stworzeń ze starszych zapisów
 * (migracja v2 → v3): statystyki zapisane w grze pozostają bez zmian.
 */
export function neutralNatureFor(uid: string): NatureId {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return NEUTRAL_NATURES[h % NEUTRAL_NATURES.length];
}
