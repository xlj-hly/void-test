import type { Engine } from './engine';
import { Room, type CommandReply, type RoomCommand, type RoomRecord, type RoomView } from './session';

export type RoomClientMessage<Move> = { type: 'resume'; token: string } | RoomCommand<Move>;
export type RoomSnapshot = { type: 'snapshot'; view: RoomView<object>; events: unknown[] };
export type RoomServerMessage = RoomSnapshot | CommandReply | { type: 'error'; message: string; commandId?: string };

type RoomRuntime = {
  load<Configuration extends object>(): Promise<RoomRecord<Configuration> | undefined>;
  save(record: RoomRecord<object>, deadline: number | null): Promise<void>;
  now: () => number;
  publish(snapshotFor: (seat: number) => RoomSnapshot): void;
};

type RoomLifecycle<View extends object> = Pick<Room<object, unknown, View, unknown>, 'create' | 'join' | 'tick' | 'resume'>;

export type RoomSession<View extends object = object> = {
  room: RoomLifecycle<View>;
  decodeMessage(raw: unknown): { type: 'resume'; token: string }
    | { type: 'command'; commandId: string; run(seat: number): Promise<CommandReply> }
    | undefined;
};

export type RoomGame = (runtime: RoomRuntime) => RoomSession;

export function defineRoomGame<Configuration extends object, Move, View extends object, Event>(game: {
  createEngine(): Engine<Configuration, Move, View, Event>;
  decodeMessage(raw: unknown): RoomClientMessage<Move> | undefined;
}): (runtime: RoomRuntime) => RoomSession<View> {
  return (runtime) => {
    const room = new Room({
      load: () => runtime.load<Configuration>(),
      save: (record, deadline) => runtime.save(record, deadline),
    }, game.createEngine(), runtime.now, (record, events) => {
      runtime.publish((seat) => ({ type: 'snapshot', view: room.viewFor(record, seat), events }));
    });
    return {
      room,
      decodeMessage(raw: unknown) {
        const message = game.decodeMessage(raw);
        if (!message || message.type === 'resume') return message;
        return {
          type: 'command' as const,
          commandId: message.commandId,
          run: (seat: number) => room.command(seat, message),
        };
      },
    };
  };
}
