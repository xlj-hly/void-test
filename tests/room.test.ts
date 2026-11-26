import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { createMahjongEngine } from '../src/mahjong/engine';
import type { MahjongConfiguration } from '../src/mahjong/protocol/messages';
import { Room, type RoomRecord } from '../src/room/session';
import { basic, CLAIM_MS, TURN_MS } from '../src/mahjong/rules/basic';
import { register } from '../src/mahjong/rules/contract';
import { createRulesetRegistry, rulesets } from '../src/mahjong/rules/registry';

const id = 'AABBCCDDEE';
const tokens = Array.from({ length: 5 }, (_, i) => `aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa${i}`);
const rule = register(basic);

describe('持久化房间与规则集成', () => {
  let saved: RoomRecord<MahjongConfiguration> | undefined;
  let alarm: number | null;
  let now: number;
  let failWrite: boolean;
  let room: ReturnType<typeof restore>;
  const restore = (registry = rulesets) => new Room({
    load: async () => saved && structuredClone(saved),
    save: async (record, at) => {
      if (failWrite) throw new Error('storage unavailable');
      saved = structuredClone(record);
      alarm = at;
    },
  }, createMahjongEngine(() => 123, registry), () => now, () => {});

  beforeEach(() => { saved = undefined; alarm = null; now = 500; failWrite = false; room = restore(); });

  async function fillRoom() {
    expect(await room.create(id, '东', tokens[0])).toBe('created');
    await Promise.all(tokens.slice(1, 4).map((token, i) => room.join(`客${i + 1}`, token)));
  }

  it('用稳定凭证恢复座位，拒绝房间外身份和重复开房', async () => {
    expect(await room.join('外部', tokens[4])).toMatchObject({ status: 404 });
    await fillRoom();
    expect(await room.create(id, '客', tokens[4])).toBe('conflict');
    expect(await room.join('第五位', tokens[4])).toMatchObject({ status: 409 });
    expect(await room.resume(tokens[4])).toBeNull();
    expect(await restore().resume(tokens[2])).toMatchObject({ seat: 2, owner: 0, roomId: id });
  });

  it('鉴别房主并对重试去重，重新加载仍保留动作结果和截止时间', async () => {
    await room.create(id, '东', tokens[0]);
    const start = { type: 'start' as const, commandId: 'start' };
    expect(await room.command(0, start)).toMatchObject({ type: 'error' });
    await Promise.all(tokens.slice(1, 4).map((token, i) => room.join(`客${i + 1}`, token)));
    expect(await room.command(1, start)).toMatchObject({ type: 'error' });
    expect(await room.command(0, start)).toEqual({ type: 'ack', commandId: 'start' });
    expect(alarm).toBe(now + TURN_MS);
    const startView = (await room.resume(tokens[0]))!;
    expect(startView.table?.players[0].hand).toHaveLength(14);
    expect((await room.resume(tokens[1]))?.table?.players[0].hand).toBeUndefined();
    const action = startView.table!.actions[0];
    const command = { type: 'act' as const, commandId: 'discard', move: { action, decisionId: startView.table!.decisionId } };
    const outcomes = await Promise.all([room.command(0, command), room.command(0, command)]);
    expect(outcomes.map((item) => item.type)).toEqual(['ack', 'ack']);
    room = restore();
    expect(await room.command(0, command)).toMatchObject({ type: 'ack' });
    expect((await room.resume(tokens[0]))?.revision).toBe(startView.revision + 1);
    expect(await room.command(0, { ...command, commandId: 'stale' })).toMatchObject({ type: 'error' });
  });

  it('超时在没有客户端命令时推进，重复唤醒不重复推进', async () => {
    await fillRoom();
    await room.command(0, { type: 'start', commandId: 'start' });
    expect(saved?.rulesetId).toBe(rule.id);
    const before = saved!.revision;
    now = alarm!;
    await restore().tick();
    expect(saved?.revision).toBe(before + 1);
    expect(alarm).toBeGreaterThan(now);
    expect([now + TURN_MS, now + CLAIM_MS]).toContain(alarm);
    await restore().tick();
    expect(saved?.revision).toBe(before + 1);
  });

  it('持久化失败后保留旧版本，同一命令可安全重试', async () => {
    await fillRoom();
    const revision = saved!.revision;
    const start = { type: 'start' as const, commandId: 'start' };
    failWrite = true;
    await expect(room.command(0, start)).rejects.toThrow('storage unavailable');
    expect(saved?.revision).toBe(revision);
    expect(saved?.game).toBeNull();
    expect(alarm).toBeNull();
    failWrite = false;
    expect(await room.command(0, start)).toMatchObject({ type: 'ack' });
    expect(saved?.revision).toBe(revision + 1);
  });

  it('麻将引擎拒绝用其他版本解释房间快照', async () => {
    const alternate = { ...rule, id: 'example', version: 2 };
    const customRegistry = createRulesetRegistry(alternate.id, [alternate]);
    room = restore(customRegistry);
    await fillRoom();
    expect(await room.command(0, { type: 'start', commandId: 'start' })).toMatchObject({ type: 'ack' });
    expect(await restore(customRegistry).resume(tokens[1])).toMatchObject({ rulesetId: 'example', rulesetVersion: 2 });
    await expect(restore().resume(tokens[1])).rejects.toThrow('房间保存的规则版本不可用');
  });

  it('保存建房时选择的玩法和版本，恢复后继续同一开局流程', async () => {
    expect(await room.create(id, '东', tokens[0], 'unknown')).toBe('invalid-selection');
    expect(saved).toBeUndefined();
    expect(await room.create(id, '东', tokens[0], 'sichuan')).toBe('created');
    await Promise.all(tokens.slice(1, 4).map((token) => room.join('客', token)));
    expect(await room.command(0, { type: 'start', commandId: 'start' })).toMatchObject({ type: 'ack' });
    expect(await restore().resume(tokens[3])).toMatchObject({ rulesetId: 'sichuan', rulesetVersion: 1,
      table: { phase: 'exchange', wallRemaining: 55 } });
  });
});
