import type { TableEvent, TableView, Win } from '../protocol/messages';
import type { Rules, ShuffleInput } from './contract';
import { transfer } from './hand-shape';
import { createPlay, deal, finish, reject, seats, type PlayState, type WinContext } from './regional';
import { tileKind, type Meld } from './tiles';

type Round = NonNullable<TableView['round']>;

export type GuangdongState = PlayState & {
  round: Round;
  scores: number[];
  passed: number[][];
  draws: number[];
  lastDraw: number | null;
  discardCount: number;
  uninterrupted: boolean;
  kongPayer: number | null;
  pendingTwelvePayer: number | null;
  twelvePayers: (number | null)[];
  dragonPayers: (number | null)[];
  windPayers: (number | null)[];
};

function firstRound(dealer: number): Round {
  return { dealer, wind: 0, hand: 1, complete: false };
}

function withHandState(state: PlayState, round: Round): GuangdongState {
  return {
    ...state,
    round,
    scores: state.result ? [...state.result.scores] : seats.map(() => 0),
    passed: seats.map(() => []),
    draws: seats.map(() => 0),
    lastDraw: null,
    discardCount: 0,
    uninterrupted: true,
    kongPayer: null,
    pendingTwelvePayer: null,
    twelvePayers: seats.map(() => null),
    dragonPayers: seats.map(() => null),
    windPayers: seats.map(() => null),
  };
}

function startHand(random: ShuffleInput, now: number, round?: Round): GuangdongState {
  const dealt = deal(random, now, 136);
  // Each face has four interchangeable physical copies, so the first copy gives an unbiased seat.
  const dealer = round?.dealer ?? dealt.hands[0][0] % seats.length;
  return withHandState({
    ...dealt,
    turn: dealer,
    hands: seats.map((seat) => dealt.hands[(seat - dealer + seats.length) % seats.length]),
  }, round ?? firstRound(dealer));
}

function score(state: GuangdongState, { seat, from, tile, rob }: WinContext, triple = false) {
  const selfDraw = from === null;
  const { dealer, wind } = state.round;
  const hand = tile === undefined ? state.hands[seat] : [...state.hands[seat], tile];
  let opening: '天和' | '地和' | '人和' | undefined;
  if (state.uninterrupted) {
    if (selfDraw && seat === dealer && state.discardCount === 0) opening = '天和';
    else if (selfDraw && seat !== dealer && state.draws[seat] === 1) opening = '地和';
    else if (!selfDraw && !rob && from === dealer && state.discardCount === 1) opening = '人和';
  }
  return scoreGuangdong(hand, state.groups[seat], {
    winningTile: tile ?? state.lastDraw ?? undefined,
    selfDraw, seatWind: (seat - dealer + seats.length) % seats.length, roundWind: wind, opening,
    rob, kongFlower: selfDraw && state.afterKong,
    lastTile: selfDraw && state.lastDraw !== null && state.wall.length === 0,
    triple,
  });
}

function selfDrawPayer(state: GuangdongState, win: Win): number | null {
  const { winner, patterns } = win;
  if (state.afterKong && state.kongPayer !== null) return state.kongPayer;
  if (patterns.includes('大三元') && state.dragonPayers[winner] !== null) return state.dragonPayers[winner];
  if (patterns.includes('大四喜') && state.windPayers[winner] !== null) return state.windPayers[winner];
  const landed = state.twelvePayers.indexOf(winner);
  return landed === -1 ? null : landed;
}

function settleWins(
  state: GuangdongState, winners: number[], from: number | null, tile: number | undefined, rob: boolean, events: TableEvent[],
) {
  const scores = seats.map(() => 0);
  const wins = winners.map((winner): Win => {
    const handScore = score(state, { seat: winner, from, tile, rob }, !rob && winners.length === 3)!;
    const win = { winner, from, ...handScore };
    const points = 2 ** win.fan;
    if (from !== null) {
      transfer(scores, from, winner, rob ? 3 * points : points);
    } else {
      const payer = selfDrawPayer(state, win);
      if (payer !== null) transfer(scores, payer, winner, 3 * points);
      else for (const other of seats) if (other !== winner) transfer(scores, other, winner, points);
    }
    events.push({ type: 'win', seat: winner });
    return win;
  });
  state.scores = state.scores.map((total, seat) => total + scores[seat]);
  const { dealer, wind, hand } = state.round;
  if (wind === 3 && hand === 4 && !winners.includes(dealer)) state.round.complete = true;
  finish(state, wins.length === 1 ? { kind: 'win', ...wins[0], scores } : { kind: 'multi-win', wins, scores }, events);
}

