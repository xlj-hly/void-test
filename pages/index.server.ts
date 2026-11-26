import { defineHandler, type InferProps } from 'void';
import { roomGames } from '../src/game-registry';
import { roomIdSchema } from '../src/room/http';

export const loader = defineHandler((c) => {
  const room = roomIdSchema.safeParse(c.req.query('room')?.toUpperCase());
  if (room.success) return c.redirect(`/games/mahjong?room=${room.data}`);
  return { games: Array.from(roomGames, ([id, game]) => ({ id, name: game.name })) };
});

export type Props = InferProps<typeof loader>;
