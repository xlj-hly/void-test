import type { Group } from '../protocol/messages';
import type { ShuffleInput } from './contract';

export type Meld = { type: Group['type']; tiles: number[] };

export function groupViews(groups: Meld[], ownSeat: boolean): Group[] {
  return groups.map((group) => group.type === 'concealed-kong' && !ownSeat
    ? { type: group.type, tiles: [null, null, null, null] } : group);
}

export const tileKind = (id: number) => Math.floor(id / 4);

export function shuffledWall(random: ShuffleInput, size = 136): number[] {
  const input = typeof random === 'function' ? random(size) : random;
  const wall = Array.from({ length: size }, (_, id) => id);
  let value = typeof input === 'number' ? input >>> 0 : 0;
  for (let index = wall.length - 1; index > 0; index--) {
    let bits: number;
    if (typeof input === 'number') {
      value = (value + 0x6d2b79f5) >>> 0;
      let mixed = Math.imul(value ^ (value >>> 15), value | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      bits = (mixed ^ (mixed >>> 14)) >>> 0;
    } else {
      bits = input[index];
    }
    const unit = bits / 0x100000000;
    const other = Math.floor(unit * (index + 1));
    [wall[index], wall[other]] = [wall[other], wall[index]];
  }
  return wall;
}

export function canWin(tiles: number[], groups: number): boolean {
  if (tiles.length !== (4 - groups) * 3 + 2) return false;
  const counts = Array<number>(34).fill(0);
  for (const id of tiles) counts[tileKind(id)]++;
  if (!groups && counts.filter((count) => count === 2).length === 7) return true;
  for (let kind = 0; kind < counts.length; kind++) {
    if (counts[kind] < 2) continue;
    counts[kind] -= 2;
    const valid = formsGroups(counts);
    counts[kind] += 2;
    if (valid) return true;
  }
  return false;
}

function formsGroups(counts: number[]): boolean {
  const first = counts.findIndex((count) => count > 0);
  if (first === -1) return true;
  if (counts[first] >= 3) {
    counts[first] -= 3;
    const valid = formsGroups(counts);
    counts[first] += 3;
    if (valid) return true;
  }
  if (first >= 27 || first % 9 >= 7 || !counts[first + 1] || !counts[first + 2]) return false;
  for (let offset = 0; offset < 3; offset++) counts[first + offset]--;
  const valid = formsGroups(counts);
  for (let offset = 0; offset < 3; offset++) counts[first + offset]++;
  return valid;
}
