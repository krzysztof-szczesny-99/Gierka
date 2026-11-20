// Oryginalne przedmioty prototypu. Nazwy i wygląd są własne; parametry odpowiadają ogólnym zasadom gatunku.
// Pole apiEquivalent wiąże przedmiot z nazwą w PokéAPI (/item) — np. kamienie ewolucji z danymi evolution-chain.

import type { MajorStatus, TypeName } from '../engine/types';

export type HeldItemId =
  | 'ember-coal'
  | 'spring-drop'
  | 'wonder-seed'
  | 'power-band'
  | 'sage-glasses'
  | 'trail-leftovers'
  | 'soothe-berry'
  | 'swift-claw'
  | 'training-weight'
  | 'order-berry';

export type EvolutionItemId = 'stone-fire' | 'stone-water' | 'stone-thunder' | 'stone-leaf' | 'stone-moon';

export type ItemId = 'capsule' | 'capsule-plus' | 'herb' | 'herb-strong' | 'balm' | HeldItemId | EvolutionItemId;

/** Działanie przedmiotu trzymanego w walce (src/engine/battle/heldItems.ts). */
export type HeldEffect =
  | { kind: 'type-boost'; type: TypeName; multiplier: number }
  | { kind: 'class-boost'; damageClass: 'physical' | 'special'; multiplier: number }
  | { kind: 'end-turn-heal'; fraction: number }
  | { kind: 'pinch-berry'; threshold: number; amount: number }
  | { kind: 'move-first'; chance: number }
  | { kind: 'training-weight'; speedMultiplier: number; evMultiplier: number }
  | { kind: 'status-berry' };

export interface ItemDef {
  id: ItemId;
  name: string;
  description: string;
  kind: 'capture' | 'heal' | 'cure' | 'held' | 'evolution';
  price: number;
  catchBonus?: number;
  healAmount?: number;
  cures?: MajorStatus[] | 'all';
  /** Działanie przedmiotu trzymanego (tylko kind: 'held'). */
  held?: HeldEffect;
  /** Jagody znikają po jednorazowym użyciu w walce. */
  consumable?: boolean;
  usableInBattle: boolean;
  usableInField: boolean;
  apiEquivalent?: string;
}

const held = (
  id: HeldItemId,
  name: string,
  description: string,
  price: number,
  effect: HeldEffect,
  apiEquivalent: string,
  consumable = false,
): ItemDef => ({ id, name, description, kind: 'held', price, held: effect, consumable, usableInBattle: false, usableInField: false, apiEquivalent });

