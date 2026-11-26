import type { Action, Result, TableEvent } from '../protocol/messages';
import type { Rules, ShuffleInput } from './contract';
import { canWin, groupViews, shuffledWall, tileKind, type Meld } from './tiles';

export const TURN_MS = 30_000;
export const CLAIM_MS = 8_000;
const SEATS = 4;
type Claim = { seat: number; options: Action[]; reply?: Action };
export type BasicState = {
  wall: number[];
  hands: number[][];
  rivers: number[][];
  groups: Meld[][];
  turn: number;
  decisionId: number;
  deadline: number | null;
  // Older saved hands may omit this flag.
  drawn?: boolean;
  window: { from: number; tile: number; claims: Claim[] } | null;
  result: Result | null;
};

export function newHand(random: ShuffleInput, now: number): BasicState {
  const wall = shuffledWall(random);
  const seats = <T>(create: (seat: number) => T) => Array.from({ length: SEATS }, (_, seat) => create(seat));
  const hands = seats((seat) => wall.splice(0, seat === 0 ? 14 : 13));
  return { wall, hands, rivers: seats(() => []), groups: seats(() => []), turn: 0,
    decisionId: 1, deadline: now + TURN_MS, drawn: true, window: null, result: null };
}

function matching(hand: number[], kind: number): number[] {
  return hand.filter((id) => tileKind(id) === kind);
}

function choices(state: BasicState, seat: number): Action[] {
  if (state.result) return [];
  if (state.window) return state.window.claims.find((claim) => claim.seat === seat && !claim.reply)?.options ?? [];
  if (state.turn !== seat) return [];
  const hand = state.hands[seat];
  const actions: Action[] = hand.map((id) => ({ type: 'discard', tiles: [id] }));
  if (state.drawn === false) return actions;
  if (canWin(hand, state.groups[seat].length)) actions.push({ type: 'win' });
  if (state.wall.length) {
    for (const kind of new Set(hand.map(tileKind))) {
      const [a, b, c, d] = matching(hand, kind);
      if (d !== undefined) actions.push({ type: 'concealed-kong', tiles: [a, b, c, d] });
    }
  }
  return actions;
}

function claimOptions(state: BasicState, from: number, seat: number, tile: number): Action[] {
  const hand = state.hands[seat];
  const kind = tileKind(tile);
  const same = matching(hand, kind);
  const options: Action[] = [];
  if (canWin([...hand, tile], state.groups[seat].length)) options.push({ type: 'win' });
  if (same.length >= 2) options.push({ type: 'pong' });
  if (same.length >= 3 && state.wall.length) options.push({ type: 'kong' });
  if (seat === (from + 1) % SEATS && kind < 27) {
    const base = Math.floor(kind / 9) * 9;
    for (let start = Math.max(base, kind - 2); start <= Math.min(base + 6, kind); start++) {
      const [a, b] = [start, start + 1, start + 2].filter((part) => part !== kind);
      const first = matching(hand, a)[0];
      const second = matching(hand, b)[0];
      if (first !== undefined && second !== undefined) options.push({ type: 'chow', tiles: [first, second] });
    }
  }
  if (options.length) options.push({ type: 'pass' });
  return options;
}

function settle(state: BasicState, winner: number | null, from: number | null, events: TableEvent[]) {
  state.window = null;
  state.deadline = null;
  const scores = [0, 0, 0, 0];
  if (winner === null) {
    state.result = { kind: 'draw', scores };
    events.push({ type: 'settlement', seat: state.turn });
    return;
  }
  for (let seat = 0; seat < SEATS; seat++) {
    if (seat === winner || (from !== null && seat !== from)) continue;
    scores[seat]--;
    scores[winner]++;
  }
  state.result = { kind: 'win', winner, from, scores };
  events.push({ type: 'settlement', seat: winner });
}

function beginTurn(state: BasicState, seat: number, now: number, drawn: boolean) {
  state.turn = seat;
  state.drawn = drawn;
  state.window = null;
  state.deadline = now + TURN_MS;
  state.decisionId++;
}

function draw(state: BasicState, seat: number, now: number, events: TableEvent[], supplement = false) {
  const tile = supplement ? state.wall.pop() : state.wall.shift();
  if (tile === undefined) return settle(state, null, null, events);
  state.hands[seat].push(tile);
  beginTurn(state, seat, now, true);
  events.push({ type: 'draw', seat });
}

