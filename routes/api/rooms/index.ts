import { defineHandler } from 'void';
import { z } from 'zod';
import { GameRoom } from '../../../durable-objects/room-object';
import { nameSchema, roomIdLength } from '../../../src/room/http';

const createRoomSchema = nameSchema.extend({
  gameType: z.string().min(1).max(64),
  rulesetId: z.string().min(1).max(64).optional(),
});

export const POST = defineHandler.withValidator({ body: createRoomSchema })(async (c, { body }) => {
  const token = crypto.randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    const roomId = crypto.randomUUID().replaceAll('-', '').slice(0, roomIdLength).toUpperCase();
    const result = await GameRoom.get(roomId).create(roomId, body.name, token, body.gameType, body.rulesetId);
    switch (result) {
      case 'created': return { roomId, token };
      case 'invalid-game': return c.json({ message: '游戏不可用' }, 400);
      case 'invalid-selection': return c.json({ message: '玩法不可用' }, 400);
      case 'conflict': break;
    }
  }
  return c.json({ message: '暂时无法创建房间' }, 503);
});
