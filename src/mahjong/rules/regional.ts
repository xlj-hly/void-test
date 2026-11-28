import type { Action, Result, TableEvent, TableView } from '../protocol/messages';
import type { Decision, RuleUpdate, ShuffleInput } from './contract';
import { groupViews, shuffledWall, tileKind, type Meld } from './tiles';

export const seats = [0, 1, 2, 3];
export const TURN_MS = 30_000;
const CLAIM_MS = 8_000;
type Claim = { seat: number; actions: Action[]; reply?: Action };
type Window = { kind: 'discard' | 'added-kong'; from: number; tile: number; claims: Claim[] };
type Kong = 'kong' | 'concealed-kong' | 'added-kong';

export type PlayState = {
  wall: number[];
  hands: number[][];
  rivers: number[][];
  groups: Meld[][];
  turn: number;
  decisionId: number;
  deadline: number | null;
  window: Window | null;
  result: Result | null;
  drawn: boolean;
  afterKong: boolean;
};

export type WinContext = { seat: number; from: number | null; tile?: number; rob: boolean };
export type PlayPolicy<S extends PlayState> = {
  chow: boolean;
  active(state: S, seat: number): boolean;
  discards(state: S, seat: number): number[];
  mayMeld(state: S, seat: number, tile: number): boolean;
  mayWin(state: S, win: WinContext): boolean;
  win(state: S, winners: number[], from: number | null, tile: number | undefined, rob: boolean, events: TableEvent[]): void;
  wallEmpty(state: S, events: TableEvent[]): void;
  kong?(state: S, seat: number, from: number | null, kind: Kong): void;
  passed?(state: S, win: WinContext): void;
  draw?(state: S, seat: number, tile: number, supplement: boolean): void;
  discard?(state: S): void;
  meld?(state: S, seat: number, from: number, tile: number): void;
  mayClaimMeld?(state: S): boolean;
};

export function deal(random: ShuffleInput, now: number, count: number): PlayState {
  const wall = shuffledWall(random, count);
  return {
    hands: seats.map((seat) => wall.splice(0, seat === 0 ? 14 : 13)),
    wall, rivers: seats.map(() => []), groups: seats.map(() => []),
    turn: 0, decisionId: 1, deadline: now + TURN_MS, window: null, result: null,
    drawn: true, afterKong: false,
  };
}

export function advanceWindow(state: PlayState, now: number, duration: number) {
  state.decisionId++;
  state.deadline = now + duration;
}

export function finish(state: PlayState, result: Result, events: TableEvent[]) {
  state.result = result;
  state.deadline = null;
  events.push({ type: 'settlement', seat: result.kind === 'win' ? result.winner : state.turn });
}

export function reject(message: string): { ok: false; message: string } { return { ok: false, message }; }

export function checkWindow(state: PlayState, decision: Decision, now: number) {
  if (state.deadline === null) return reject('本局已结束');
  if ('timeout' in decision) return now < state.deadline ? reject('尚未到期') : undefined;
  if (decision.decisionId !== state.decisionId || now >= state.deadline) return reject('操作窗口已过期');
}

function matching(hand: number[], tile: number) {
  return hand.filter((id) => tileKind(id) === tileKind(tile));
}

function chowOptions(hand: number[], tile: number): Action[] {
  const kind = tileKind(tile);
  const base = kind - kind % 9;
  const actions: Action[] = [];
  for (let start = Math.max(base, kind - 2); start <= Math.min(base + 6, kind); start++) {
    const [a, b] = [start, start + 1, start + 2].filter((part) => part !== kind);
    const first = hand.find((id) => tileKind(id) === a);
    const second = hand.find((id) => tileKind(id) === b);
    if (first !== undefined && second !== undefined) actions.push({ type: 'chow', tiles: [first, second] });
  }
  return actions;
}

function pongIndex(groups: Meld[], tile: number) {
  return groups.findIndex((group) => group.type === 'pong' && tileKind(group.tiles[0]) === tileKind(tile));
}

function removeTiles(hand: number[], tiles: number[]) {
  return hand.filter((id) => !tiles.includes(id));
}

function matches(option: Action, action: Action) {
  return option.type === action.type && (!('tiles' in option)
    || ('tiles' in action && option.tiles.every((id) => action.tiles.includes(id))));
}

