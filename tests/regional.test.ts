import { describe, expect, it } from 'vite-plus/test';
import type { Action } from '../src/mahjong/protocol/messages';
import type { Rules } from '../src/mahjong/rules/contract';
import { guangdong } from '../src/mahjong/rules/guangdong';
import { sichuan } from '../src/mahjong/rules/sichuan';

function play<S>(rules: Rules<S>, state: S, seat: number, action: Action, now = 1) {
  const update = rules.apply(state, { seat, action, decisionId: rules.viewFor(state, seat).decisionId }, now);
  if (!update.ok) throw new Error(update.message);
  return update.state;
}

function timeout<S>(rules: Rules<S>, state: S) {
  const update = rules.apply(state, { timeout: true }, rules.deadline(state)!);
  if (!update.ok) throw new Error(update.message);
  return update.state;
}

const waitForFive = [0, 4, 8, 20, 24, 28, 36, 40, 44, 48, 52, 56, 16];

describe('四川血战到底', () => {
  it('108 张全是数牌，换三张限同门且提交期间不公开选牌', () => {
    const state = sichuan.start(17, 0);
    expect(state.wall.length + state.hands.flat().length).toBe(108);
    expect(new Set([...state.wall, ...state.hands.flat()]).size).toBe(108);
    expect(sichuan.viewFor(state, 0).phase).toBe('exchange');
    const tiles = sichuan.viewFor(state, 0).exchange!.groups[0].slice(0, 3) as [number, number, number];
    expect(sichuan.apply(state, { seat: 0, decisionId: state.decisionId, action: { type: 'exchange', tiles: [tiles[0], tiles[0], tiles[1]] } }, 1).ok).toBe(false);
    const chosen = play(sichuan, state, 0, { type: 'exchange', tiles });
    expect(sichuan.viewFor(chosen, 0).exchange).toBeUndefined();
    expect(sichuan.viewFor(chosen, 1).players[0].hand).toBeUndefined();
    expect(chosen.hands).toEqual(state.hands);
    const selecting = timeout(sichuan, chosen);
    expect(sichuan.viewFor(selecting, 1).phase).toBe('choose-suit');
    expect(selecting.hands[1]).toEqual(expect.arrayContaining(tiles));
    expect(selecting.hands[0]).not.toEqual(expect.arrayContaining(tiles));
    const playing = timeout(sichuan, selecting);
    expect(sichuan.viewFor(playing, 0).phase).toBe('turn');
    expect(playing.missing.every((suit) => suit !== null)).toBe(true);
  });

  it('定缺提交保密，开打后优先打缺门且不允许吃', () => {
    const selecting = timeout(sichuan, sichuan.start(19, 0));
    const choose = (seat: number) => ({ type: 'choose-suit' as const, suit: seat % 3 as 0 | 1 | 2 });
    let state = play(sichuan, selecting, 0, choose(0), selecting.deadline! - 1);
    expect(sichuan.viewFor(state, 1).players[0].missingSuit).toBeUndefined();
    for (const seat of [1, 2, 3]) state = play(sichuan, state, seat, choose(seat), selecting.deadline! - 1);
    expect(sichuan.viewFor(state, 1).players[0].missingSuit).toBe(0);
    state.hands = [[8, 40], [0, 4], [100], [104]];
    expect(sichuan.viewFor(state, 0).actions).toEqual([{ type: 'discard', tiles: [8] }]);
    const after = play(sichuan, state, 0, { type: 'discard', tiles: [8] }, state.deadline! - 1);
    expect(sichuan.viewFor(after, 1).actions.some((a) => a.type === 'chow')).toBe(false);
  });

  it('一炮多响后跳过已胡座位，第三家胡后结束，账目守恒', () => {
    const state = timeout(sichuan, timeout(sichuan, sichuan.start(10, 0)));
    state.missing = [2, 2, 2, 2];
    state.hands = [[19, 32], waitForFive, waitForFive.map((id) => id + 1), [101]];
    state.wall = [105];
    const window = play(sichuan, state, 0, { type: 'discard', tiles: [19] });
    const waiting = play(sichuan, window, 2, { type: 'win' });
    const continued = play(sichuan, waiting, 1, { type: 'win' });
    expect(continued.wins.map((win) => win.winner)).toEqual([1, 2]);
    expect(continued.turn).toBe(3);
    expect(sichuan.viewFor(continued, 1).actions).toEqual([]);
    continued.hands[3] = [...waitForFive, 18];
    const ended = play(sichuan, continued, 3, { type: 'win' });
    const result = sichuan.viewFor(ended, 0).result;
    expect(result).toMatchObject({ kind: 'blood', reason: 'three-winners', wins: [{ winner: 1 }, { winner: 2 }, { winner: 3 }] });
    expect(result!.scores.reduce((sum, n) => sum + n, 0)).toBe(0);
    expect(sichuan.deadline(ended)).toBeNull();
  });

  it('流局时查花猪、查大叫并退未听牌者的杠分', () => {
    const state = timeout(sichuan, timeout(sichuan, sichuan.start(3, 0)));
    state.missing = [2, 2, 2, 2];
    state.hands = [[77], waitForFive, [12, 60, 92], [69, 84]];
    state.wall = [];
    state.scores = [0, 0, 2, -2];
    state.kongPayments = [{ from: 3, to: 2, points: 2 }];
    const ended = play(sichuan, state, 0, { type: 'discard', tiles: [77] });
    expect(ended.result).toEqual({ kind: 'blood', reason: 'wall-empty', wins: [], scores: [7, 10, -24, 7] });
  });

  it('暗杠即时计分，补杠和点杠按不同的付款方式计分', () => {
    const state = timeout(sichuan, timeout(sichuan, sichuan.start(3, 0)));
    state.missing = [2, 2, 2, 2];
    state.hands = [[0, 1, 2, 3, 12], [17, 18, 19], [], []];
    state.wall = [40, 80, 16];
    const concealed = play(sichuan, state, 0, { type: 'concealed-kong', tiles: [0, 1, 2, 3] });
    expect(concealed.scores).toEqual([6, -2, -2, -2]);
    const window = play(sichuan, concealed, 0, { type: 'discard', tiles: [16] });
    const exposed = play(sichuan, window, 1, { type: 'kong' });
    expect(exposed.hands[1]).toEqual([80]);
    expect(exposed.scores).toEqual([4, 0, -2, -2]);
    state.hands = [[19, 44], [], [], []];
    state.groups[0] = [{ type: 'pong', tiles: [16, 17, 18] }];
    const added = play(sichuan, state, 0, { type: 'added-kong', tiles: [19] });
    expect(added.scores).toEqual([3, -1, -1, -1]);
  });

  it('放过同番点胡后只能胡更高番，自己摸牌后解锁', () => {
    const state = timeout(sichuan, timeout(sichuan, sichuan.start(3, 0)));
    state.missing = [2, 2, 2, 2];
    state.hands = [[19], [33], waitForFive, []];
    state.wall = [17, 49];
    const window = play(sichuan, state, 0, { type: 'discard', tiles: [19] });
    const passed = play(sichuan, window, 2, { type: 'pass' });
    expect(passed.passed[2]).toBe(0);
    const next = play(sichuan, passed, 1, { type: 'discard', tiles: [17] });
    expect(next.turn).toBe(2);
    expect(next.window).toBeNull();
    expect(next.passed[2]).toBeNull();
  });
});