function recordTwelveDown(state: GuangdongState, seat: number, from: number) {
  const hand = state.hands[seat];
  if (hand.length !== 1) return;
  const wait = tileKind(hand[0]);
  const exposedCopies = state.groups[seat].flatMap((group) => group.tiles).filter((tile) => tileKind(tile) === wait).length;
  if (exposedCopies < 3) state.twelvePayers[from] ??= seat;
}

function recordMeld(state: GuangdongState, seat: number, from: number, tile: number) {
  state.uninterrupted = false;
  state.passed[seat] = [];
  const groups = state.groups[seat];
  if (groups.length === 4 && groups.every((group) => group.type !== 'concealed-kong')) {
    state.pendingTwelvePayer = from;
    recordTwelveDown(state, seat, from);
  }
  const kind = tileKind(tile);
  if (kind < 27) return;
  const openKinds = groups.filter((group) => group.type !== 'concealed-kong').map((group) => tileKind(group.tiles[0]));
  if (kind >= 31 && new Set(openKinds.filter((groupKind) => groupKind >= 31)).size === 3) {
    state.dragonPayers[seat] ??= from;
  } else if (kind < 31 && new Set(openKinds.filter((groupKind) => groupKind >= 27 && groupKind < 31)).size === 4) {
    state.windPayers[seat] ??= from;
  }
}

const play = createPlay<GuangdongState>({
  chow: true,
  active: () => true,
  discards: (state, seat) => state.hands[seat],
  mayMeld: () => true,
  mayClaimMeld: (state) => state.wall.length > 0,
  mayWin(state, win) {
    if (win.tile !== undefined && state.passed[win.seat].includes(tileKind(win.tile))) return false;
    return score(state, win) !== null;
  },
  passed(state, { seat, tile }) {
    if (tile !== undefined) state.passed[seat].push(tileKind(tile));
  },
  draw(state, seat, tile, supplement) {
    state.passed[seat] = [];
    state.lastDraw = tile;
    if (!supplement) state.draws[seat]++;
  },
  discard(state) {
    state.discardCount++;
    if (state.pendingTwelvePayer !== null) {
      recordTwelveDown(state, state.turn, state.pendingTwelvePayer);
      state.pendingTwelvePayer = null;
    }
  },
  meld: recordMeld,
  kong(state, seat, from) {
    state.uninterrupted = false;
    state.passed[seat] = [];
    state.kongPayer = from;
  },
  win: settleWins,
  wallEmpty: (state, events) => finish(state, { kind: 'draw', scores: seats.map(() => 0) }, events),
});

function nextRound(state: GuangdongState): Round {
  const result = state.result!;
  const { dealer, wind, hand } = state.round;
  if (result.kind === 'draw'
    || (result.kind === 'win' && result.winner === dealer)
    || (result.kind === 'multi-win' && result.wins.some((win) => win.winner === dealer))) return { ...state.round };
  return { dealer: (dealer + 1) % seats.length, wind: hand === 4 ? wind + 1 : wind, hand: hand === 4 ? 1 : hand + 1, complete: false };
}

function mayContinue(state: GuangdongState, seat: number) {
  return !!state.result && !state.round.complete && seat === 0;
}

function restoreHand(state: PlayState | GuangdongState): GuangdongState {
  if ('round' in state) return state;
  const restored = withHandState(state, firstRound(0));
  const groups = state.groups.flat();
  restored.discardCount = state.rivers.reduce((total, river) => total + river.length, 0)
    + groups.filter((group) => group.type !== 'concealed-kong').length;
  restored.uninterrupted = groups.length === 0;
  const drawn = 83 - state.wall.length;
  if (restored.uninterrupted) {
    restored.draws = seats.map((seat) => Math.floor((drawn + (seats.length - seat) % seats.length) / seats.length));
  }
  if (state.drawn && drawn > 0) restored.lastDraw = state.hands[state.turn].at(-1) ?? null;
  restored.window = play.refreshWindow(restored);
  return restored;
}

