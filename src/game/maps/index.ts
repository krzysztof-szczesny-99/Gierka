// Rejestr grywalnych map (klucz = LocationDef.mapReference w src/config/world.ts).

import { TEST_MAP, type MapDef } from './testMap';
import { STRAZNICA_MAP } from './straznica';
import { WZGORZA_MAP } from './wzgorza';
import { ZAGAJNIK_MAP } from './zagajnik';

export const MAPS: Readonly<Record<string, MapDef>> = {
  [TEST_MAP.id]: TEST_MAP,
  [ZAGAJNIK_MAP.id]: ZAGAJNIK_MAP,
  [WZGORZA_MAP.id]: WZGORZA_MAP,
  [STRAZNICA_MAP.id]: STRAZNICA_MAP,
};
