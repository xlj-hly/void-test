import { z } from 'zod';
import { roomIdSchema } from '../../room/http';
import type { RoomView as SessionView } from '../../room/session';

const tileId = z.number().int().min(0).max(135);
const suit = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const seatToken = z.uuid();
export const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('discard'), tiles: z.tuple([tileId]) }),
  z.strictObject({ type: z.literal('chow'), tiles: z.tuple([tileId, tileId]) }),
  z.strictObject({ type: z.literal('pong') }),
  z.strictObject({ type: z.literal('kong') }),
  z.strictObject({ type: z.literal('concealed-kong'), tiles: z.tuple([tileId, tileId, tileId, tileId]) }),
  z.strictObject({ type: z.literal('added-kong'), tiles: z.tuple([tileId]) }),
  z.strictObject({ type: z.literal('exchange'), tiles: z.tuple([tileId, tileId, tileId]) }),
  z.strictObject({ type: z.literal('choose-suit'), suit }),
  z.strictObject({ type: z.literal('win') }),
  z.strictObject({ type: z.literal('pass') }),
  z.strictObject({ type: z.literal('next-hand') }),
]);
export type Action = z.infer<typeof actionSchema>;
export type Suit = z.infer<typeof suit>;

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('resume'), token: seatToken }),
  z.strictObject({ type: z.literal('start'), commandId: z.uuid() }),
  z.strictObject({ type: z.literal('act'), commandId: z.uuid(), decisionId: z.number().int().positive(), action: actionSchema }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type MahjongMove = Pick<Extract<ClientMessage, { type: 'act' }>, 'decisionId' | 'action'>;

export type Group = { type: 'chow' | 'pong' | 'kong' | 'concealed-kong' | 'added-kong'; tiles: (number | null)[] };
export type Win = { winner: number; from: number | null; fan: number; patterns: string[] };
export type Result = { kind: 'draw'; scores: number[] }
  | { kind: 'win'; winner: number; from: number | null; scores: number[]; fan?: number; patterns?: string[] }
  | { kind: 'multi-win'; wins: Win[]; scores: number[] }
  | { kind: 'blood'; reason: 'three-winners' | 'wall-empty'; wins: Win[]; scores: number[] };
export type TableEvent = { type: 'discard'; seat: number; tile: number }
  | { type: 'draw' | 'claim' | 'settlement' | 'win'; seat: number };
export type TableView = {
  phase: 'exchange' | 'choose-suit' | 'turn' | 'claim' | 'ended';
  turn: number;
  wallRemaining: number;
  players: { hand?: number[]; handCount: number; river: number[]; groups: Group[]; missingSuit?: Suit; won?: boolean }[];
  decisionId: number;
  deadline: number | null;
  actions: Action[];
  pending?: { from: number; tile: number; kind?: 'added-kong' };
  exchange?: { groups: number[][] };
  round?: { dealer: number; wind: number; hand: number; complete: boolean };
  scores?: number[];
  result: Result | null;
};
export type MahjongConfiguration = { rulesetId: string; rulesetVersion: number };
export type MahjongView = MahjongConfiguration & { table: TableView | null };
export type RoomView = SessionView<MahjongView>;
export type ServerMessage =
  | { type: 'snapshot'; view: RoomView; events: TableEvent[] }
  | { type: 'ack'; commandId: string }
  | { type: 'error'; message: string; commandId?: string };
export const membershipSchema = z.object({ roomId: roomIdSchema, token: seatToken });
export type Membership = z.infer<typeof membershipSchema>;