const stone = (id: EvolutionItemId, name: string, description: string, apiEquivalent: string): ItemDef => ({
  id,
  name,
  description,
  kind: 'evolution',
  price: 2100,
  usableInBattle: false,
  usableInField: true,
  apiEquivalent,
});

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

  // — przedmioty trzymane: obrażenia —
  'ember-coal': held('ember-coal', 'Węgielek', 'Trzymany: ruchy ogniste zadają o 20% więcej obrażeń.', 1500, { kind: 'type-boost', type: 'fire', multiplier: 1.2 }, 'charcoal'),
  'spring-drop': held('spring-drop', 'Kropla źródlana', 'Trzymany: ruchy wodne zadają o 20% więcej obrażeń.', 1500, { kind: 'type-boost', type: 'water', multiplier: 1.2 }, 'mystic-water'),
  'wonder-seed': held('wonder-seed', 'Cudowne nasiono', 'Trzymany: ruchy roślinne zadają o 20% więcej obrażeń.', 1500, { kind: 'type-boost', type: 'grass', multiplier: 1.2 }, 'miracle-seed'),
  'power-band': held('power-band', 'Opaska siłacza', 'Trzymany: ruchy fizyczne zadają o 10% więcej obrażeń.', 2000, { kind: 'class-boost', damageClass: 'physical', multiplier: 1.1 }, 'muscle-band'),
  'sage-glasses': held('sage-glasses', 'Okulary mędrca', 'Trzymany: ruchy specjalne zadają o 10% więcej obrażeń.', 2000, { kind: 'class-boost', damageClass: 'special', multiplier: 1.1 }, 'wise-glasses'),
  // — leczenie —
  'trail-leftovers': held('trail-leftovers', 'Resztki prowiantu', 'Trzymany: na koniec każdej tury przywraca 1/16 maks. PŻ.', 3000, { kind: 'end-turn-heal', fraction: 1 / 16 }, 'leftovers'),
  'soothe-berry': held('soothe-berry', 'Jagoda kojąca', 'Trzymana: gdy PŻ spadną do połowy, przywraca 10 PŻ. Jednorazowa.', 300, { kind: 'pinch-berry', threshold: 0.5, amount: 10 }, 'oran-berry', true),
  // — prędkość —
  'swift-claw': held('swift-claw', 'Bystry pazur', 'Trzymany: 20% szansy, że właściciel zaatakuje pierwszy (w obrębie tego samego priorytetu).', 1800, { kind: 'move-first', chance: 0.2 }, 'quick-claw'),
  'training-weight': held('training-weight', 'Obciążnik treningowy', 'Trzymany: szybkość w walce ×0,5, ale punkty wysiłku rosną dwa razy szybciej.', 1200, { kind: 'training-weight', speedMultiplier: 0.5, evMultiplier: 2 }, 'macho-brace'),
  // — ochrona przed statusem —
  'order-berry': held('order-berry', 'Jagoda ładu', 'Trzymana: od razu leczy nałożony status lub dezorientację. Jednorazowa.', 500, { kind: 'status-berry' }, 'lum-berry', true),

  // — kamienie ewolucji (używane z Torby na stworzeniu) —
  'stone-fire': stone('stone-fire', 'Żarzący się kamień', 'Wywołuje ewolucję niektórych stworzeń (typowo ognistych).', 'fire-stone'),
  'stone-water': stone('stone-water', 'Kamień przypływu', 'Wywołuje ewolucję niektórych stworzeń (typowo wodnych).', 'water-stone'),
  'stone-thunder': stone('stone-thunder', 'Iskrzący kamień', 'Wywołuje ewolucję niektórych stworzeń (typowo elektrycznych).', 'thunder-stone'),
  'stone-leaf': stone('stone-leaf', 'Kamień liścia', 'Wywołuje ewolucję niektórych stworzeń (typowo roślinnych).', 'leaf-stone'),
  'stone-moon': stone('stone-moon', 'Kamień nowiu', 'Wywołuje ewolucję niektórych stworzeń.', 'moon-stone'),
};

export const HELD_ITEM_IDS: readonly HeldItemId[] = [
  'ember-coal',
  'spring-drop',
  'wonder-seed',
  'power-band',
  'sage-glasses',
  'trail-leftovers',
  'soothe-berry',
  'swift-claw',
  'training-weight',
  'order-berry',
];
export const EVOLUTION_ITEM_IDS: readonly EvolutionItemId[] = ['stone-fire', 'stone-water', 'stone-thunder', 'stone-leaf', 'stone-moon'];

export function isHeldItemId(v: unknown): v is HeldItemId {
  return typeof v === 'string' && (HELD_ITEM_IDS as readonly string[]).includes(v);
}

/** Lokalny przedmiot ewolucyjny odpowiadający nazwie przedmiotu z PokéAPI (np. 'water-stone'). */
export function evolutionItemForApi(apiName: string): EvolutionItemId | null {
  return EVOLUTION_ITEM_IDS.find((id) => ITEMS[id].apiEquivalent === apiName) ?? null;
}

export const SHOP_STOCK: ItemId[] = ['capsule', 'capsule-plus', 'herb', 'herb-strong', 'balm', ...HELD_ITEM_IDS, ...EVOLUTION_ITEM_IDS];

export const STARTING_BAG: Partial<Record<ItemId, number>> = { capsule: 8, herb: 3, balm: 1 };
export const STARTING_MONEY = 2000;
