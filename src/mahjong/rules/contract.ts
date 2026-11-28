import type { Action, TableEvent, TableView } from '../protocol/messages';

export type Decision = { seat: number; decisionId: number; action: Action } | { timeout: true };
export type ShuffleInput = number | Uint32Array | ((size: number) => Uint32Array);
export type RuleUpdate<State> = { ok: true; state: State; events: TableEvent[] }
  | { ok: false; message: string };

export interface RulesetMetadata {
  id: string;
  name: string;
  version: number;
  seats: number;
}

export interface Rules<State> extends RulesetMetadata {
  start(random: ShuffleInput, now: number): State;
  apply(state: State, decision: Decision, now: number, shuffleInput?: () => ShuffleInput): RuleUpdate<State>;
  viewFor(state: State, seat: number): TableView;
  deadline(state: State): number | null;
}

export function register<State>(rules: Rules<State>): Rules<unknown> {
  // The engine resolves the saved ruleset version before passing state to its implementation.
  return {
    ...rules,
    apply: (state, decision, now, shuffleInput) => rules.apply(state as State, decision, now, shuffleInput),
    viewFor: (state, seat) => rules.viewFor(state as State, seat),
    deadline: (state) => rules.deadline(state as State),
  };
}
