// Rejestr grywalnych map (klucz = LocationDef.mapReference w src/config/world.ts).

import { TEST_MAP, type MapDef } from './testMap';
import { ZAGAJNIK_MAP } from './zagajnik';

export const MAPS: Readonly<Record<string, MapDef>> = {
  [TEST_MAP.id]: TEST_MAP,
  [ZAGAJNIK_MAP.id]: ZAGAJNIK_MAP,
};
