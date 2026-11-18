// Dziennik zadań MVP. Postęp liczony z danych gry (bez osobnych liczników do synchronizacji).

import type { ItemId } from './items';

export interface QuestProgressSource {
  stats: { battlesWon: number; caught: number };
  dex: Record<string, { seen: boolean; caught: boolean }>;
  party: unknown[];
  flags: Record<string, boolean>;
}

export interface QuestDef {
  id: string;
  title: string;
  description: string;
  goal: number;
  progress: (d: QuestProgressSource) => number;
  reward: { money: number; items: Partial<Record<ItemId, number>> };
}

export const QUESTS: QuestDef[] = [
  {
    id: 'first-win',
    title: 'Pierwsze starcie',
    description: 'Wygraj walkę z dzikim stworzeniem.',
    goal: 1,
    progress: (d) => d.stats.battlesWon,
    reward: { money: 300, items: { capsule: 3 } },
  },
  {
    id: 'catch-3',
    title: 'Początek kolekcji',
    description: 'Złap 3 stworzenia przy użyciu kapsuł.',
    goal: 3,
    progress: (d) => d.stats.caught,
    reward: { money: 500, items: { 'capsule-plus': 2 } },
  },
  {
    id: 'seen-8',
    title: 'Bystre oko',
    description: 'Zobacz w walce 8 różnych gatunków.',
    goal: 8,
    progress: (d) => Object.values(d.dex).filter((e) => e.seen).length,
    reward: { money: 400, items: { 'herb-strong': 2 } },
  },
  {
    id: 'team-3',
    title: 'Zgrana paczka',
    description: 'Miej w drużynie co najmniej 3 stworzenia.',
    goal: 3,
    progress: (d) => d.party.length,
    reward: { money: 300, items: { balm: 2 } },
  },
  {
    id: 'grove',
    title: 'Tajemnica Cichego Gaju',
    description: 'Pokonaj albo złap stworzenie w Cichym Gaju.',
    goal: 1,
    progress: (d) => (d.flags['grove-done'] ? 1 : 0),
    reward: { money: 800, items: { 'capsule-plus': 3 } },
  },
];
