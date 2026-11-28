import { describe, expect, it } from 'vite-plus/test';
import type { Action } from '../src/mahjong/protocol/messages';
import { guangdong, scoreGuangdong, type GuangdongState } from '../src/mahjong/rules/guangdong';
import { deal } from '../src/mahjong/rules/regional';
import { rulesets } from '../src/mahjong/rules/registry';
import type { Meld } from '../src/mahjong/rules/tiles';

const rules = rulesets.getCurrent('guangdong')!;
const orderedShuffle = (size: number) => new Uint32Array(size).fill(0xffffffff);
const waitForFive = [0, 4, 8, 12, 20, 36, 40, 44, 48, 52, 56, 108, 109];
const copy = (tiles: number[], n: number) => tiles.map((tile) => tile + n);
const take = (tiles: [number]): Action => ({ type: 'discard', tiles });

function fixture(hands: number[][], wall = [132, 133]): GuangdongState {
  const initial = rules.start(orderedShuffle, 0) as GuangdongState;
  return { ...initial, hands, wall, discardCount: 4, uninterrupted: false };
}

function apply(state: GuangdongState, seat: number, action: Action, shuffle?: () => typeof orderedShuffle) {
  return rules.apply(state, { seat, action, decisionId: state.decisionId }, 1, shuffle);
}

function play(state: GuangdongState, seat: number, action: Action, shuffle?: () => typeof orderedShuffle) {
  const update = apply(state, seat, action, shuffle);
  if (!update.ok) throw new Error(update.message);
  return update.state as GuangdongState;
}

function timeout(state: GuangdongState) {
  const update = rules.apply(state, { timeout: true }, state.deadline!);
  if (!update.ok) throw new Error(update.message);
  return update.state as GuangdongState;
}

function available(state: GuangdongState, seat: number, type: Action['type']) {
  return rules.viewFor(state, seat).actions.some((action) => action.type === type);
}

