import type { Creature, MajorStatus } from '../types';

/** Mapowanie nazw dolegliwości z PokéAPI (meta.ailment) na statusy główne silnika. */
export const AILMENT_TO_STATUS: Record<string, MajorStatus> = {
  paralysis: 'par',
  sleep: 'slp',
  freeze: 'frz',
  burn: 'brn',
  poison: 'psn',
};

export const STATUS_LABEL: Record<MajorStatus, string> = {
  par: 'PAR',
  slp: 'SEN',
  frz: 'ZAM',
  brn: 'OPA',
  psn: 'TRU',
};

export const STATUS_INFLICT_TEXT: Record<MajorStatus, string> = {
  par: 'zostaje sparaliżowany! Może nie być w stanie się ruszyć.',
  slp: 'zasypia!',
  frz: 'zostaje zamrożony!',
  brn: 'zostaje oparzony!',
  psn: 'zostaje zatruty!',
};

/** Odporności typów na statusy. */
export function canReceiveStatus(c: Creature, status: MajorStatus): boolean {
  if (c.hp <= 0 || c.status) return false;
  const t = c.types as string[];
  switch (status) {
    case 'brn':
      return !t.includes('fire');
    case 'psn':
      return !t.includes('poison') && !t.includes('steel');
    case 'par':
      return !t.includes('electric');
    case 'frz':
      return !t.includes('ice');
    case 'slp':
      return true;
  }
}