export function createPlay<S extends PlayState>(policy: PlayPolicy<S>) {
  function ordered(state: S, from: number) {
    return [1, 2, 3].map((offset) => (from + offset) % seats.length).filter((seat) => policy.active(state, seat));
  }

  function actions(state: S, seat: number): Action[] {
    if (state.result || !policy.active(state, seat)) return [];
    if (state.window) return state.window.claims.find((claim) => claim.seat === seat && !claim.reply)?.actions ?? [];
    if (state.turn !== seat) return [];
    const hand = state.hands[seat];
    const options: Action[] = policy.discards(state, seat).map((tile) => ({ type: 'discard', tiles: [tile] }));
    if (state.drawn && policy.mayWin(state, { seat, from: null, rob: false })) options.push({ type: 'win' });
    if (!state.wall.length || !state.drawn) return options;
    const seen = new Set<number>();
    for (const tile of hand) {
      const kind = tileKind(tile);
      if (seen.has(kind) || !policy.mayMeld(state, seat, tile)) continue;
      seen.add(kind);
      const [a, b, c, d] = matching(hand, tile);
      if (d !== undefined) options.push({ type: 'concealed-kong', tiles: [a, b, c, d] });
      if (pongIndex(state.groups[seat], tile) >= 0) options.push({ type: 'added-kong', tiles: [tile] });
    }
    return options;
  }

  function turn(state: S, seat: number, now: number, drawn: boolean, afterKong = false) {
    state.turn = seat;
    state.drawn = drawn;
    state.afterKong = afterKong;
    advanceWindow(state, now, TURN_MS);
  }

  function draw(state: S, seat: number, now: number, events: TableEvent[], supplement = false) {
    const tile = supplement ? state.wall.pop() : state.wall.shift();
    if (tile === undefined) return policy.wallEmpty(state, events);
    state.hands[seat].push(tile);
    policy.draw?.(state, seat, tile, supplement);
    turn(state, seat, now, true, supplement);
    events.push({ type: 'draw', seat });
  }

  function drawNext(state: S, from: number, now: number, events: TableEvent[]) {
    const next = ordered(state, from)[0];
    draw(state, next, now, events);
  }

  function claimsFor(state: S, from: number, tile: number, kind: Window['kind']) {
    const rob = kind === 'added-kong';
    return ordered(state, from).flatMap((seat): Claim[] => {
      const options: Action[] = [];
      if (policy.mayWin(state, { seat, from, tile, rob })) options.push({ type: 'win' });
      if (!rob && (policy.mayClaimMeld?.(state) ?? true) && policy.mayMeld(state, seat, tile)) {
        const hand = state.hands[seat];
        const copies = matching(hand, tile).length;
        if (copies >= 2) options.push({ type: 'pong' });
        if (copies >= 3 && state.wall.length) options.push({ type: 'kong' });
        if (policy.chow && seat === (from + 1) % seats.length && tileKind(tile) < 27) options.push(...chowOptions(hand, tile));
      }
      return options.length ? [{ seat, actions: [...options, { type: 'pass' }] }] : [];
    });
  }

  function refreshWindow(state: S): Window | null {
    const window = state.window;
    if (!window) return null;
    const claims = claimsFor(state, window.from, window.tile, window.kind);
    for (const claim of claims) {
      const previous = window.claims.find(({ seat }) => seat === claim.seat);
      const reply = previous?.reply;
      const newWin = claim.actions.some(({ type }) => type === 'win')
        && !previous?.actions.some(({ type }) => type === 'win');
      if (reply && !newWin && claim.actions.some((action) => matches(action, reply))) claim.reply = reply;
    }
    return { ...window, claims };
  }

  function respond(state: S, from: number, tile: number, kind: Window['kind'], now: number) {
    const claims = claimsFor(state, from, tile, kind);
    if (claims.length) {
      state.window = { kind, from, tile, claims };
      advanceWindow(state, now, CLAIM_MS);
    }
    return claims.length > 0;
  }

  function addedKong(state: S, seat: number, tile: number, now: number, events: TableEvent[]) {
    const index = pongIndex(state.groups[seat], tile);
    state.groups[seat][index] = { type: 'added-kong', tiles: [...state.groups[seat][index].tiles, tile] };
    completeKong(state, seat, null, 'added-kong', now, events);
  }

  function completeKong(state: S, seat: number, from: number | null, kind: Kong, now: number, events: TableEvent[]) {
    policy.kong?.(state, seat, from, kind);
    events.push({ type: 'claim', seat });
    draw(state, seat, now, events, true);
  }

  function settleWindow(state: S, now: number, events: TableEvent[]) {
    const { claims, from, tile, kind } = state.window!;
    state.window = null;
    const rob = kind === 'added-kong';
    for (const claim of claims) {
      if (claim.reply?.type !== 'win' && claim.actions.some((action) => action.type === 'win')) {
        policy.passed?.(state, { seat: claim.seat, from, tile, rob });
      }
    }
    const wins = claims.filter((claim) => claim.reply?.type === 'win').map((claim) => claim.seat);
    if (wins.length) {
      if (rob) state.rivers[from].push(tile);
      policy.win(state, wins, from, tile, rob, events);
      if (!state.result) drawNext(state, from, now, events);
      return;
    }
    if (rob) return addedKong(state, from, tile, now, events);
    const claim = claims.find(({ reply }) => reply?.type === 'kong' || reply?.type === 'pong')
      ?? claims.find(({ reply }) => reply?.type === 'chow');
    if (!claim) return drawNext(state, from, now, events);
    const { seat } = claim;
    const action = claim.reply as Extract<Action, { type: 'kong' | 'pong' | 'chow' }>;
    const used = action.type === 'chow' ? action.tiles : matching(state.hands[seat], tile).slice(0, action.type === 'kong' ? 3 : 2);
    state.rivers[from].pop();
    state.hands[seat] = removeTiles(state.hands[seat], used);
    state.groups[seat].push({ type: action.type, tiles: [tile, ...used].sort((a, b) => a - b) });
    policy.meld?.(state, seat, from, tile);
    if (action.type === 'kong') return completeKong(state, seat, from, action.type, now, events);
    events.push({ type: 'claim', seat });
    turn(state, seat, now, false);
  }

  function discard(state: S, seat: number, tile: number, now: number, events: TableEvent[]) {
    state.hands[seat] = removeTiles(state.hands[seat], [tile]);
    state.rivers[seat].push(tile);
    policy.discard?.(state);
    events.push({ type: 'discard', seat, tile });
    if (!respond(state, seat, tile, 'discard', now)) drawNext(state, seat, now, events);
  }

  function apply(state: S, decision: Decision, now: number): RuleUpdate<S> {
    const invalid = checkWindow(state, decision, now);
    if (invalid) return invalid;
    const next = structuredClone(state);
    const events: TableEvent[] = [];
    if ('timeout' in decision) {
      if (next.window) settleWindow(next, now, events);
      else discard(next, next.turn, policy.discards(next, next.turn).at(-1)!, now, events);
    } else {
      const { seat, action } = decision;
      if (!actions(state, seat).some((option) => matches(option, action))) return reject('当前不能执行这个操作');
      if (next.window) {
        next.window.claims.find((claim) => claim.seat === seat)!.reply = action;
        if (next.window.claims.every((claim) => claim.reply)) settleWindow(next, now, events);
      } else if (action.type === 'discard') {
        discard(next, seat, action.tiles[0], now, events);
      } else if (action.type === 'win') {
        policy.win(next, [seat], null, undefined, false, events);
        if (!next.result) drawNext(next, seat, now, events);
      } else if (action.type === 'concealed-kong') {
        next.hands[seat] = removeTiles(next.hands[seat], action.tiles);
        next.groups[seat].push({ type: action.type, tiles: action.tiles });
        completeKong(next, seat, null, action.type, now, events);
      } else if (action.type === 'added-kong') {
        const [tile] = action.tiles;
        next.hands[seat] = removeTiles(next.hands[seat], [tile]);
        if (!respond(next, seat, tile, action.type, now)) addedKong(next, seat, tile, now, events);
      }
    }
    return { ok: true, state: next, events };
  }

  function viewFor(state: S, seat: number): TableView {
    const window = state.window;
    return {
      phase: state.result ? 'ended' : window ? 'claim' : 'turn',
      turn: state.turn, decisionId: state.decisionId, deadline: state.deadline, wallRemaining: state.wall.length,
      actions: actions(state, seat), result: state.result,
      pending: window ? { from: window.from, tile: window.tile, ...(window.kind === 'added-kong' ? { kind: window.kind } : {}) } : undefined,
      players: seats.map((owner) => ({
        hand: owner === seat ? [...state.hands[owner]].sort((a, b) => a - b) : undefined,
        handCount: state.hands[owner].length, river: state.rivers[owner],
        groups: groupViews(state.groups[owner], owner === seat),
      })),
    };
  }

  return { apply, viewFor, refreshWindow };
}
