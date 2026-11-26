import { describe, expect, it } from 'vite-plus/test';
import { createMahjongEngine } from '../src/mahjong/engine';
import { basic } from '../src/mahjong/rules/basic';
import { register } from '../src/mahjong/rules/contract';
import { createRulesetRegistry } from '../src/mahjong/rules/registry';
import type { Engine } from '../src/room/engine';
import { Room, type RoomRecord } from '../src/room/session';

describe('游戏引擎边界', () => {
  it('同一个房间可以运行两人计数游戏', async () => {
    type Setup = { target: number };
    type View = { count: number | null };
    let saved: RoomRecord<Setup> | undefined;
    const engine: Engine<Setup, number, View, number> = {
      configure: () => ({ target: 5 }),
      capacity: () => 2,
      start: (_setup, players) => players < 1
        ? { ok: false, message: 'no players' }
        : { ok: true, state: 0, events: [] },
      apply: (setup, state, decision) => {
        const count = Number(state) + ('move' in decision ? decision.move : 0);
        return count <= setup.target ? { ok: true, state: count, events: [count] } : { ok: false, message: 'limit' };
      },
      deadline: () => null,
      viewFor: (_setup, game) => ({ count: game && Number(game.data) }),
    };
    const room = new Room({
      load: async () => saved && structuredClone(saved),
      save: async (record) => { saved = structuredClone(record); },
    }, engine, () => 0, () => {});

    expect(await room.create('counter', 'A', 'a')).toBe('created');
    expect(await room.join('B', 'b')).toMatchObject({ status: 200 });
    expect(await room.join('C', 'c')).toMatchObject({ status: 409 });
    expect(await room.command(0, { type: 'start', commandId: 'start' })).toMatchObject({ type: 'ack' });
    expect(await room.command(1, { type: 'act', commandId: 'add', move: 2 })).toMatchObject({ type: 'ack' });
    expect(await room.command(1, { type: 'act', commandId: 'over', move: 4 })).toMatchObject({ type: 'error', message: 'limit' });
    expect(await room.resume('b')).toMatchObject({ count: 2, capacity: 2 });

    saved = undefined;
    expect(await room.create('solo', 'A', 'a')).toBe('created');
    expect(await room.command(0, { type: 'start', commandId: 'start' })).toMatchObject({ type: 'ack' });
  });

  it('目录取当前版本，已保存的版本仍能精确恢复', () => {
    const first = register(basic);
    const next = register({ ...basic, name: '新版基础麻将', version: 2 });
    const registry = createRulesetRegistry(first.id, [next, first]);
    const engine = createMahjongEngine(() => 123, registry);

    expect(registry.catalog()).toEqual([{ id: first.id, name: next.name, version: 2, seats: 4 }]);
    expect(engine.configure()).toEqual({ rulesetId: first.id, rulesetVersion: 2 });
    expect(engine.configure('missing')).toBeUndefined();
    const saved = { rulesetId: first.id, rulesetVersion: 1 };
    const started = engine.start(saved, 4, 0);
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.message);
    expect(engine.viewFor(saved, { data: started.state }, 0)).toMatchObject({ rulesetVersion: 1 });
    expect(() => engine.start({ ...saved, rulesetVersion: 999 }, 4, 0)).toThrow('房间保存的规则版本不可用');
    expect(() => createRulesetRegistry(first.id, [first, first])).toThrow('重复的玩法版本');
    expect(() => createRulesetRegistry('missing', [first])).toThrow('默认玩法未注册');
  });
});