export const guangdong = {
  id: 'guangdong', name: '广东麻将 · 鸡平胡（无花）', version: 1, seats: seats.length,
  start: startHand,
  deadline: (state) => state.deadline,
  apply(saved, decision, now, shuffleInput?: () => ShuffleInput) {
    const state = restoreHand(saved);
    if (!('timeout' in decision) && decision.action.type === 'next-hand') {
      if (!mayContinue(state, decision.seat)) return reject('当前不能开始下一局');
      if (decision.decisionId !== state.decisionId) return reject('操作窗口已过期');
      if (!shuffleInput) return reject('无法洗牌');
      const next = startHand(shuffleInput(), now, nextRound(state));
      next.decisionId = state.decisionId + 1;
      next.scores = [...state.scores];
      return { ok: true, state: next, events: [] };
    }
    return play.apply(state, decision, now);
  },
  viewFor(saved, seat) {
    const state = restoreHand(saved);
    const view = play.viewFor(state, seat);
    if (mayContinue(state, seat)) view.actions = [{ type: 'next-hand' }];
    return { ...view, round: state.round, scores: state.scores };
  },
} satisfies Rules<PlayState>;

type ScoreContext = {
  winningTile?: number;
  selfDraw: boolean;
  seatWind: number;
  roundWind: number;
  opening?: '天和' | '地和' | '人和';
  kongFlower?: boolean;
  rob?: boolean;
  lastTile?: boolean;
  triple?: boolean;
};

type Score = { fan: number; patterns: string[] };

const orphans = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
const nineGatesWait = [3, 1, 1, 1, 1, 1, 1, 1, 3];
const dragons = ['红中刻', '发财刻', '白板刻'];

function startsChow(kind: number) {
  return kind < 27 && kind % 9 < 7;
}

function meldPungs(groups: Meld[]) {
  const pungs: number[] = [];
  for (const group of groups) {
    const kinds = group.tiles.map(tileKind).sort((a, b) => a - b);
    const first = kinds[0];
    if (group.type === 'chow') {
      if (kinds.length !== 3 || !startsChow(first) || kinds[1] !== first + 1 || kinds[2] !== first + 2) return null;
    } else {
      if (kinds.length !== (group.type === 'pong' ? 3 : 4) || kinds.some((kind) => kind !== first)) return null;
      pungs.push(first);
    }
  }
  return pungs;
}

function* closedPungs(counts: number[], pungs: number[]): Generator<number[]> {
  const first = counts.findIndex((count) => count > 0);
  if (first === -1) {
    yield [...pungs];
    return;
  }
  if (counts[first] >= 3) {
    counts[first] -= 3;
    pungs.push(first);
    yield* closedPungs(counts, pungs);
    pungs.pop();
    counts[first] += 3;
  }
  if (startsChow(first) && counts[first + 1] > 0 && counts[first + 2] > 0) {
    for (let offset = 0; offset < 3; offset++) counts[first + offset]--;
    yield* closedPungs(counts, pungs);
    for (let offset = 0; offset < 3; offset++) counts[first + offset]++;
  }
}

function* decompositions(counts: number[], pungs: number[]) {
  for (let pair = 0; pair < counts.length; pair++) {
    if (counts[pair] < 2) continue;
    counts[pair] -= 2;
    for (const sets of closedPungs(counts, pungs)) yield { pair, pungs: sets };
    counts[pair] += 2;
  }
}

