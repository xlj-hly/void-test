import { defineRoomGame, type RoomClientMessage } from '../room/game-adapter';
import { createMahjongEngine } from './engine';
import { clientMessageSchema, type MahjongMove } from './protocol/messages';

export const mahjongRoomGame = defineRoomGame({
  createEngine: () => createMahjongEngine(() => (size) => crypto.getRandomValues(new Uint32Array(size))),
  decodeMessage(raw: unknown): RoomClientMessage<MahjongMove> | undefined {
    const parsed = clientMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type !== 'act') return message;
    return {
      type: 'act',
      commandId: message.commandId,
      move: { decisionId: message.decisionId, action: message.action },
    };
  },
});
