import { expect, it, vi } from 'vite-plus/test';
import { GameRoom } from '../durable-objects/room-object';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(protected ctx: unknown) {}
  },
}));

vi.mock('void/durable', () => ({
  defineDurableObject: (definition: object) => definition,
}));

function setup() {
  const records = new Map<string, unknown>();
  const get = vi.fn(async (key: string) => structuredClone(records.get(key)));
  const transaction = {
    async put(key: string, value: unknown) { records.set(key, structuredClone(value)); },
    async deleteAlarm() {},
    async setAlarm() {},
  };
  const context = {
    storage: { get, transaction: async (write: (store: typeof transaction) => Promise<void>) => write(transaction) },
    blockConcurrencyWhile: async (work: () => Promise<unknown>) => work(),
    getWebSockets: () => [],
  };
  type RoomObjectArgs = ConstructorParameters<typeof GameRoom.class>;
  const open = () => new GameRoom.class(context as unknown as RoomObjectArgs[0], {} as RoomObjectArgs[1]);
  return { get, open, records };
}

it('checks persistent state once on creation and leaves a cold conflicting room intact', async () => {
  const { get, open, records } = setup();
  const id = 'AABBCCDDEE';
  expect(await open().create(id, '东', 'host', 'mahjong', 'sichuan')).toBe('created');
  expect(get.mock.calls).toEqual([['room']]);
  expect(records.get('game-type')).toBe('mahjong');

  const saved = records.get('room');
  const existing = open();
  get.mockClear();
  expect(await existing.create(id, '客', 'other', 'mahjong', 'guangdong')).toBe('conflict');
  expect(get.mock.calls).toEqual([['room']]);
  expect(records.get('room')).toEqual(saved);
  expect(await existing.join('客', 'guest')).toMatchObject({ status: 200 });
  expect(records.get('room')).toMatchObject({ rulesetId: 'sichuan' });
});

it('restores Mahjong records created before the game type was stored', async () => {
  const { open, records } = setup();
  const id = 'AABBCCDDEE';
  expect(await open().create(id, '东', 'host', 'mahjong', 'sichuan')).toBe('created');
  records.delete('game-type');
  expect(await open().join('南', 'guest')).toMatchObject({ status: 200 });
  expect(records.get('game-type')).toBe('mahjong');
  expect(records.get('room')).toMatchObject({ rulesetId: 'sichuan' });
});

it('distinguishes an unregistered game from an occupied room code', async () => {
  const { open, records } = setup();
  const id = 'AABBCCDDEE';
  expect(await open().create(id, '东', 'host', 'unknown')).toBe('invalid-game');
  expect(records.size).toBe(0);
  expect(await open().create(id, '东', 'host', 'mahjong')).toBe('created');
  expect(await open().create(id, '客', 'other', 'unknown')).toBe('conflict');
});
