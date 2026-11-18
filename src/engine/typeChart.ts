import type { TypeChart } from './types';

export interface TypeRelations {
  name: string;
  double: string[];
  half: string[];
  none: string[];
}

/** Buduje tabelę skuteczności z relacji pobranych z /type/{name}. */
export function buildTypeChart(relations: TypeRelations[]): TypeChart {
  const chart: TypeChart = {};
  for (const r of relations) {
    const row: Record<string, number> = {};
    for (const t of r.double) row[t] = 2;
    for (const t of r.half) row[t] = 0.5;
    for (const t of r.none) row[t] = 0;
    chart[r.name] = row;
  }
  return chart;
}

export function effectiveness(chart: TypeChart, moveType: string, defenderTypes: readonly string[]): number {
  const row = chart[moveType];
  if (!row) return 1;
  let mult = 1;
  for (const t of defenderTypes) {
    const v = row[t];
    if (v !== undefined) mult *= v;
  }
  return mult;
}

export function effectivenessText(mult: number): string | null {
  if (mult === 0) return null; // osobny komunikat „nie działa”
  if (mult > 1) return 'To bardzo skuteczne!';
  if (mult < 1) return 'To niezbyt skuteczne…';
  return null;
}
