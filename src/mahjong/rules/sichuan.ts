import type { Action, Suit, TableEvent, Win } from '../protocol/messages';
import type { Rules } from './contract';
import { analyse, transfer } from './hand-shape';
import { advanceWindow, checkWindow, createPlay, deal, finish, reject, seats, TURN_MS, type PlayState, type WinContext } from './regional';

const suits = [0, 1, 2] as const;
const suitOf = (tile: number) => Math.floor(tile / 36);
type Exchange = [number, number, number];
type KongPayment = { from: number; to: number; points: number };

export type SichuanState = PlayState & {
  opening: 'exchange' | 'choose-suit' | null;
  exchanges: (Exchange | null)[];
  missing: (Suit | null)[];
  wins: Win[];
  scores: number[];
  passed: (number | null)[];
  kongPayments: KongPayment[];
};

function grouped(hand: number[]) {
  return suits.map((suit) => hand.filter((tile) => suitOf(tile) === suit).sort((a, b) => a - b));
}

function defaultExchange(hand: number[]): Exchange {
  const [a, b, c] = grouped(hand).sort((a, b) => b.length - a.length)[0];
  return [a, b, c];
}

function defaultSuit(hand: number[]): Suit {
  const counts = grouped(hand);
  return [...suits].sort((a, b) => counts[a].length - counts[b].length)[0];
}

function evaluate(state: SichuanState, { seat, from, tile, rob }: WinContext, bonuses = true) {
  const hand = tile === undefined ? state.hands[seat] : [...state.hands[seat], tile];
  const missing = state.missing[seat];
  if (hand.some((id) => suitOf(id) === missing)) return null;
  const shape = analyse(hand, state.groups[seat], true);
  if (!shape) return null;
  let fan = 0;
  const patterns: string[] = [];
  const add = (name: string, value: number) => { patterns.push(name); fan += value; };
  if (shape.sevenPairs) add('七对', 2);
  else if (shape.allPongs) add('碰碰胡', 1);
  if (shape.suits === 1) add('清一色', 2);
  if (shape.roots) add(`根 ×${shape.roots}`, shape.roots);
  if (bonuses && rob) add('抢杠胡', 1);
  else if (bonuses && state.afterKong) add(from === null ? '杠上花' : '杠上炮', 1);
  if (!patterns.length) patterns.push('平胡');
  return { fan: Math.min(fan, 3), patterns };
}

function close(state: SichuanState, reason: 'three-winners' | 'wall-empty', events: TableEvent[]) {
  finish(state, { kind: 'blood', reason, wins: state.wins, scores: state.scores }, events);
}

function bestWait(state: SichuanState, seat: number) {
  const used = new Set([...state.hands[seat], ...state.groups[seat].flatMap((group) => group.tiles)]);
  let best = 0;
  for (let kind = 0; kind < 27; kind++) {
    const tile = [0, 1, 2, 3].map((copy) => kind * 4 + copy).find((id) => !used.has(id));
    if (tile === undefined) continue;
    const hand = evaluate(state, { seat, from: null, tile, rob: false }, false);
    if (hand) best = Math.max(best, 2 ** hand.fan);
  }
  return best;
}

function active(state: SichuanState, seat: number) { return !state.wins.some((win) => win.winner === seat); }

