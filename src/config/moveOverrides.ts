// Ruchy, których obrażeń nie da się policzyć z pola `power` w PokéAPI (power = null).
// Implementacja na podstawie ogólnego opisu działania; pozostałe ruchy bez mocy dostają RULES.fallbackPower.

export type FixedDamageFn = (ctx: { attackerLevel: number; targetHp: number; targetMaxHp: number }) => number;

export const FIXED_DAMAGE: Record<string, FixedDamageFn> = {
  'sonic-boom': () => 20,
  'dragon-rage': () => 40,
  'seismic-toss': ({ attackerLevel }) => attackerLevel,
  'night-shade': ({ attackerLevel }) => attackerLevel,
  'super-fang': ({ targetHp }) => Math.max(1, Math.floor(targetHp / 2)),
  'natures-madness': ({ targetHp }) => Math.max(1, Math.floor(targetHp / 2)),
  ruination: ({ targetHp }) => Math.max(1, Math.floor(targetHp / 2)),
};

/** Ruch zastępczy, jeśli stworzenie nie ma żadnego ruchu zadającego obrażenia. */
export const FALLBACK_DAMAGE_MOVE = 'tackle';
