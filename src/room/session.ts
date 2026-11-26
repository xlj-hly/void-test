import type { Engine, GameState, GameUpdate } from './engine';

export type RoomRecord<Configuration extends object> = Configuration & {
  schema: 1;
  roomId: string;
  revision: number;
  members: { name: string; token: string }[];
  processed: { seat: number; id: string }[];
  game: GameState | null;
};
export type RoomStore<Configuration extends object> = {
  load(): Promise<RoomRecord<Configuration> | undefined>;
  save(room: RoomRecord<Configuration>, alarm: number | null): Promise<void>;
};
export type RoomView<GameView extends object> = GameView & {
  roomId: string;
  revision: number;
  seat: number;
  owner: number;
  seats: { name: string }[];
  capacity: number;
};
export type RoomCommand<Move> = { type: 'start'; commandId: string }
  | { type: 'act'; commandId: string; move: Move };
export type CommandReply = { type: 'ack'; commandId: string }
  | { type: 'error'; message: string; commandId: string };
export type RoomCreateResult = 'created' | 'conflict' | 'invalid-selection';

export class Room<Configuration extends object, Move, View extends object, Event> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private store: RoomStore<Configuration>,
    private engine: Engine<Configuration, Move, View, Event>,
    private clock: () => number,
    private publish: (room: RoomRecord<Configuration>, events: Event[]) => void,
  ) {}

  private sequence<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  create(roomId: string, name: string, token: string, selection?: string): Promise<RoomCreateResult> {
    return this.sequence(async (): Promise<RoomCreateResult> => {
      if (await this.store.load()) return 'conflict';
      const configuration = this.engine.configure(selection);
      if (!configuration) return 'invalid-selection';
      await this.store.save({
        ...configuration, schema: 1, roomId, revision: 1, members: [{ name, token }], processed: [], game: null,
      }, null);
      return 'created';
    });
  }

  join(name: string, token: string) {
    return this.sequence(async () => {
      const record = await this.store.load();
      if (!record) return { status: 404, message: '房间不存在' } as const;
      if (record.game || record.members.length >= this.engine.capacity(record)) {
        return { status: 409, message: '房间已满或已经开局' } as const;
      }
      record.members.push({ name, token });
      await this.commit(record, []);
      return { status: 200 } as const;
    });
  }

  resume(token: string, connected?: (view: RoomView<View>) => void) {
    return this.sequence(async () => {
      const record = await this.store.load();
      if (!record) return null;
      const seat = record.members.findIndex((member) => member.token === token);
      if (seat < 0) return null;
      await this.advanceTime(record, this.clock());
      const view = this.viewFor(record, seat);
      connected?.(view);
      return view;
    });
  }

  command(seat: number, command: RoomCommand<Move>): Promise<CommandReply> {
    return this.sequence(async () => {
      const commandId = command.commandId;
      const error = (message: string): CommandReply => ({ type: 'error', commandId, message });
      const ack: CommandReply = { type: 'ack', commandId };
      const record = await this.store.load();
      if (!record?.members[seat]) return error('座位无效');
      const now = this.clock();
      await this.advanceTime(record, now);
      if (record.processed.some((entry) => entry.seat === seat && entry.id === commandId)) return ack;
      let update: GameUpdate<Event>;
      if (command.type === 'start') {
        if (seat !== 0) return error('只有房主可以开局');
        if (record.game) return error('游戏已经开始');
        update = this.engine.start(record, record.members.length, now);
      } else {
        if (!record.game) return error('游戏还未开始');
        update = this.engine.apply(record, record.game.data, { seat, move: command.move }, now);
      }
      if (!update.ok) return error(update.message);
      record.game = { data: update.state };
      record.processed = [...record.processed.slice(-63), { seat, id: commandId }];
      await this.commit(record, update.events);
      return ack;
    });
  }

  tick() {
    return this.sequence(async () => {
      const record = await this.store.load();
      if (record) await this.advanceTime(record, this.clock());
    });
  }

  private async advanceTime(record: RoomRecord<Configuration>, now: number) {
    if (!record.game) return;
    const deadline = this.engine.deadline(record, record.game.data);
    if (deadline === null || deadline > now) return;
    const update = this.engine.apply(record, record.game.data, { timeout: true }, now);
    if (!update.ok) throw new Error(update.message);
    record.game.data = update.state;
    await this.commit(record, update.events);
  }

  private async commit(record: RoomRecord<Configuration>, events: Event[]) {
    record.revision++;
    const deadline = record.game ? this.engine.deadline(record, record.game.data) : null;
    await this.store.save(record, deadline);
    this.publish(record, events);
  }

  viewFor(record: RoomRecord<Configuration>, seat: number): RoomView<View> {
    return {
      ...this.engine.viewFor(record, record.game, seat),
      roomId: record.roomId, revision: record.revision, seat, owner: 0,
      capacity: this.engine.capacity(record), seats: record.members.map(({ name }) => ({ name })),
    };
  }
}
