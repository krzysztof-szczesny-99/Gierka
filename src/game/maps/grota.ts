// Oryginalna mapa „Grota Echa” (16×12 kafelków) — ukryta lokacja (Sprint 7) za szczeliną w głazie na Wzgórzach Wiatru.
// Legenda jak w testMap.ts. Skalne dno (r) otoczone głazami, podziemne oczko wody. W głębi stoi jedyne stworzenie
// groty — spotkanie specjalne „Cień Groty Echa” (src/config/specialEncounters.ts). Brak losowych spotkań (brak stref).
// Wyjście: przejście na południu, z powrotem na Wzgórza Wiatru.

import type { MapDef } from './testMap';

export const GROTA_MAP: MapDef = {
  id: 'grota',
  name: 'Grota Echa',
  layout: [
    'RRRRRRRRRRRRRRRR',
    'RRRrrrrrrrrrrRRR',
    'RRrrrRrrrRrrrrRR',
    'RRrrrrrrrrrrrrRR',
    'RRrrr~~~rrrrrrRR',
    'RRrrr~~~rrrRrrRR',
    'RRrrrrrrrrrrrrRR',
    'RRRrrrrrrrrrrRRR',
    'RRRRRrrrrrrRRRRR',
    'RRRRRRrrrRRRRRRR',
    'RRRRRRr=rRRRRRRR',
    'RRRRRRR=RRRRRRRR',
  ],
  zones: [],
  signs: {},
  doors: {},
};