describe('广东鸡平胡对局', () => {
  it('现有玩法 ID 直接使用完整规则，首庄随机', () => {
    expect(rules).toBe(rulesets.get('guangdong', 1));
    expect(rulesets.get('guangdong', 2)).toBeUndefined();
    const dealers = new Set(Array.from({ length: 30 }, (_, seed) => guangdong.start(seed, 0).turn));
    expect(dealers.size).toBe(4);
    const state = guangdong.start(7, 0);
    expect(state.hands.map((hand) => hand.length)).toEqual([0, 1, 2, 3].map((seat) => seat === state.turn ? 14 : 13));
    expect(new Set([...state.hands.flat(), ...state.wall]).size).toBe(136);
  });

  it('恢复旧存档时按当前规则开放十三幺，已提交的有效响应仍然保留', () => {
    const orphans = [0, 32, 36, 68, 72, 104, 108, 112, 116, 120, 124, 128, 132];
    const saved = deal(orderedShuffle, 0, 136);
    saved.hands = [[], orphans, [133, 134], []];
    saved.rivers = [[135], [], [], []];
    saved.window = {
      kind: 'discard', from: 0, tile: 135,
      claims: [{ seat: 2, actions: [{ type: 'pong' }, { type: 'pass' }], reply: { type: 'pong' } }],
    };
    expect(rules.viewFor(saved, 2).actions).toEqual([]);
    expect(rules.viewFor(saved, 1).actions).toEqual([{ type: 'win' }, { type: 'pass' }]);
    const won = rules.apply(saved, { seat: 1, action: { type: 'win' }, decisionId: saved.decisionId }, 1);
    expect(won).toMatchObject({ ok: true, state: { result: { kind: 'win', winner: 1, fan: 6, scores: [-64, 64, 0, 0] } } });
    expect(saved.window.claims).toHaveLength(1);
  });

  it('旧存档中已提交但不再有效的七对胡牌响应不会进入结算', () => {
    const saved = deal(orderedShuffle, 0, 136);
    saved.hands = [[], [1, 2, 4, 5, 12, 13, 24, 25, 36, 37, 112, 113, 132], [134, 135], []];
    saved.rivers = [[133], [], [], []];
    saved.wall = [86, 87];
    saved.window = { kind: 'discard', from: 0, tile: 133, claims: [
      { seat: 1, actions: [{ type: 'win' }, { type: 'pass' }], reply: { type: 'win' } },
      { seat: 2, actions: [{ type: 'pong' }, { type: 'pass' }] },
    ] };
    expect(rules.viewFor(saved, 1).actions).toEqual([]);
    const endedWindow = rules.apply(saved, { timeout: true }, saved.deadline!);
    expect(endedWindow).toMatchObject({ ok: true, state: {
      result: null, window: null, turn: 1, hands: [[], [...saved.hands[1], 86], [134, 135], []],
    } });
  });

  it('恢复已结算旧房时保留原结算并从累计分开始下一副', () => {
    const saved = deal(orderedShuffle, 0, 136);
    saved.result = { kind: 'win', winner: 1, from: 0, scores: [-2, 2, 0, 0] };
    saved.deadline = null;
    expect(rules.viewFor(saved, 0)).toMatchObject({ actions: [{ type: 'next-hand' }], result: saved.result, scores: [-2, 2, 0, 0] });
    const next = rules.apply(saved, { seat: 0, action: { type: 'next-hand' }, decisionId: saved.decisionId }, 1, () => orderedShuffle);
    expect(next).toMatchObject({ ok: true, state: { scores: [-2, 2, 0, 0], turn: 1, round: { dealer: 1, hand: 2, wind: 0 } } });
  });

  it('两响按座次同时结算，胡优先于碰，不等待牌墙摸牌', () => {
    let state = fixture([[19], waitForFive, copy(waitForFive, 2), [16, 17]]);
    state = play(state, 0, take([19]));
    state = play(state, 3, { type: 'pong' });
    state = play(state, 2, { type: 'win' });
    expect(state.result).toBeNull();
    state = play(state, 1, { type: 'win' });
    expect(state.result).toMatchObject({
      kind: 'multi-win', wins: [{ winner: 1, fan: 1 }, { winner: 2, fan: 1 }], scores: [-4, 2, 2, 0],
    });
    expect(state.wall).toEqual([132, 133]);
    expect(state.groups[3]).toEqual([]);
  });

  it('三响让不足三番的胡牌保底，保留超过三番的实际牌型', () => {
    const second = [...copy(waitForFive.slice(0, 11), 1), 112, 113];
    const third = [2, 6, 10, 14, 22, 24, 28, 32, 25, 29, 33, 34, 35];
    let state = play(fixture([[19], waitForFive, second, third]), 0, take([19]));
    for (const seat of [3, 2, 1]) state = play(state, seat, { type: 'win' });
    expect(state.result).toMatchObject({
      kind: 'multi-win', wins: [{ winner: 1, fan: 3 }, { winner: 2, fan: 3 }, { winner: 3, fan: 4 }],
      scores: [-32, 8, 8, 16],
    });
  });

  it('超时视作放过，同种牌受限，另一个听口仍可胡', () => {
    const twoEnded = [0, 4, 8, 12, 16, 36, 40, 44, 48, 52, 56, 108, 109];
    let state = play(fixture([[20], [21, 22, 8 + 1], twoEnded, []], [90, 91, 92]), 0, take([20]));
    state = timeout(state);
    expect(state.turn).toBe(1);
    expect(state.passed[2]).toEqual([5]);
    const otherWait = play(state, 1, take([9]));
    expect(available(otherWait, 2, 'win')).toBe(true);
    state = play(state, 1, take([21]));
    expect(available(state, 2, 'win')).toBe(false);
    expect(available(state, 2, 'chow')).toBe(true);
    state = play(state, 2, { type: 'pass' });
    expect(state.turn).toBe(2);
    expect(state.passed[2]).toEqual([]);
  });

  it('放胡后实际碰牌可解除漏胡，失去碰牌优先权时仍记录漏胡', () => {
    const hand = [16, 17, 36, 40, 44, 48, 52, 56, 60, 64, 68, 108, 109];
    const waiting = [...hand.slice(0, 11), 108, 110];
    const canBoth = [16, 17, 18, 12, 20, 36, 40, 44, 48, 52, 56, 108, 109];
    const offered = play(fixture([[19], [13, 21, 37, 41, 45, 49, 53, 57, 64, 68, 72, 112, 113],
      canBoth, []]), 0, take([19]));
    expect(available(offered, 2, 'win')).toBe(true);
    const claimed = timeout(play(offered, 2, { type: 'pong' }));
    expect(claimed.groups[2][0].type).toBe('pong');
    expect(claimed.passed[2]).toEqual([]);

    const another = play(fixture([[19], waitForFive, copy(waitForFive, 2), waiting]), 0, take([19]));
    const declined = play(another, 2, { type: 'pass' });
    const ended = timeout(play(declined, 1, { type: 'win' }));
    expect(ended.passed[2]).toEqual([4]);
  });

  it('多人抢补杠，取消杠及补牌，原碰保留，补杠者逐家包三份', () => {
    let state = fixture([[19], waitForFive, copy(waitForFive, 2), []], [133, 134]);
    state = { ...state, groups: [[{ type: 'pong', tiles: [16, 17, 18] }], [], [], []] };
    state = play(state, 0, { type: 'added-kong', tiles: [19] });
    expect(rules.viewFor(state, 1).pending).toEqual({ from: 0, tile: 19, kind: 'added-kong' });
    state = play(play(state, 2, { type: 'win' }), 1, { type: 'win' });
    expect(state.groups[0]).toEqual([{ type: 'pong', tiles: [16, 17, 18] }]);
    expect(state.rivers[0]).toEqual([19]);
    expect(state.wall).toEqual([133, 134]);
    expect(state.result).toMatchObject({
      kind: 'multi-win', wins: [{ winner: 1, fan: 3, patterns: expect.arrayContaining(['抢杠胡']) }, { winner: 2, fan: 3 }],
      scores: [-48, 24, 24, 0],
    });
  });

  it('直杠补牌胡由点杠者包三份，后续暗杠覆盖原杠来源', () => {
    const hand = [24, 25, 26, 36, 37, 38, 39, 40, 44, 60, 64, 68, 108];
    const window = play(fixture([[27], hand, [], []], [135, 48, 109]), 0, take([27]));
    const kong = play(window, 1, { type: 'kong' });
    expect(kong.hands[1]).toContain(109);
    expect(play(kong, 1, { type: 'win' }).result).toMatchObject({ fan: 3, scores: [-24, 24, 0, 0] });
    const chained = play(kong, 1, { type: 'concealed-kong', tiles: [36, 37, 38, 39] });
    expect(rules.viewFor(chained, 0).players[1].groups[1].tiles).toEqual([null, null, null, null]);
    expect(chained.wall).toEqual([135]);
    expect(play(chained, 1, { type: 'win' }).result).toMatchObject({ fan: 3, scores: [-8, 24, -8, -8] });
  });

  it('末张自摸有海底保底，末张打出只开放胡牌', () => {
    const state = fixture([[134], waitForFive, [20, 21], []], [19]);
    const last = play(state, 0, take([134]));
    const won = play(last, 1, { type: 'win' });
    expect(won.result).toMatchObject({ fan: 3, patterns: expect.arrayContaining(['海底捞月']) });

    const discard = play(fixture([[19], waitForFive, [16, 17], []], []), 0, take([19]));
    expect(available(discard, 2, 'pong')).toBe(false);
    const ended = play(discard, 1, { type: 'win' });
    expect(ended.result).toMatchObject({ fan: 1, scores: [-2, 2, 0, 0] });
    expect(timeout(discard).result).toEqual({ kind: 'draw', scores: [0, 0, 0, 0] });
  });

  it('区分天和、人和、地和，鸣牌取消地和', () => {
    const top = { ...guangdong.start(orderedShuffle, 0), hands: [[...waitForFive, 19], [], [], []] };
    expect(play(top, 0, { type: 'win' }).result).toMatchObject({ fan: 6, patterns: ['天和'] });

    const dealt = { ...top, hands: [[19], waitForFive, [], []] };
    expect(play(play(dealt, 0, take([19])), 1, { type: 'win' }).result)
      .toMatchObject({ fan: 6, patterns: ['人和'] });

    const natural = { ...dealt, hands: [[135], waitForFive, [], []], wall: [19, 134, 133] };
    const drawn = play(natural, 0, take([135]));
    expect(play(drawn, 1, { type: 'win' }).result).toMatchObject({ fan: 6, patterns: ['地和'] });
    const interruption = { ...dealt, hands: [[0], [4, 8, 12, 16, 20, 36, 40, 44, 48, 52, 56, 108, 112],
      copy(waitForFive, 2), []], wall: [18, 135] };
    const chow = play(play(interruption, 0, take([0])), 1, { type: 'chow', tiles: [4, 8] });
    const afterChow = play(chow, 1, take([112]));
    expect(play(afterChow, 2, { type: 'win' }).result)
      .toMatchObject({ fan: 2, patterns: expect.not.arrayContaining(['地和']) });
  });

  it('四组公开副露包自摸，供牌者只包先触发的一家', () => {
    const state = fixture([[28], [29, 30, 108, 112], [], []], [92, 93, 94, 109, 133]);
    state.groups[1] = [
      { type: 'chow', tiles: [0, 4, 8] }, { type: 'chow', tiles: [36, 40, 44] },
      { type: 'chow', tiles: [48, 52, 56] },
    ];
    const takeFourth = () => play(play(play(state, 0, take([28])), 1, { type: 'pong' }), 1, take([112]));
    const landed = takeFourth();
    expect(landed.twelvePayers[0]).toBe(1);
    const justDrew = play(play(play(landed, 2, take([92])), 3, take([93])), 0, take([94]));
    expect(justDrew.hands[1]).toEqual([108, 109]);
    expect(play(justDrew, 1, { type: 'win' }).result).toMatchObject({ fan: 1, scores: [-6, 6, 0, 0] });
    state.twelvePayers[0] = 2;
    expect(takeFourth().twelvePayers[0]).toBe(2);
  });

  it('四组公开后留下的单张与一组公开刻同种时，不能单吊第五张', () => {
    const state = fixture([[28], [29, 30, 31, 112], [], []], [92, 109]);
    state.groups[1] = [
      { type: 'chow', tiles: [0, 4, 8] }, { type: 'chow', tiles: [36, 40, 44] },
      { type: 'chow', tiles: [48, 52, 56] },
    ];
    const called = play(play(state, 0, take([28])), 1, { type: 'pong' });
    expect(play(called, 1, take([112])).twelvePayers[0]).toBeNull();
    expect(play(called, 1, take([31])).twelvePayers[0]).toBe(1);
  });

  it.each([
    { label: '大三元', previous: [124, 128], last: 132, field: 'dragonPayers' as const },
    { label: '大四喜', previous: [108, 112, 116], last: 120, field: 'windPayers' as const },
  ])('供出最后一组 $label 的玩家只包该牌型自摸', ({ label, previous, last, field }) => {
    const rest = previous.length === 2 ? [1, 5, 9, 36, 37] : [36, 37];
    const state = fixture([[last], [last + 1, last + 2, ...rest, 81], [], []]);
    state.groups[1] = previous.map((tile) => ({ type: 'pong', tiles: [tile, tile + 1, tile + 2] }));
    const called = play(play(state, 0, take([last])), 1, { type: 'pong' });
    expect(called[field][1]).toBe(0);
    const ready = { ...called, drawn: true, hands: [[], rest, [], []] };
    if (previous.length === 3) ready.twelvePayers[0] = 2;
    expect(play(ready, 1, { type: 'win' }).result).toMatchObject({
      fan: 6, patterns: expect.arrayContaining([label]), scores: [-192, 192, 0, 0],
    });
  });

  it('房主可开下一副，流局连庄并保留总分，延用递增的动作窗口 ID', () => {
    const state = fixture([[135], [], [], []], []);
    state.scores = [-12, 12, 0, 0];
    const ended = play(state, 0, take([135]));
    expect(available(ended, 0, 'next-hand')).toBe(true);
    expect(available(ended, 1, 'next-hand')).toBe(false);
    expect(apply(ended, 1, { type: 'next-hand' }, () => orderedShuffle).ok).toBe(false);
    const next = play(ended, 0, { type: 'next-hand' }, () => orderedShuffle);
    expect(next.round).toEqual(ended.round);
    expect(next.turn).toBe(ended.round.dealer);
    expect(next.decisionId).toBeGreaterThan(ended.decisionId);
    expect(next.scores).toEqual([-12, 12, 0, 0]);
    expect(next.passed).toEqual([[], [], [], []]);
    expect(rules.apply(next, { seat: 0, decisionId: ended.decisionId, action: take([next.hands[0][0]]) }, 1).ok).toBe(false);
  });

  it('闲家胜后推进庄家及圈风，北四结束，无下一副', () => {
    const state = fixture([[19], waitForFive, [], []]);
    state.round = { dealer: 0, hand: 4, wind: 0, complete: false };
    const settle = (current: GuangdongState) => play(play(current, 0, take([19])), 1, { type: 'win' });
    const won = settle(state);
    expect(won.scores).toEqual([-2, 2, 0, 0]);
    const next = play(won, 0, { type: 'next-hand' }, () => orderedShuffle);
    expect(next.round).toEqual({ dealer: 1, hand: 1, wind: 1, complete: false });
    expect(next.hands[1]).toHaveLength(14);
    expect(next.turn).toBe(1);
    const final = settle({ ...state, round: { ...state.round, wind: 3 } });
    expect(final.round.complete).toBe(true);
    expect(available(final, 0, 'next-hand')).toBe(false);
    expect(apply(final, 0, { type: 'next-hand' }, () => orderedShuffle).ok).toBe(false);
  });

  it('庄家包含在多响赢家中时连庄，北四也可继续', () => {
    const state = fixture([[19], waitForFive, copy(waitForFive, 2), []]);
    state.round = { dealer: 2, hand: 4, wind: 3, complete: false };
    const offered = play(state, 0, take([19]));
    const ended = play(play(offered, 1, { type: 'win' }), 2, { type: 'win' });
    expect(ended.result).toMatchObject({ kind: 'multi-win', wins: [{ winner: 1 }, { winner: 2 }] });
    const next = play(ended, 0, { type: 'next-hand' }, () => orderedShuffle);
    expect(next.round).toEqual(state.round);
    expect(next.turn).toBe(2);
  });
});

