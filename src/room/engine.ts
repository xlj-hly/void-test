export type GameState = { data: unknown };
export type GameDecision<Move> = { seat: number; move: Move } | { timeout: true };
export type GameUpdate<Event> = { ok: true; state: unknown; events: Event[] } | { ok: false; message: string };

export interface Engine<Configuration extends object, Move, View extends object, Event> {
  configure(selection?: string): Configuration | undefined;
  capacity(configuration: Configuration): number;
  start(configuration: Configuration, players: number, now: number): GameUpdate<Event>;
  apply(configuration: Configuration, state: unknown, decision: GameDecision<Move>, now: number): GameUpdate<Event>;
  deadline(configuration: Configuration, state: unknown): number | null;
  viewFor(configuration: Configuration, game: GameState | null, seat: number): View;
}
