import { describe, expect, it } from 'vite-plus/test';
import { basic, newHand, type BasicState } from '../src/mahjong/rules/basic';
import type { Action } from '../src/mahjong/protocol/messages';
import { canWin } from '../src/mahjong/rules/tiles';

function fixture(hands: number[][], wall = [131, 135]) {
  return { ...newHand(3, 0), hands, wall };
}

function move(state: BasicState, seat: number, action: Action) {
  const result = basic.apply(state, { seat, decisionId: state.decisionId, action }, 10);
  if (!result.ok) throw new Error(result.message);
  return result.state;
}

function expire(state: BasicState) {
  const result = basic.apply(state, { timeout: true }, state.deadline!);
  if (!result.ok) throw new Error(result.message);
  return result.state;
}

describe('基础四人麻将', () => {
  it('用固定种子发牌，四副手牌和牌墙包含 136 张不同的牌', () => {
    const hand = newHand(123, 0);
    expect(hand).toEqual(newHand(123, 0));
    expect(hand.hands.map((tiles) => tiles.length)).toEqual([14, 13, 13, 13]);
    expect(new Set([...hand.hands.flat(), ...hand.wall]).size).toBe(136);
    expect(basic.viewFor(hand, 2).players.map((p) => p.hand?.length)).toEqual([undefined, undefined, 13, undefined]);
    const entropy = crypto.getRandomValues(new Uint32Array(136));
    expect(newHand(entropy, 0)).toEqual(newHand(entropy, 0));
  });

  it('只允许当前座位操作自己的牌，决策过期后不能再出牌', () => {
    const hand = newHand(14, 0);
    const discard = basic.viewFor(hand, 0).actions.find((action) => action.type === 'discard')!;
    expect(basic.apply(hand, { seat: 1, decisionId: 1, action: discard }, 1).ok).toBe(false);
    expect(basic.apply(hand, { seat: 0, decisionId: 0, action: discard }, 1).ok).toBe(false);
    expect(basic.apply(hand, { seat: 0, decisionId: 1, action: discard }, hand.deadline! ).ok).toBe(false);
  });

  it('牌墙摸尽后按零分流局结算', () => {
    const hand = newHand(14, 0);
    const tiles = hand.hands[0];
    hand.wall = [];
    hand.hands = [[...tiles], [], [], []];
    const result = basic.apply(hand, { seat: 0, decisionId: 1, action: { type: 'discard', tiles: [tiles[0]] } }, 1);
    expect(result.ok && basic.viewFor(result.state, 0).result).toEqual({ kind: 'draw', scores: [0, 0, 0, 0] });
  });

  it('两人用同一窗口分别响应，碰优先于吃且不泄露其他人的操作', () => {
    const original = fixture([[8], [0, 4], [9, 10], []]);
    const window = move(original, 0, { type: 'discard', tiles: [8] });
    expect(window.window).not.toBeNull();
    expect(original.rivers[0]).toEqual([]);
    expect(basic.viewFor(window, 1).actions).toEqual([{ type: 'chow', tiles: [0, 4] }, { type: 'pass' }]);
    expect(basic.viewFor(window, 2).actions).toEqual([{ type: 'pong' }, { type: 'pass' }]);
    const waiting = move(window, 1, { type: 'chow', tiles: [0, 4] });
    expect(waiting.decisionId).toBe(window.decisionId);
    expect(basic.viewFor(waiting, 1).actions).toEqual([]);
    expect(basic.apply(waiting, { timeout: true }, 50).ok).toBe(false);
    const won = move(waiting, 2, { type: 'pong' });
    expect(won.rivers[0]).toEqual([]);
    expect(won.groups[2]).toEqual([{ type: 'pong', tiles: [8, 9, 10] }]);
    expect(won.turn).toBe(2);
    expect(won.wall).toEqual(original.wall);
  });

  it('其他座位跳过后可吃，全部过时从牌墙首张摸牌', () => {
    const window = move(fixture([[8], [0, 4], [9, 10], []]), 0, { type: 'discard', tiles: [8] });
    const passed = move(window, 2, { type: 'pass' });
    const chow = move(passed, 1, { type: 'chow', tiles: [0, 4] });
    expect(chow.groups[1]).toEqual([{ type: 'chow', tiles: [0, 4, 8] }]);
    const afterTimeout = expire(passed);
    expect(afterTimeout.hands[1]).toEqual([0, 4, 131]);
    expect(afterTimeout.window).toBeNull();
  });

  it('吃牌后必须先出牌，不能把成形手牌作为自摸结算', () => {
    const hand = [0, 4, 12, 16, 20, 24, 28, 32, 36, 40, 44, 108, 109];
    const window = move(fixture([[8], hand, [], []]), 0, { type: 'discard', tiles: [8] });
    expect(basic.viewFor(window, 1).actions).toContainEqual({ type: 'win' });
    const chow = move(window, 1, { type: 'chow', tiles: [0, 4] });
    expect(basic.viewFor(chow, 1).actions.map(({ type }) => type)).toEqual(Array(11).fill('discard'));
    expect(basic.apply(chow, { seat: 1, decisionId: chow.decisionId, action: { type: 'win' } }, 10).ok).toBe(false);
  });

  it('明杠和暗杠从墙尾补牌，按座位隐藏暗杠牌面', () => {
    const discard = move(fixture([[112], [113, 114, 115], [], []]), 0, { type: 'discard', tiles: [112] });
    const kong = move(discard, 1, { type: 'kong' });
    expect(kong.turn).toBe(1);
    expect(kong.hands[1]).toEqual([135]);
    const closed = move(fixture([[0, 1, 2, 3, 4], [], [], []]), 0, { type: 'concealed-kong', tiles: [0, 1, 2, 3] });
    expect(closed.hands[0]).toEqual([4, 135]);
    expect(basic.viewFor(closed, 0).players[0].groups[0].tiles).toEqual([0, 1, 2, 3]);
    expect(basic.viewFor(closed, 1).players[0].groups[0].tiles).toEqual([null, null, null, null]);
    const noWall = fixture([[0, 1, 2, 3, 4], [], [], []], []);
    expect(basic.viewFor(noWall, 0).actions.some((action) => action.type === 'concealed-kong')).toBe(false);
  });

  it('自摸三家各付一分，点胡只由出牌者支付', () => {
    const ready = [0, 1, 2, 12, 13, 14, 24, 25, 26, 40, 41, 42, 108];
    const self = move(fixture([[...ready, 109], [], [], []]), 0, { type: 'win' });
    expect(self.result).toEqual({ kind: 'win', winner: 0, from: null, scores: [3, -1, -1, -1] });
    expect(basic.apply(self, { timeout: true }, 1000).ok).toBe(false);
    const window = move(fixture([[109], [], ready, [110, 111]]), 0, { type: 'discard', tiles: [109] });
    const waiting = move(window, 3, { type: 'pong' });
    const claimed = move(waiting, 2, { type: 'win' });
    expect(claimed.result).toEqual({ kind: 'win', winner: 2, from: 0, scores: [-1, 0, 1, 0] });
  });

  it('识别标准顺子和七对，字牌之间不能连成顺子', () => {
    expect(canWin([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 108, 109], 0)).toBe(true);
    expect(canWin([0, 1, 12, 13, 28, 29, 66, 67, 84, 85, 96, 97, 108, 109], 0)).toBe(true);
    expect(canWin([0, 4, 8, 12, 16, 20, 24, 28, 32, 108, 112, 116, 128, 129], 0)).toBe(false);
  });
});
