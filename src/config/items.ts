// Oryginalne przedmioty prototypu. Nazwy i wygląd są własne; parametry odpowiadają ogólnym zasadom gatunku.
// W etapie 2+ można je powiązać z przedmiotami z PokéAPI (/item) przez pole apiEquivalent.

import type { MajorStatus } from '../engine/types';

export type ItemId = 'capsule' | 'capsule-plus' | 'herb' | 'herb-strong' | 'balm';

export interface ItemDef {
  id: ItemId;
  name: string;
  description: string;
  kind: 'capture' | 'heal' | 'cure';
  price: number;
  catchBonus?: number;
  healAmount?: number;
  cures?: MajorStatus[] | 'all';
  usableInBattle: boolean;
  usableInField: boolean;
  apiEquivalent?: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  capsule: {
    id: 'capsule',
    name: 'Kapsuła',
    description: 'Podstawowa kapsuła do łapania dzikich stworzeń.',
    kind: 'capture',
    price: 200,
    catchBonus: 1,
    usableInBattle: true,
    usableInField: false,
    apiEquivalent: 'poke-ball',
  },
  'capsule-plus': {
    id: 'capsule-plus',
    name: 'Kapsuła+',
    description: 'Wzmocniona kapsuła. Łapie łatwiej niż zwykła.',
    kind: 'capture',
    price: 600,
    catchBonus: 1.5,
    usableInBattle: true,
    usableInField: false,
    apiEquivalent: 'great-ball',
  },
  herb: {
    id: 'herb',
    name: 'Napar',
    description: 'Przywraca 20 PŻ jednemu stworzeniu.',
    kind: 'heal',
    price: 300,
    healAmount: 20,
    usableInBattle: true,
    usableInField: true,
    apiEquivalent: 'potion',
  },
  'herb-strong': {
    id: 'herb-strong',
    name: 'Mocny napar',
    description: 'Przywraca 60 PŻ jednemu stworzeniu.',
    kind: 'heal',
    price: 700,
    healAmount: 60,
    usableInBattle: true,
    usableInField: true,
    apiEquivalent: 'super-potion',
  },
  balm: {
    id: 'balm',
    name: 'Balsam',
    description: 'Leczy każdy problem ze statusem (sen, paraliż, oparzenie, zatrucie, zamrożenie).',
    kind: 'cure',
    price: 400,
    cures: 'all',
    usableInBattle: true,
    usableInField: true,
    apiEquivalent: 'full-heal',
  },
};

export const SHOP_STOCK: ItemId[] = ['capsule', 'capsule-plus', 'herb', 'herb-strong', 'balm'];

export const STARTING_BAG: Partial<Record<ItemId, number>> = { capsule: 8, herb: 3, balm: 1 };
export const STARTING_MONEY = 2000;
