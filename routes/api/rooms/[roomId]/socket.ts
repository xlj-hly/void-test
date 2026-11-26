import { defineHandler } from 'void';
import { z } from 'zod';
import { GameRoom } from '../../../../durable-objects/room-object';
import { roomIdSchema } from '../../../../src/room/http';

export const GET = defineHandler.withValidator({ params: z.object({ roomId: roomIdSchema }) })(
  (c, { params: { roomId } }) => {
    const request = c.req.raw;
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return c.text('需要 WebSocket 连接', 426);
    }
    if (request.headers.get('Origin') !== new URL(request.url).origin) {
      return c.text('不允许此来源连接', 403);
    }
    return GameRoom.get(roomId).fetch(request);
  },
);