const flat = [0, 1, 2, 3, 4, 5, 9, 10, 11, 20, 21, 22, 15, 15];
const chicken = [0, 1, 2, 3, 4, 5, 9, 10, 11, 20, 20, 20, 15, 15];
const pungs = [0, 0, 0, 3, 3, 3, 10, 10, 10, 20, 20, 20, 15, 15];
const halfFlush = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 27, 27];
const flush = [...halfFlush.slice(0, -2), 6, 6];
const nineSidedWait = [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8];
const orphans = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

function physicalTiles() {
  const copies = new Map<number, number>();
  return (kind: number) => {
    const copy = copies.get(kind) ?? 0;
    if (copy === 4) throw new Error(`测试牌例有第五张牌 ${kind}`);
    copies.set(kind, copy + 1);
    return 4 * kind + copy;
  };
}

function score(kinds: number[], context: Partial<Parameters<typeof scoreGuangdong>[2]> = {}) {
  const hand = kinds.map(physicalTiles());
  return scoreGuangdong(hand, [], { winningTile: hand.at(-1), selfDraw: false, seatWind: 0, roundWind: 0, ...context });
}

describe('广东鸡平胡算番', () => {
  it.each([
    { kinds: chicken, fan: 0, pattern: '鸡胡' },
    { kinds: flat, fan: 1, pattern: '平胡' },
    { kinds: pungs, fan: 2, pattern: '碰碰胡' },
    { kinds: halfFlush, fan: 2, pattern: '混一色' },
  ])('$pattern 的基本番为 $fan', ({ kinds, fan, pattern }) => {
    expect(score(kinds)).toEqual({ fan, patterns: [pattern] });
  });

  it('普通番累加自摸、门风、圈风及每副三元刻，并按三番封顶', () => {
    const honors = [0, 1, 2, 9, 10, 11, 27, 27, 27, 31, 31, 31, 15, 15];
    expect(score(chicken, { selfDraw: true })).toEqual({ fan: 1, patterns: ['鸡胡', '自摸'] });
    expect(score(honors, { seatWind: 1, roundWind: 2 })).toEqual({ fan: 1, patterns: ['鸡胡', '红中刻'] });
    expect(score(honors, { seatWind: 1 })).toEqual({ fan: 2, patterns: ['鸡胡', '圈风', '红中刻'] });
    expect(score(honors, { roundWind: 1 })).toEqual({ fan: 2, patterns: ['鸡胡', '门风', '红中刻'] });
    expect(score(honors, { selfDraw: true })).toEqual({ fan: 3, patterns: ['鸡胡', '自摸', '门风', '圈风', '红中刻'] });
    const twoDragons = [0, 1, 2, 9, 10, 11, 32, 32, 32, 33, 33, 33, 15, 15];
    expect(score(twoDragons)).toEqual({ fan: 2, patterns: ['鸡胡', '发财刻', '白板刻'] });
  });

  it.each([
    { kinds: flush, fan: 4, pattern: '清一色' },
    { kinds: [0, 0, 0, 3, 3, 3, 5, 5, 5, 27, 27, 27, 6, 6], fan: 4, pattern: '混碰' },
    { kinds: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4], fan: 5, pattern: '清碰' },
    { kinds: [0, 0, 0, 8, 8, 8, 27, 27, 27, 30, 30, 30, 9, 9], fan: 5, pattern: '混幺九' },
    { kinds: [0, 1, 2, 9, 10, 11, 31, 31, 31, 32, 32, 32, 33, 33], fan: 5, pattern: '小三元' },
    { kinds: [0, 1, 2, 27, 27, 27, 28, 28, 28, 30, 30, 30, 29, 29], fan: 5, pattern: '小四喜' },
    { kinds: [27, 27, 27, 28, 28, 28, 30, 30, 30, 31, 31, 31, 32, 32], fan: 6, pattern: '字一色' },
    { kinds: [0, 0, 0, 8, 8, 8, 9, 9, 9, 17, 17, 17, 26, 26], fan: 6, pattern: '清幺九' },
    { kinds: [0, 1, 2, 31, 31, 31, 32, 32, 32, 33, 33, 33, 15, 15], fan: 6, pattern: '大三元' },
    { kinds: [...orphans, 0], fan: 6, pattern: '十三幺' },
  ])('$pattern 以 $fan 番独立计分', ({ kinds, fan, pattern }) => {
    expect(score(kinds, { selfDraw: true })).toEqual({ fan, patterns: [pattern] });
  });

  it('同番特殊牌保留触发包牌所需的番种，字一色不掩盖大四喜或大三元', () => {
    const winds = [27, 27, 27, 28, 28, 28, 29, 29, 29, 30, 30, 30, 31, 31];
    const dragons = [27, 27, 27, 31, 31, 31, 32, 32, 32, 33, 33, 33, 30, 30];
    expect(score(winds)).toEqual({ fan: 6, patterns: ['字一色', '大四喜'] });
    expect(score(dragons)).toEqual({ fan: 6, patterns: ['字一色', '大三元'] });
  });

  it('九莲只认胡牌前的九面听，同一副牌换一张实际胡牌张只算清一色', () => {
    for (let suit = 0; suit < 3; suit++) {
      for (let rank = 0; rank < 9; rank++) {
        const kinds = [...nineSidedWait, rank].map((kind) => kind + 9 * suit);
        expect(score(kinds)).toEqual({ fan: 6, patterns: ['九莲宝灯'] });
      }
    }
    const hand = [...nineSidedWait, 4].map(physicalTiles());
    expect(scoreGuangdong(hand, [], { winningTile: hand[0], selfDraw: true, seatWind: 0, roundWind: 0 }))
      .toEqual({ fan: 4, patterns: ['清一色'] });
    expect(scoreGuangdong(hand.slice(3), [{ type: 'pong', tiles: hand.slice(0, 3) }],
      { winningTile: hand.at(-1), selfDraw: false, seatWind: 0, roundWind: 0 })).toEqual({ fan: 4, patterns: ['清一色'] });
  });

  it('顺子、碰牌和明暗杠按面子参与拆解及算番', () => {
    const tile = physicalTiles();
    const hand = [15, 15].map(tile);
    const groups: Meld[] = [
      { type: 'chow', tiles: [9, 10, 11].map(tile) },
      { type: 'pong', tiles: [20, 20, 20].map(tile) },
      { type: 'concealed-kong', tiles: [27, 27, 27, 27].map(tile) },
      { type: 'added-kong', tiles: [31, 31, 31, 31].map(tile) },
    ];
    expect(scoreGuangdong(hand, groups, { selfDraw: false, seatWind: 0, roundWind: 1 }))
      .toEqual({ fan: 2, patterns: ['鸡胡', '门风', '红中刻'] });
  });

  it('同一副牌有多种结构时采用最高分', () => {
    // 11122233344455 可拆为顺子或四组刻子，后者为清碰。
    expect(score([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4])).toEqual({ fan: 5, patterns: ['清碰'] });
  });

  it.each(['天和', '地和', '人和'] as const)('%s 固定六番', (opening) => {
    expect(score(chicken, { opening, selfDraw: opening !== '人和' })).toEqual({ fan: 6, patterns: [opening] });
  });

  it.each([
    { context: { kongFlower: true, selfDraw: true }, label: '杠上开花' },
    { context: { rob: true }, label: '抢杠胡' },
    { context: { lastTile: true, selfDraw: true }, label: '海底捞月' },
    { context: { triple: true }, label: '一炮三响' },
  ])('$label 至少三番，保留更高的特殊牌型', ({ context, label }) => {
    expect(score(chicken, context)).toMatchObject({ fan: 3, patterns: expect.arrayContaining([label]) });
    expect(score(flush, context)).toEqual({ fan: 4, patterns: ['清一色', label] });
  });

  it('末张弃牌按普通点胡，不加海底番', () => {
    expect(score(chicken, { lastTile: true })).toEqual({ fan: 0, patterns: ['鸡胡'] });
  });

  it('无有效结构的七对、假十三幺和重复实体牌不成立，事件不能把无效牌变为胡牌', () => {
    expect(score([0, 0, 3, 3, 6, 6, 9, 9, 12, 12, 18, 18, 28, 28], { opening: '天和' })).toBeNull();
    expect(score([...orphans.slice(1), 8, 8])).toBeNull();
    expect(scoreGuangdong([0, 0, ...chicken.slice(2).map(physicalTiles())], [],
      { selfDraw: false, seatWind: 0, roundWind: 0 })).toBeNull();
  });
});
