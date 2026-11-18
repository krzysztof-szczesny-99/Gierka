// Oryginalna mapa testowa „Polana Startowa” (40×32 kafelki).
// Legenda: T drzewo · . trawa · , wysoka trawa · = ścieżka · ~ woda · s piasek · r skalisty grunt · R głaz
//          f kwiaty · F płot · S tabliczka · C/c Stacja Opieki · M/m Kram · w ściana · D/E drzwi

import type { Dir } from '../../engine/types';

export interface ZoneDef {
  id: string;
  name: string;
  rect: { x: number; y: number; w: number; h: number };
  table: string;
  maxActive: number;
  spawnTiles: string[];
}

export interface MapDef {
  id: string;
  name: string;
  layout: string[];
  spawn: { x: number; y: number; facing: Dir };
  healReturn: { x: number; y: number; facing: Dir };
  zones: ZoneDef[];
  signs: Record<string, string[]>;
  doors: Record<string, 'care' | 'shop'>;
}

export const TEST_MAP: MapDef = {
  id: 'polana',
  name: 'Polana Startowa',
  layout: [
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'T...............T.,,,,,,,,,,,,,,,,,,,,.T',
    'T.fCCcCC..MmMM.fT.,,,,,,,,,..,,,,,,T,,.T',
    'T.fCCCCC..MMMMf.T.,,,,TT,,,,,,,,,,,T,,.T',
    'T..wwDww..wEww..T.,,,,T,,,,,,,,,,,,,,,.T',
    'T..===========.fT.,,,,,,,,,,,,TT,,,,,,.T',
    'T.f.....=S..ff...S,,,,,,,.,,,,T,,,,,,,.T',
    'T..ff...==========,,..,,,,,,,,,,,,,,,,.T',
    'T.......=.........,,,,,,,,,,,,,,,..,,,.T',
    'T.FFFFFF=FFFFFFFT.,,,,,,,,T,,,,,,,,,,,.T',
    'T.......=.......T.,,,,,,,,,,,,,,,,,,,,.T',
    'T.......=.......T.,,,,,,,,,,,,,,,,,,,,.T',
    'T.......=.......T......................T',
    'T.......=..............................T',
    'T.......=..............................T',
    'T.......========================.......T',
    'T..............S..............S=.......T',
    'T.,,..............f...f.rrrrRrrrrrrrrr.T',
    'T...sssssssss.,.........rRrrrrrrrrRrrr.T',
    'T..sss~~~~~sss.,...TT...rrrrrrrrrrrrrr.T',
    'T.ss~~~~~~~~~ss,...T....rrrrrrrrrrrrRr.T',
    'T.ss~~~~~~~~~ss........frrrrrRrrrrrrrr.T',
    'T.s~~~~~~~~~~~s.....f...rrRrrrrrSrrrrr.T',
    'T.ss~~~~~~~~~ss..f......rrrrrrrTTT.TTTTT',
    'T.ss~~~~~~~~~ss......T..rrrrrrrT,,,,,,TT',
    'T..sss~~~~~sss.......T..rrrrrrrT,,,,,,TT',
    'T...sssssssss.,,........rRrrrrrT,,,T,,TT',
    'T.,,..............TT....rrrrrrrT,,,,,,TT',
    'T...,........,,.......f.rrrrRrrT,f,,,,TT',
    'T.......................RrrrrrrT,,,,,,TT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
  spawn: { x: 8, y: 7, facing: 'down' },
  healReturn: { x: 5, y: 6, facing: 'down' },
  zones: [
    { id: 'meadow', name: 'Łąka', rect: { x: 18, y: 2, w: 20, h: 11 }, table: 'meadow', maxActive: 5, spawnTiles: [','] },
    { id: 'pond', name: 'Brzeg Stawu', rect: { x: 1, y: 17, w: 16, h: 14 }, table: 'pond', maxActive: 3, spawnTiles: ['s', ','] },
    { id: 'rocks', name: 'Skalny Zakątek', rect: { x: 24, y: 18, w: 14, h: 6 }, table: 'rocks', maxActive: 3, spawnTiles: ['r'] },
    { id: 'grove', name: 'Cichy Gaj', rect: { x: 32, y: 25, w: 6, h: 6 }, table: 'grove', maxActive: 2, spawnTiles: [','] },
  ],
  signs: {
    '9,7': [
      'Polana Startowa.',
      'Na północy: Stacja Opieki (leczenie) i Kram (zakupy). Na wschodzie Łąka, na południu Staw i Skalny Zakątek.',
    ],
    '17,7': ['Łąka.', 'Stworzenia kryją się w wysokiej trawie. Niektóre same ruszą w Twoją stronę!'],
    '15,17': ['Staw.', 'Na piaszczystym brzegu spotkasz stworzenia, które lubią wodę.'],
    '30,17': ['Skalny Zakątek.', 'Twarde skały, twarde stworzenia. Przygotuj drużynę.'],
    '32,23': ['Cichy Gaj.', 'Rzadkie i silniejsze stworzenia. Wejście tylko dla doświadczonych tropicieli.'],
  },
  doors: {
    '5,5': 'care',
    '11,5': 'shop',
  },
};

export const MAPS: Record<string, MapDef> = { [TEST_MAP.id]: TEST_MAP };
