// Zdolności działające w walce (Sprint 4) — pierwsza grupa prostych mechanik, które obecny silnik obsługuje
// w pełni. Identyfikatory są nazwami zdolności z PokéAPI (tak jak zapisuje je stworzenie — `abilityId`);
// polskie nazwy i opisy są własne. Zdolności spoza tej listy są zapisywane, ale jeszcze nie działają
// (interfejs mówi o tym wprost). Logika: src/engine/battle/effects.ts.

import type { BoostKey, MajorStatus, TypeName } from '../engine/types';

export type AbilityEffect =
  /** Ruchy danego typu ×1,5, gdy PŻ ≤ 1/3 maksimum. */
  | { kind: 'pinch-boost'; type: TypeName; multiplier: number; hpFraction: number }
  /** Przy wejściu do walki obniża statystykę przeciwnika. */
  | { kind: 'entry-lower-foe'; stat: BoostKey; change: number }
  /** Przeciwnik nie może obniżyć wskazanych statystyk (lub wszystkich). */
  | { kind: 'block-foe-drop'; stats: BoostKey[] | 'all' }
  /** Odporność na status główny. */
  | { kind: 'status-immunity'; status: MajorStatus }
  /** Odporność na dezorientację. */
  | { kind: 'confusion-immunity' }
  /** Na koniec tury szansa na wyleczenie statusu. */
  | { kind: 'end-turn-cure'; chance: number }
  /** Ruch danego typu zamiast obrażeń leczy o część maks. PŻ. */
  | { kind: 'absorb-type'; type: TypeName; healFraction: number }
  /** Mniejsze obrażenia od ruchów wskazanych typów. */
  | { kind: 'resist-types'; types: TypeName[]; multiplier: number }
  /** Ucieczka z walki z dzikim stworzeniem zawsze się udaje. */
  | { kind: 'sure-escape' }
  /** Dodatkowe efekty ruchów przeciwnika (status, wzdrygnięcie, spadki statystyk) nie działają. */
  | { kind: 'block-secondary' }
  /** Sen mija dwa razy szybciej. */
  | { kind: 'fast-wake' };

export interface AbilityDef {
  id: string;
  name: string;
  description: string;
  effect: AbilityEffect;
}

const a = (id: string, name: string, description: string, effect: AbilityEffect): AbilityDef => ({ id, name, description, effect });
const pinch = (type: TypeName) => ({ kind: 'pinch-boost' as const, type, multiplier: 1.5, hpFraction: 1 / 3 });

export const ABILITIES: Record<string, AbilityDef> = {
  overgrow: a('overgrow', 'Gęstwina', 'Gdy PŻ spadną do 1/3, ruchy roślinne są o 50% silniejsze.', pinch('grass')),
  blaze: a('blaze', 'Płomień', 'Gdy PŻ spadną do 1/3, ruchy ogniste są o 50% silniejsze.', pinch('fire')),
  torrent: a('torrent', 'Nurt', 'Gdy PŻ spadną do 1/3, ruchy wodne są o 50% silniejsze.', pinch('water')),
  swarm: a('swarm', 'Rój', 'Gdy PŻ spadną do 1/3, ruchy owadzie są o 50% silniejsze.', pinch('bug')),
  intimidate: a('intimidate', 'Groźne spojrzenie', 'Po wejściu do walki obniża atak przeciwnika o jeden stopień.', { kind: 'entry-lower-foe', stat: 'atk', change: -1 }),
  'keen-eye': a('keen-eye', 'Bystre oko', 'Przeciwnik nie może obniżyć celności.', { kind: 'block-foe-drop', stats: ['acc'] }),
  'hyper-cutter': a('hyper-cutter', 'Mocne szczypce', 'Przeciwnik nie może obniżyć ataku.', { kind: 'block-foe-drop', stats: ['atk'] }),
  'clear-body': a('clear-body', 'Czyste ciało', 'Przeciwnik nie może obniżyć żadnej statystyki.', { kind: 'block-foe-drop', stats: 'all' }),
  insomnia: a('insomnia', 'Bezsenność', 'Chroni przed snem.', { kind: 'status-immunity', status: 'slp' }),
  limber: a('limber', 'Gibkość', 'Chroni przed paraliżem.', { kind: 'status-immunity', status: 'par' }),
  immunity: a('immunity', 'Odporność', 'Chroni przed zatruciem.', { kind: 'status-immunity', status: 'psn' }),
  'water-veil': a('water-veil', 'Wodna zasłona', 'Chroni przed oparzeniem.', { kind: 'status-immunity', status: 'brn' }),
  'magma-armor': a('magma-armor', 'Magmowy pancerz', 'Chroni przed zamrożeniem.', { kind: 'status-immunity', status: 'frz' }),
  'own-tempo': a('own-tempo', 'Własne tempo', 'Chroni przed dezorientacją.', { kind: 'confusion-immunity' }),
  'shed-skin': a('shed-skin', 'Zrzucanie skóry', 'Na koniec tury 1/3 szansy na wyleczenie statusu.', { kind: 'end-turn-cure', chance: 1 / 3 }),
  'water-absorb': a('water-absorb', 'Chłonięcie wody', 'Ruchy wodne nie zadają obrażeń, tylko leczą o 1/4 maks. PŻ.', { kind: 'absorb-type', type: 'water', healFraction: 1 / 4 }),
  'thick-fat': a('thick-fat', 'Gruby tłuszcz', 'Obrażenia od ruchów ognistych i lodowych są o połowę mniejsze.', { kind: 'resist-types', types: ['fire', 'ice'], multiplier: 0.5 }),
  'run-away': a('run-away', 'Ucieczka', 'Ucieczka z walki z dzikim stworzeniem zawsze się udaje.', { kind: 'sure-escape' }),
  'shield-dust': a('shield-dust', 'Pyłek osłonny', 'Dodatkowe efekty ruchów przeciwnika (status, wzdrygnięcie, spadek statystyk) nie działają.', { kind: 'block-secondary' }),
  'early-bird': a('early-bird', 'Ranny ptaszek', 'Sen mija dwa razy szybciej.', { kind: 'fast-wake' }),
};

export const IMPLEMENTED_ABILITY_IDS = Object.keys(ABILITIES);

export function abilityDef(id: string | null | undefined): AbilityDef | null {
  return (id && ABILITIES[id]) || null;
}
