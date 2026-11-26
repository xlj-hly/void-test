import type { Rules } from './contract';
import { analyse, transfer } from './hand-shape';
import { createPlay, deal, finish, seats, type PlayState, type WinContext } from './regional';

function evaluate(state: PlayState, { seat, from, tile, rob }: WinContext) {
  const hand = tile === undefined ? state.hands[seat] : [...state.hands[seat], tile];
  const shape = analyse(hand, state.groups[seat]);
  if (!shape) return null;
  let fan = 0;
  const patterns: string[] = [];
  const add = (name: string, value: number) => { patterns.push(name); fan += value; };
  if (shape.sevenPairs) add('七对', 2);
  else if (shape.allPongs) add('碰碰胡', 3);
  else if (state.groups[seat].every((group) => group.type === 'chow')) {
    // Check the winning decomposition, not just whether the exposed groups are sequences.
    if (isFlat(hand)) add('平胡', 1);
  }
  if (!shape.suits) add('字一色', 6);
  else if (shape.suits === 1) add(shape.honors ? '混一色' : '清一色', shape.honors ? 3 : 6);
  if (rob) add('抢杠胡', 1);
  else if (from === null && state.afterKong) add('杠上开花', 1);
  if (from === null) add('自摸', 1);
  if (!patterns.length) patterns.push('鸡胡');
  return { fan: Math.min(fan, 6), patterns };
}

function isFlat(tiles: number[]) {
  const counts = Array<number>(34).fill(0);
  for (const tile of tiles) counts[Math.floor(tile / 4)]++;
  for (let pair = 0; pair < counts.length; pair++) {
    if (counts[pair] < 2) continue;
    const remaining = [...counts];
    remaining[pair] -= 2;
    for (let kind = 0; kind < 27; kind++) {
      const count = remaining[kind];
      if (!count || kind % 9 > 6 || remaining[kind + 1] < count || remaining[kind + 2] < count) continue;
      remaining[kind] = 0;
      remaining[kind + 1] -= count;
      remaining[kind + 2] -= count;
    }
    if (remaining.every((count) => count === 0)) return true;
  }
  return false;
}

const play = createPlay<PlayState>({
  chow: true,
  active: () => true,
  discards: (state, seat) => state.hands[seat],
  mayMeld: () => true,
  mayWin: (state, win) => evaluate(state, win) !== null,
  win(state, [winner], from, tile, rob, events) {
    const { fan, patterns } = evaluate(state, { seat: winner, from, tile, rob })!;
    const scores = seats.map(() => 0);
    for (const payer of from === null ? seats.filter((seat) => seat !== winner) : [from]) {
      transfer(scores, payer, winner, 2 ** fan);
    }
    finish(state, { kind: 'win', winner, from, scores, fan, patterns }, events);
  },
  wallEmpty: (state, events) => finish(state, { kind: 'draw', scores: seats.map(() => 0) }, events),
});

export const guangdong: Rules<PlayState> = {
  id: 'guangdong', name: '广东麻将 · 鸡平胡（无花）', version: 1, seats: seats.length,
  start: (random, now) => deal(random, now, 136),
  deadline: (state) => state.deadline,
  ...play,
};