function discard(state: BasicState, seat: number, tile: number, now: number, events: TableEvent[]) {
  state.hands[seat] = state.hands[seat].filter((id) => id !== tile);
  state.rivers[seat].push(tile);
  events.push({ type: 'discard', seat, tile });
  const claims = [1, 2, 3].map((offset) => (seat + offset) % SEATS)
    .map((recipient) => ({ seat: recipient, options: claimOptions(state, seat, recipient, tile) }))
    .filter((claim) => claim.options.length);
  if (!claims.length) return draw(state, (seat + 1) % SEATS, now, events);
  state.window = { from: seat, tile, claims };
  state.decisionId++;
  state.deadline = now + CLAIM_MS;
}

function resolveClaims(state: BasicState, now: number, events: TableEvent[]) {
  const { claims, from, tile } = state.window!;
  const winning = claims.find((claim) => claim.reply?.type === 'win');
  if (winning) return settle(state, winning.seat, from, events);
  const selected = claims.find((claim) => claim.reply?.type === 'pong' || claim.reply?.type === 'kong')
    ?? claims.find((claim) => claim.reply?.type === 'chow');
  if (!selected) return draw(state, (from + 1) % SEATS, now, events);
  const { seat } = selected;
  const type = selected.reply!.type as 'pong' | 'kong' | 'chow';
  const hand = state.hands[seat];
  const used = selected.reply?.type === 'chow' ? selected.reply.tiles
    : matching(hand, tileKind(tile)).slice(0, type === 'pong' ? 2 : 3);
  state.hands[seat] = hand.filter((id) => !used.includes(id));
  state.rivers[from].pop();
  state.groups[seat].push({ type, tiles: [tile, ...used].sort((a, b) => a - b) });
  events.push({ type: 'claim', seat });
  if (type === 'kong') draw(state, seat, now, events, true);
  else beginTurn(state, seat, now, false);
}

function sameAction(option: Action, input: Action) {
  if (option.type !== input.type) return false;
  return !('tiles' in option) || ('tiles' in input && option.tiles.every((id, i) => id === input.tiles[i]));
}

export const basic: Rules<BasicState> = {
  id: 'basic', name: '基础麻将', version: 1, seats: SEATS, start: newHand,
  deadline: (state) => state.deadline,

  apply(state, decision, now) {
    if (state.deadline === null) return { ok: false, message: '本局已结束' };
    const events: TableEvent[] = [];
    if ('timeout' in decision) {
      if (now < state.deadline) return { ok: false, message: '尚未到期' };
      const next = structuredClone(state);
      if (next.window) resolveClaims(next, now, events);
      else discard(next, next.turn, next.hands[next.turn].at(-1)!, now, events);
      return { ok: true, state: next, events };
    }
    if (decision.decisionId !== state.decisionId || now >= state.deadline) {
      return { ok: false, message: '操作窗口已过期' };
    }
    const { seat, action } = decision;
    if (!choices(state, seat).some((option) => sameAction(option, action))) {
      return { ok: false, message: '当前不能执行这个操作' };
    }
    const next = structuredClone(state);
    if (next.window) {
      next.window.claims.find((claim) => claim.seat === seat)!.reply = action;
      if (next.window.claims.every((claim) => claim.reply)) resolveClaims(next, now, events);
    } else if (action.type === 'discard') {
      discard(next, seat, action.tiles[0], now, events);
    } else if (action.type === 'win') {
      settle(next, seat, null, events);
    } else if (action.type === 'concealed-kong') {
      next.hands[seat] = next.hands[seat].filter((id) => !action.tiles.includes(id));
      next.groups[seat].push({ type: action.type, tiles: [...action.tiles] });
      events.push({ type: 'claim', seat });
      draw(next, seat, now, events, true);
    }
    return { ok: true, state: next, events };
  },

  viewFor(state, seat) {
    return {
      phase: state.result ? 'ended' : state.window ? 'claim' : 'turn',
      turn: state.turn, wallRemaining: state.wall.length, deadline: state.deadline,
      decisionId: state.decisionId, actions: choices(state, seat), result: state.result,
      pending: state.window ? { from: state.window.from, tile: state.window.tile } : undefined,
      players: state.hands.map((hand, owner) => ({
        hand: owner === seat ? [...hand].sort((a, b) => a - b) : undefined,
        handCount: hand.length,
        river: state.rivers[owner],
        groups: groupViews(state.groups[owner], owner === seat),
      })),
    };
  },
};
