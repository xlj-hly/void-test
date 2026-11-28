import type { Engine } from '../room/engine';
import type { MahjongConfiguration, MahjongMove, MahjongView, TableEvent } from './protocol/messages';
import type { ShuffleInput } from './rules/contract';
import { rulesets, type createRulesetRegistry } from './rules/registry';

export function createMahjongEngine(
  shuffleInput: () => ShuffleInput,
  registry: ReturnType<typeof createRulesetRegistry> = rulesets,
): Engine<MahjongConfiguration, MahjongMove, MahjongView, TableEvent> {
  function resolve({ rulesetId, rulesetVersion }: MahjongConfiguration) {
    const rules = registry.get(rulesetId, rulesetVersion);
    if (!rules) throw new Error('房间保存的规则版本不可用');
    return rules;
  }

  return {
    configure(id) {
      const rules = id === undefined ? registry.defaultRule : registry.getCurrent(id);
      if (rules) return { rulesetId: rules.id, rulesetVersion: rules.version };
    },
    capacity: (configuration) => resolve(configuration).seats,
    start(configuration, players, now) {
      const rules = resolve(configuration);
      if (players !== rules.seats) return { ok: false, message: '需要满员且尚未开局' };
      return { ok: true, state: rules.start(shuffleInput(), now), events: [] };
    },
    apply: (configuration, state, decision, now) => resolve(configuration).apply(
      state, 'move' in decision ? { seat: decision.seat, ...decision.move } : decision, now, shuffleInput,
    ),
    deadline: (configuration, state) => resolve(configuration).deadline(state),
    viewFor(configuration, game, seat) {
      const rules = resolve(configuration);
      return { rulesetId: rules.id, rulesetVersion: rules.version, table: game ? rules.viewFor(game.data, seat) : null };
    },
  };
}
