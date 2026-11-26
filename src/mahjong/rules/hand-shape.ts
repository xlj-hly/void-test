import { canWin, tileKind, type Meld } from './tiles';

export function analyse(tiles: number[], groups: Meld[], splitQuads = false) {
  const counts = new Map<number, number>();
  for (const tile of tiles) {
    const kind = tileKind(tile);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const values = [...counts.values()];
  const sevenPairs = !groups.length && tiles.length === 14
    && (splitQuads ? values.every((count) => count % 2 === 0) : values.length === 7 && values.every((count) => count === 2));
  if (!sevenPairs && !canWin(tiles, groups.length)) return null;
  const allCounts = new Map(counts);
  for (const group of groups) for (const tile of group.tiles) {
    const kind = tileKind(tile);
    allCounts.set(kind, (allCounts.get(kind) ?? 0) + 1);
  }
  const kinds = [...allCounts.keys()];
  const suits = new Set(kinds.filter((kind) => kind < 27).map((kind) => Math.floor(kind / 9)));
  const honors = kinds.some((kind) => kind >= 27);
  const allPongs = groups.every((group) => group.type !== 'chow')
    && values.filter((count) => count === 2).length === 1 && values.every((count) => count === 2 || count === 3);
  return { sevenPairs, allPongs, suits: suits.size, honors, roots: [...allCounts.values()].filter((count) => count === 4).length };
}

export function transfer(scores: number[], from: number, to: number, amount: number) {
  scores[from] -= amount;
  scores[to] += amount;
}
