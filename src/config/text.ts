// Polskie etykiety i oryginalna paleta kolorów typów (własny dobór barw).

import type { MajorStatus, StatKey, TypeName } from '../engine/types';

export const TYPE_LABEL: Record<TypeName, string> = {
  normal: 'Normalny',
  fighting: 'Walczący',
  flying: 'Latający',
  poison: 'Trujący',
  ground: 'Ziemny',
  rock: 'Skalny',
  bug: 'Robaczy',
  ghost: 'Duch',
  steel: 'Stalowy',
  fire: 'Ognisty',
  water: 'Wodny',
  grass: 'Trawiasty',
  electric: 'Elektryczny',
  psychic: 'Psychiczny',
  ice: 'Lodowy',
  dragon: 'Smoczy',
  dark: 'Mroczny',
  fairy: 'Wróżkowy',
};

export const TYPE_COLOR: Record<string, string> = {
  normal: '#9a9a86',
  fighting: '#c0453a',
  flying: '#8fa8e8',
  poison: '#9b4fb5',
  ground: '#c9a35a',
  rock: '#a8935a',
  bug: '#99b33a',
  ghost: '#6a5a9c',
  steel: '#8fa3b0',
  fire: '#e8743b',
  water: '#4b8fe2',
  grass: '#4caf62',
  electric: '#e6c229',
  psychic: '#e05a8a',
  ice: '#7fd3d8',
  dragon: '#5f5ae0',
  dark: '#5b4a40',
  fairy: '#e28fc4',
};

export const STATUS_COLOR: Record<MajorStatus, string> = {
  par: '#d9b42b',
  slp: '#8a8f9c',
  frz: '#6cc6d9',
  brn: '#e2643a',
  psn: '#a356c2',
};

export const STAT_LABEL: Record<StatKey, string> = {
  hp: 'PŻ',
  atk: 'Atak',
  def: 'Obrona',
  spa: 'Sp. atak',
  spd: 'Sp. obrona',
  spe: 'Szybkość',
};

export function typeLabel(t: string): string {
  return (TYPE_LABEL as Record<string, string>)[t] ?? t;
}

export function prettySlug(slug: string): string {
  return slug
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

export const CURRENCY = '◆';
