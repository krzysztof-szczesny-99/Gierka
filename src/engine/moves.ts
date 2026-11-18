import { RULES } from '../config/rules';
import type { LevelMove, MoveData } from './types';

/** Ostatnie (maks. 4) ruchy, których gatunek nauczyłby się do danego poziomu. */
export function movesForLevel(levelMoves: readonly LevelMove[], level: number, max: number = RULES.maxMoves): string[] {
  const learned: string[] = [];
  const sorted = [...levelMoves].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  for (const m of sorted) {
    if (m.level > level) break;
    const idx = learned.indexOf(m.name);
    if (idx >= 0) learned.splice(idx, 1);
    learned.push(m.name);
  }
  return learned.slice(-max);
}

/** Ruchy uczone dokładnie na danym poziomie. */
export function newMovesAtLevel(levelMoves: readonly LevelMove[], level: number): string[] {
  return levelMoves.filter((m) => m.level === level).map((m) => m.name);
}

export function isDamaging(move: MoveData): boolean {
  return move.damageClass !== 'status';
}

const SELF_TARGETS = new Set(['user', 'user-and-allies', 'users-field', 'ally', 'user-or-ally', 'entire-field']);
export function targetsUser(move: MoveData): boolean {
  return SELF_TARGETS.has(move.target);
}

/**
 * Komu zmieniamy statystyki? PokéAPI nie rozróżnia tego wprost, więc korzystamy z kategorii meta:
 * „damage+raise” (np. ruchy obniżające własną obronę) → użytkownik; „damage+lower” → cel;
 * ruchy statusowe → zależnie od pola target.
 */
export function statChangeHitsUser(move: MoveData): boolean {
  const cat = move.meta?.category;
  if (cat === 'damage+raise') return true;
  if (cat === 'damage+lower') return false;
  return targetsUser(move);
}

const STAT_LABEL: Record<string, string> = {
  atk: 'atak',
  def: 'obronę',
  spa: 'sp. atak',
  spd: 'sp. obronę',
  spe: 'szybkość',
  acc: 'celność',
  eva: 'unik',
};

const AILMENT_LABEL: Record<string, string> = {
  paralysis: 'paraliż',
  sleep: 'sen',
  freeze: 'zamrożenie',
  burn: 'oparzenie',
  poison: 'zatrucie',
  confusion: 'dezorientację',
};

const CLASS_LABEL: Record<string, string> = { physical: 'Fizyczny', special: 'Specjalny', status: 'Statusowy' };

/** Krótki opis ruchu po polsku, wygenerowany z danych (bez kopiowania tekstów gier). */
export function describeMove(move: MoveData): string {
  const parts: string[] = [CLASS_LABEL[move.damageClass] ?? move.damageClass];
  if (move.power) parts.push(`moc ${move.power}`);
  parts.push(move.accuracy ? `celność ${move.accuracy}%` : 'zawsze trafia');
  if (move.priority > 0) parts.push('atakuje pierwszy');
  const meta = move.meta;
  if (meta) {
    const ail = AILMENT_LABEL[meta.ailment];
    if (ail) parts.push(meta.ailmentChance > 0 ? `${meta.ailmentChance}% na ${ail}` : `wywołuje ${ail}`);
    if (meta.drain > 0) parts.push(`odzyskuje ${meta.drain}% zadanych obrażeń`);
    if (meta.drain < 0) parts.push(`odrzut ${-meta.drain}%`);
    if (meta.healing > 0) parts.push(`leczy ${meta.healing}% PŻ`);
    if (meta.maxHits && meta.maxHits > 1) parts.push(`${meta.minHits ?? 2}–${meta.maxHits} trafień`);
    if (meta.flinchChance > 0) parts.push(`${meta.flinchChance}% na wzdrygnięcie`);
    if (meta.critRate > 0) parts.push('wysoka szansa na krytyk');
  }
  for (const sc of move.statChanges) {
    const who = statChangeHitsUser(move) ? 'użytkownika' : 'celu';
    const dir = sc.change > 0 ? 'podnosi' : 'obniża';
    parts.push(`${dir} ${STAT_LABEL[sc.stat] ?? sc.stat} ${who} (${sc.change > 0 ? '+' : ''}${sc.change})`);
  }
  return parts.join(' · ');
}
