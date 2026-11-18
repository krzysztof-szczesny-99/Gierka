// Wspólny stan sterowania ekranowego (pad i przyciski React → scena Phasera).
// Celowo poza Zustandem: zmienia się bardzo często i nie powinien powodować renderów Reacta.

import type { Dir } from '../engine/types';

export const virtualInput: { dir: Dir | null; run: boolean; actionQueued: boolean } = {
  dir: null,
  run: false,
  actionQueued: false,
};

export function queueAction(): void {
  virtualInput.actionQueued = true;
}

export function consumeAction(): boolean {
  const a = virtualInput.actionQueued;
  virtualInput.actionQueued = false;
  return a;
}

export function resetVirtualInput(): void {
  virtualInput.dir = null;
  virtualInput.run = false;
  virtualInput.actionQueued = false;
}
