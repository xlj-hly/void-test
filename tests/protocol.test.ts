import { describe, expect, it } from 'vite-plus/test';
import { actionSchema, clientMessageSchema } from '../src/mahjong/protocol/messages';
import { nameSchema, roomIdLength, roomIdSchema } from '../src/room/http';

describe('房间消息校验', () => {
  it('校验昵称、房间编号和客户端命令', () => {
    expect(nameSchema.parse({ name: ' 东 ' })).toEqual({ name: '东' });
    expect(nameSchema.safeParse({ name: ' ', seat: 0 }).success).toBe(false);
    expect(roomIdSchema.safeParse('A'.repeat(roomIdLength)).success).toBe(true);
    expect(roomIdSchema.safeParse('foobar').success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'resume', token: 'invalid' }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'act', commandId: crypto.randomUUID(), decisionId: 1, action: { type: 'discard', tiles: [0] }, seat: 0 }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'discard', tiles: [136] }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'discard', tiles: [0, 1] }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'choose-suit', suit: 3 }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'exchange', tiles: [0, 1, 2] }).success).toBe(true);
  });
});
