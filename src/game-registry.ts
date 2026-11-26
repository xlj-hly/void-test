import { mahjongRoomGame } from './mahjong/room-adapter';
import type { RoomGame } from './room/game-adapter';

type RegisteredGame = {
  name: string;
  openRoom: RoomGame;
};

export const roomGames: ReadonlyMap<string, RegisteredGame> = new Map([
  ['mahjong', {
    name: '麻将',
    openRoom: mahjongRoomGame,
  }],
]);