describe('广东鸡平胡', () => {
  it('136 张含字牌，可吃，零番点胡可结算', () => {
    const state = guangdong.start(3, 0);
    expect(new Set([...state.wall, ...state.hands.flat()]).size).toBe(136);
    state.hands = [[19], [0, 1, 2, ...waitForFive.slice(3)], [], []];
    const offered = play(guangdong, state, 0, { type: 'discard', tiles: [19] });
    expect(guangdong.viewFor(offered, 1).actions.some((action) => action.type === 'chow')).toBe(true);
    const ended = play(guangdong, offered, 1, { type: 'win' });
    expect(guangdong.viewFor(ended, 0).result).toMatchObject({ kind: 'win', winner: 1, from: 0, fan: 0, scores: [-1, 1, 0, 0] });
  });

  it('同一张牌有多人胡时只取最近者，且可抢补杠', () => {
    const state = guangdong.start(12, 0);
    state.hands = [[19], waitForFive, waitForFive.map((id) => id + 1), []];
    state.groups[0] = [{ type: 'pong', tiles: [16, 17, 18] }];
    // Both opponents can complete 456, holding neither of the tiles in the exposed pong.
    state.hands[1] = [0, 4, 8, 12, 20, 36, 40, 44, 48, 52, 56, 108, 109];
    state.hands[2] = [1, 5, 9, 13, 21, 37, 41, 45, 49, 53, 57, 110, 111];
    const offered = play(guangdong, state, 0, { type: 'added-kong', tiles: [19] });
    expect(guangdong.viewFor(offered, 1).pending?.kind).toBe('added-kong');
    expect(guangdong.viewFor(offered, 2).actions).toEqual([{ type: 'win' }, { type: 'pass' }]);
    const waiting = play(guangdong, offered, 2, { type: 'win' });
    const ended = play(guangdong, waiting, 1, { type: 'win' });
    expect(ended.result).toMatchObject({ kind: 'win', winner: 1, from: 0, patterns: expect.arrayContaining(['抢杠胡']) });
    expect(ended.groups[0][0].type).toBe('pong');
  });

  it.each([
    { hand: [...waitForFive, 17], patterns: ['平胡', '自摸'], fan: 2 },
    { hand: [0, 1, 2, 12, 13, 14, 24, 25, 26, 40, 41, 42, 108, 109], patterns: ['碰碰胡', '自摸'], fan: 4 },
    { hand: [0, 1, 4, 5, 8, 9, 12, 13, 16, 17, 20, 21, 24, 25], patterns: ['七对', '清一色', '自摸'], fan: 6 },
    { hand: [108, 109, 110, 112, 113, 114, 116, 117, 118, 120, 121, 122, 124, 125], patterns: ['碰碰胡', '字一色', '自摸'], fan: 6 },
    { hand: [0, 4, 8, 12, 16, 20, 24, 28, 32, 108, 109, 110, 112, 113], patterns: ['混一色', '自摸'], fan: 4 },
  ])('自摸计算 $patterns，并按六番封顶', ({ hand, patterns, fan }) => {
    const state = guangdong.start(23, 0);
    state.hands[0] = hand;
    const ended = play(guangdong, state, 0, { type: 'win' });
    expect(ended.result).toEqual({ kind: 'win', winner: 0, from: null, fan, patterns, scores: [3 * 2 ** fan, -(2 ** fan), -(2 ** fan), -(2 ** fan)] });
  });

  it('吃后要打牌，暗杠不泄露，没人抢补杠就正常补牌', () => {
    const state = guangdong.start(9, 0);
    state.hands = [[8], [0, 4, 28, 29, 30, 31], [9, 10], []];
    state.wall = [71, 72, 73];
    const claiming = play(guangdong, state, 0, { type: 'discard', tiles: [8] });
    const waiting = play(guangdong, claiming, 1, { type: 'chow', tiles: [4, 0] });
    const chow = timeout(guangdong, waiting);
    expect(chow.groups[1]).toEqual([{ type: 'chow', tiles: [0, 4, 8] }]);
    expect(guangdong.viewFor(chow, 1).actions.every((action) => action.type === 'discard')).toBe(true);
    const turn = { ...state, hands: [[28, 29, 30, 31], [], [], []] };
    const hidden = play(guangdong, turn, 0, { type: 'concealed-kong', tiles: [28, 29, 30, 31] });
    expect(guangdong.viewFor(hidden, 1).players[0].groups[0].tiles).toEqual([null, null, null, null]);
    const added = play(guangdong, { ...state, hands: [[19], [], [], []], groups: [[{ type: 'pong', tiles: [16, 17, 18] }], [], [], []] },
      0, { type: 'added-kong', tiles: [19] });
    expect(added.hands[0]).toEqual([73]);
    expect(added.groups[0][0]).toEqual({ type: 'added-kong', tiles: [16, 17, 18, 19] });
  });

  it('超时自动打牌，过了补杠窗口后补牌，牌墙耗尽后结束', () => {
    const state = guangdong.start(0, 0);
    state.hands = [[19], [0, 4, 8, 12, 20, 36, 40, 44, 48, 52, 56, 108, 109], [], []];
    state.groups[0] = [{ type: 'pong', tiles: [16, 17, 18] }];
    state.wall = [132];
    const pending = play(guangdong, state, 0, { type: 'added-kong', tiles: [19] });
    const added = timeout(guangdong, pending);
    expect(added.hands[0]).toEqual([132]);
    const ended = timeout(guangdong, added);
    expect(ended.result).toEqual({ kind: 'draw', scores: [0, 0, 0, 0] });
    expect(guangdong.apply(ended, { timeout: true }, 50_000).ok).toBe(false);
  });
});
