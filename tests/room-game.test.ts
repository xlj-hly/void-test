import { expect, it } from 'vite-plus/test';
import { mahjongRoomGame } from '../src/mahjong/room-adapter';
import { defineRoomGame, type RoomGame, type RoomSnapshot } from '../src/room/game-adapter';
import type { RoomRecord } from '../src/room/session';

function runtime() {
  let saved: RoomRecord<object> | undefined;
  const snapshots: RoomSnapshot[] = [];
  return {
    snapshots,
    load: async <Configuration extends object>() => saved as RoomRecord<Configuration> | undefined,
    save: async (record: RoomRecord<object>) => { saved = structuredClone(record); },
    now: () => 0,
    publish: (snapshotFor: (seat: number) => RoomSnapshot) => { snapshots.push(snapshotFor(0)); },
  };
}

it('the same room adapter contract accepts two games with different wire actions', async () => {
  const counter: RoomGame = defineRoomGame<object, number, { total: number | null }, number>({
    createEngine: () => ({
      configure: () => ({}),
      capacity: () => 2,
      start: () => ({ ok: true, state: 0, events: [] }),
      apply: (_config, state, input) => {
        const total = Number(state) + ('move' in input ? input.move : 0);
        return { ok: true, state: total, events: [total] };
      },
      deadline: () => null,
      viewFor: (_config, game) => ({ total: game && Number(game.data) }),
    }),
    decodeMessage(raw) {
      if (raw === 'start') return { type: 'start', commandId: 'start' };
      if (typeof raw === 'number') return { type: 'act', commandId: 'move', move: raw };
    },
  });
  const context = runtime();
  const session = counter(context);
  expect(await session.room.create('counter', 'A', 'a')).toBe('created');
  const start = session.decodeMessage('start');
  if (start?.type !== 'command') throw new Error('expected a start command');
  expect(await start.run(0)).toEqual({ type: 'ack', commandId: 'start' });
  const move = session.decodeMessage(2);
  if (move?.type !== 'command') throw new Error('expected a move');
  expect(await move.run(0)).toEqual({ type: 'ack', commandId: 'move' });
  expect(context.snapshots.at(-1)).toMatchObject({ type: 'snapshot', view: { total: 2 }, events: [2] });
  expect(mahjongRoomGame(runtime()).decodeMessage(2)).toBeUndefined();
});

it('the Mahjong adapter restores its native seat view and translates a wire action', async () => {
  const context = runtime();
  const token = crypto.randomUUID();
  const { room } = mahjongRoomGame(context);
  await room.create('table', 'A', token);
  for (const name of ['B', 'C', 'D']) await room.join(name, crypto.randomUUID());

  const restored = mahjongRoomGame(context);
  expect(restored.decodeMessage({ type: 'resume', token })).toEqual({ type: 'resume', token });
  expect(await restored.room.resume(token)).toMatchObject({ rulesetId: 'basic', seat: 0 });
  const start = restored.decodeMessage({ type: 'start', commandId: crypto.randomUUID() });
  if (start?.type !== 'command') throw new Error('expected a start command');
  expect(await start.run(0)).toMatchObject({ type: 'ack' });

  const view = await restored.room.resume(token);
  if (!view?.table) throw new Error('expected a started table');
  const move = restored.decodeMessage({
    type: 'act', commandId: crypto.randomUUID(), decisionId: view.table.decisionId, action: view.table.actions[0],
  });
  if (move?.type !== 'command') throw new Error('expected a move');
  expect(await move.run(0)).toMatchObject({ type: 'ack' });
  expect(context.snapshots.at(-1)?.events[0]).toMatchObject({ type: 'discard', seat: 0 });
});
