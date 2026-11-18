// Stałe zasad walki i rozwoju. Punkt wyjścia: zasady 4. generacji,
// z kilkoma oznaczonymi usprawnieniami współczesnymi. Wszystko można stroić w jednym miejscu.

export const RULES = {
  maxPartySize: 6,
  maxLevel: 100,
  maxMoves: 4,

  // Obrażenia
  stabMultiplier: 1.5,
  critMultiplier: 2, // 4. gen: ×2 (nowsze gry: ×1,5)
  critStageChance: [1 / 16, 1 / 8, 1 / 4, 1 / 3, 1 / 2],
  randomMin: 85, // losowy czynnik 85–100%
  fallbackPower: 60, // ruchy o zmiennej mocy, których jeszcze nie symulujemy
  strugglePower: 50, // ruch awaryjny, gdy skończą się PP

  // Statusy
  burnDamage: 1 / 8,
  poisonDamage: 1 / 8,
  paralysisSkipChance: 0.25,
  paralysisSpeedMultiplier: 0.25,
  freezeThawChance: 0.2,
  sleepTurns: [1, 3] as const, // liczba straconych tur snu (budzi się i działa w kolejnej)
  confusionTurns: [1, 4] as const,
  confusionSelfHitChance: 1 / 3, // 4. gen: 1/2 — usprawnienie: 1/3
  confusionSelfHitPower: 40,

  // Łapanie
  catchStatusBonus: { slp: 2, frz: 2, par: 1.5, brn: 1.5, psn: 1.5 } as Record<string, number>,
  expOnCatch: true, // usprawnienie współczesne: EXP również za złapanie

  // Doświadczenie i rozwój
  expDivisor: 7,
  trainerExpMultiplier: 1.5,
  evMaxPerStat: 252,
  evMaxTotal: 510,
  shinyChance: 1 / 512, // prototyp: częściej niż w grach, żeby dało się to zobaczyć
  mightyChance: 0.08, // „Potężny okaz” (inspiracja otwartymi strefami)
  mightyLevelBonus: 3,
  mightyMinIv: 20,

  // Nagrody i kary
  wildMoneyReward: [12, 30] as const, // żetony za pokonanie dzikiego (× poziom / 4)
  blackoutMoneyLoss: 0.1,
} as const;
