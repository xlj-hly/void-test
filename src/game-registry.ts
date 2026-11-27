import type { PagePath } from 'void/routes';
import { mahjongRoomGame } from './mahjong/room-adapter';
import type { RoomGame } from './room/game-adapter';

type RegisteredGame = {
  name: string;
  href: PagePath;
  openRoom: RoomGame;
};

export const roomGames: ReadonlyMap<string, RegisteredGame> = new Map([
  ['mahjong', {
    name: '麻将',
    href: '/games/mahjong',
    openRoom: mahjongRoomGame,
  }],
]);