const play = createPlay<SichuanState>({
  chow: false,
  active,
  discards(state, seat) {
    const hand = state.hands[seat];
    const required = hand.filter((tile) => suitOf(tile) === state.missing[seat]);
    return required.length ? required : hand;
  },
  mayMeld: (state, seat, tile) => suitOf(tile) !== state.missing[seat],
  mayWin(state, win) {
    const score = evaluate(state, win);
    return score !== null && (win.from === null || score.fan > (state.passed[win.seat] ?? -1));
  },
  passed(state, win) {
    state.passed[win.seat] = evaluate(state, win)!.fan;
  },
  draw(state, seat) { state.passed[seat] = null; },
  kong(state, seat, from, kind) {
    const payers = from === null ? seats.filter((other) => other !== seat && active(state, other)) : [from];
    const points = kind === 'added-kong' ? 1 : 2;
    for (const payer of payers) {
      transfer(state.scores, payer, seat, points);
      state.kongPayments.push({ from: payer, to: seat, points });
    }
  },
  win(state, winners, from, tile, rob, events) {
    for (const winner of winners) {
      const { fan, patterns } = evaluate(state, { seat: winner, from, tile, rob })!;
      const payers = from === null ? seats.filter((other) => other !== winner && active(state, other)) : [from];
      for (const payer of payers) transfer(state.scores, payer, winner, 2 ** fan + (from === null ? 1 : 0));
      state.wins.push({ winner, from, fan, patterns });
      events.push({ type: 'win', seat: winner });
    }
    if (state.wins.length === 3) close(state, 'three-winners', events);
  },
  wallEmpty(state, events) {
    const remaining = seats.filter((seat) => active(state, seat));
    const pigs = remaining.filter((seat) => new Set(state.hands[seat].map(suitOf)
      .concat(state.groups[seat].flatMap((group) => group.tiles.map(suitOf)))).size === 3);
    const waits = remaining.map((seat) => ({ seat, points: pigs.includes(seat) ? 0 : bestWait(state, seat) }));
    for (const pig of pigs) for (const other of remaining) {
      if (!pigs.includes(other)) transfer(state.scores, pig, other, 8);
    }
    for (const payer of waits.filter(({ seat, points }) => !points && !pigs.includes(seat))) {
      for (const receiver of waits.filter(({ points }) => points > 0)) {
        transfer(state.scores, payer.seat, receiver.seat, receiver.points);
      }
    }
    for (const payment of state.kongPayments) {
      if (waits.some(({ seat, points }) => seat === payment.to && points === 0)) {
        transfer(state.scores, payment.to, payment.from, payment.points);
      }
    }
    close(state, 'wall-empty', events);
  },
});

function openingActions(state: SichuanState, seat: number): Action[] {
  return state.opening === 'choose-suit' && state.missing[seat] === null
    ? suits.map((suit) => ({ type: 'choose-suit', suit })) : [];
}

export const sichuan: Rules<SichuanState> = {
  id: 'sichuan', name: '四川麻将 · 血战到底', version: 1, seats: seats.length,
  start(random, now) {
    return { ...deal(random, now, 108), opening: 'exchange', exchanges: seats.map(() => null),
      missing: seats.map(() => null), wins: [], scores: seats.map(() => 0),
      passed: seats.map(() => null), kongPayments: [] };
  },
  deadline: (state) => state.deadline,
  apply(state, decision, now) {
    if (!state.opening) return play.apply(state, decision, now);
    const invalid = checkWindow(state, decision, now);
    if (invalid) return invalid;
    const next = structuredClone(state);
    if (next.opening === 'exchange') {
      if ('timeout' in decision) {
        next.exchanges = next.exchanges.map((tiles, seat) => tiles ?? defaultExchange(next.hands[seat]));
      } else {
        const { seat, action } = decision;
        if (action.type !== 'exchange' || next.exchanges[seat] || new Set(action.tiles).size !== 3
          || !action.tiles.every((id) => next.hands[seat].includes(id) && suitOf(id) === suitOf(action.tiles[0]))) {
          return reject('请选择三张同花色的手牌');
        }
        next.exchanges[seat] = action.tiles;
      }
      if (next.exchanges.every((tiles) => tiles !== null)) {
        const picks = next.exchanges;
        next.hands = next.hands.map((hand, seat) => hand.filter((tile) => !picks[seat]!.includes(tile))
          .concat(picks[(seat + 3) % seats.length]!));
        next.exchanges = seats.map(() => null);
        next.opening = 'choose-suit';
        advanceWindow(next, now, TURN_MS);
      }
    } else {
      if ('timeout' in decision) {
        next.missing = next.missing.map((suit, seat) => suit ?? defaultSuit(next.hands[seat]));
      } else {
        const { seat, action } = decision;
        if (action.type !== 'choose-suit' || next.missing[seat] !== null) return reject('当前不能定缺');
        next.missing[seat] = action.suit;
      }
      if (next.missing.every((suit) => suit !== null)) {
        next.opening = null;
        advanceWindow(next, now, TURN_MS);
      }
    }
    return { ok: true, state: next, events: [] };
  },
  viewFor(state, seat) {
    const view = play.viewFor(state, seat);
    if (state.opening) {
      view.phase = state.opening;
      view.actions = openingActions(state, seat);
      if (state.opening === 'exchange' && !state.exchanges[seat]) {
        view.exchange = { groups: grouped(state.hands[seat]).filter((tiles) => tiles.length >= 3) };
      }
    }
    view.scores = state.scores;
    view.players.forEach((player, owner) => {
      player.won = !active(state, owner);
      if (!state.opening || owner === seat) player.missingSuit = state.missing[owner] ?? undefined;
    });
    return view;
  },
};