function ordinaryScore(pungs: number[], halfFlush: boolean, context: ScoreContext): Score {
  const base = halfFlush ? { fan: 2, patterns: ['混一色'] }
    : pungs.length === 4 ? { fan: 2, patterns: ['碰碰胡'] }
    : pungs.length === 0 ? { fan: 1, patterns: ['平胡'] }
    : { fan: 0, patterns: ['鸡胡'] };
  const bonuses: string[] = [];
  if (context.selfDraw) bonuses.push('自摸');
  if (pungs.includes(27 + context.seatWind)) bonuses.push('门风');
  if (pungs.includes(27 + context.roundWind)) bonuses.push('圈风');
  for (const kind of pungs) if (kind >= 31) bonuses.push(dragons[kind - 31]);
  return { fan: base.fan + bonuses.length, patterns: [...base.patterns, ...bonuses] };
}

export function scoreGuangdong(hand: number[], groups: Meld[], context: ScoreContext): Score | null {
  if (groups.length > 4 || hand.length !== 14 - 3 * groups.length) return null;
  const physical = [...hand, ...groups.flatMap((group) => group.tiles)];
  if (new Set(physical).size !== physical.length || physical.some((tile) => !Number.isInteger(tile) || tile < 0 || tile >= 136)) return null;
  if (context.winningTile !== undefined && !hand.includes(context.winningTile)) return null;
  const declaredPungs = meldPungs(groups);
  if (!declaredPungs) return null;

  const kinds = [...new Set(physical.map(tileKind))];
  const honors = kinds.some((kind) => kind >= 27);
  const suits = new Set(kinds.filter((kind) => kind < 27).map((kind) => Math.floor(kind / 9)));
  const pureFlush = suits.size === 1 && !honors;
  const halfFlush = suits.size === 1 && honors;
  const onlyTerminalsAndHonors = kinds.every((kind) => orphans.includes(kind));
  const counts = Array<number>(34).fill(0);
  for (const tile of hand) counts[tileKind(tile)]++;

  const specials = new Map<string, number>();
  if (!groups.length && onlyTerminalsAndHonors && kinds.length === orphans.length) specials.set('十三幺', 6);
  if (!groups.length && pureFlush && context.winningTile !== undefined) {
    const win = tileKind(context.winningTile);
    const suitStart = win - win % 9;
    if (nineGatesWait.every((count, index) => counts[suitStart + index] === count + Number(suitStart + index === win))) {
      specials.set('九莲宝灯', 6);
    }
  }

  let ordinary: Score | null = null;
  for (const { pair, pungs } of decompositions(counts, declaredPungs)) {
    const current = ordinaryScore(pungs, halfFlush, context);
    if (!ordinary || current.fan > ordinary.fan) ordinary = current;
    if (pureFlush) specials.set(pungs.length === 4 ? '清碰' : '清一色', pungs.length === 4 ? 5 : 4);
    if (halfFlush && pungs.length === 4) specials.set('混碰', 4);
    if (suits.size === 0) specials.set('字一色', 6);
    else if (onlyTerminalsAndHonors) specials.set(honors ? '混幺九' : '清幺九', honors ? 5 : 6);
    const dragonPungs = pungs.filter((kind) => kind >= 31).length;
    if (dragonPungs === 3) specials.set('大三元', 6);
    else if (dragonPungs === 2 && pair >= 31) specials.set('小三元', 5);
    const windPungs = pungs.filter((kind) => kind >= 27 && kind < 31).length;
    if (windPungs === 4) specials.set('大四喜', 6);
    else if (windPungs === 3 && pair >= 27 && pair < 31) specials.set('小四喜', 5);
  }
  if (!ordinary && !specials.size) return null;
  if (context.opening) specials.set(context.opening, 6);

  let score: Score;
  if (specials.size) {
    const fan = Math.max(...specials.values());
    score = { fan, patterns: [...specials].filter(([, value]) => value === fan).map(([name]) => name) };
  } else {
    score = { fan: Math.min(3, ordinary!.fan), patterns: ordinary!.patterns };
  }
  const floors = [
    context.kongFlower && context.selfDraw ? '杠上开花' : '',
    context.rob ? '抢杠胡' : '',
    context.lastTile && context.selfDraw ? '海底捞月' : '',
    context.triple ? '一炮三响' : '',
  ].filter(Boolean);
  return floors.length ? { fan: Math.max(3, score.fan), patterns: [...score.patterns, ...floors] } : score;
}
