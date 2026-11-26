import { defineHandler } from 'void';
import { z } from 'zod';
import { GameRoom } from '../../../../durable-objects/room-object';
import { nameSchema, roomIdSchema } from '../../../../src/room/http';

export const POST = defineHandler.withValidator({ body: nameSchema, params: z.object({ roomId: roomIdSchema }) })(
  async (c, { body, params: { roomId } }) => {
    const token = crypto.randomUUID();
    const result = await GameRoom.get(roomId).join(body.name, token);
    if (result.status !== 200) return c.json({ message: result.message }, result.status);
    return { roomId, token };
  },
);
