// BFS po siatce 4-kierunkowej: ścieżka do kliknięcia/dotknięcia na mapie.

export interface Point {
  x: number;
  y: number;
}

/**
 * Zwraca listę kroków od startu (bez niego) do celu (włącznie) albo null.
 * Cel może być nieprzechodni (np. tabliczka, stworzenie) — ostatni krok to wtedy „zderzenie” = interakcja.
 */
export function findPath(
  start: Point,
  goal: Point,
  passable: (x: number, y: number) => boolean,
  width: number,
  height: number,
  maxNodes = 5000,
): Point[] | null {
  if (start.x === goal.x && start.y === goal.y) return [];
  const idx = (x: number, y: number) => y * width + x;
  const prev = new Int32Array(width * height).fill(-1);
  const seen = new Uint8Array(width * height);
  const queue: number[] = [idx(start.x, start.y)];
  seen[queue[0]] = 1;
  const dirs = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  let head = 0;
  while (head < queue.length && head < maxNodes) {
    const cur = queue[head++];
    const cx = cur % width;
    const cy = Math.floor(cur / width);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = idx(nx, ny);
      if (seen[ni]) continue;
      const isGoal = nx === goal.x && ny === goal.y;
      if (!isGoal && !passable(nx, ny)) continue;
      seen[ni] = 1;
      prev[ni] = cur;
      if (isGoal) {
        const out: Point[] = [];
        let p = ni;
        while (p !== idx(start.x, start.y)) {
          out.push({ x: p % width, y: Math.floor(p / width) });
          p = prev[p];
        }
        return out.reverse();
      }
      queue.push(ni);
    }
  }
  return null;
}
