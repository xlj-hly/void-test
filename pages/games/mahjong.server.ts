import { defineHandler, defineHead, type InferProps } from 'void';
import { rulesets } from '../../src/mahjong/rules/registry';
import { roomIdSchema } from '../../src/room/http';

export const loader = defineHandler((c) => {
  const room = roomIdSchema.safeParse(c.req.query('room')?.toUpperCase());
  const selection = c.req.query('ruleset');
  return {
    gameType: 'mahjong',
    rulesets: rulesets.catalog(),
    selectedRulesetId: selection && rulesets.getCurrent(selection) ? selection : null,
    roomCode: room.success ? room.data : '',
  };
});

export type Props = InferProps<typeof loader>;

export const head = defineHead(() => ({
  title: '麻将大厅 | 四方牌桌',
}));
