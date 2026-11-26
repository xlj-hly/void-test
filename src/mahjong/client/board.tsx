import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import type { Action, RoomView } from '../protocol/messages';

const winds = ['东', '南', '西', '北'];
const honors = ['東', '南', '西', '北', '中', '發', '白'];
const kinds = ['萬', '条', '筒'];
type ButtonAction = Exclude<Action, { type: 'discard' | 'exchange' }>;
const actionNames: Record<ButtonAction['type'], string> = {
  chow: '吃', pong: '碰', kong: '明杠', 'concealed-kong': '暗杠', 'added-kong': '补杠',
  'choose-suit': '定缺', win: '胡', pass: '过',
};

function face(id: number): string {
  const kind = Math.floor(id / 4);
  return kind >= 27 ? honors[kind - 27] : `${kind % 9 + 1}${kinds[Math.floor(kind / 9)]}`;
}

function Tile(props: { id: number | null }) {
  return <span class="tile" classList={{ back: props.id === null }}>{props.id === null ? '' : face(props.id)}</span>;
}

export function Board(props: { room: RoomView; enabled: boolean; onAction(action: Action): void }) {
  const [now, setNow] = createSignal(Date.now());
  const [selected, setSelected] = createSignal<number[]>([]);
  onMount(() => { const timer = setInterval(() => setNow(Date.now()), 250); onCleanup(() => clearInterval(timer)); });
  const table = () => props.room.table!;
  createEffect(on(() => table().deadline, () => setNow(Date.now())));
  createEffect(on(() => table().decisionId, () => setSelected([])));
  const player = () => table().players[props.room.seat];
  const actions = () => table().actions.filter((action): action is ButtonAction => action.type !== 'discard' && action.type !== 'exchange');
  const discard = (id: number) => table().actions.find((action) => action.type === 'discard' && action.tiles[0] === id);
  const seconds = () => Math.max(0, Math.ceil(((table().deadline ?? now()) - now()) / 1000));
  const selectable = (id: number) => table().exchange?.groups.some((group) => group.includes(id)
    && selected().every((tile) => group.includes(tile))) ?? false;
  function selectTile(id: number) {
    if (selected().includes(id)) setSelected(selected().filter((tile) => tile !== id));
    else if (selected().length < 3 && selectable(id)) setSelected([...selected(), id]);
  }
  function exchange() {
    const [first, second, third] = selected();
    if (third !== undefined) props.onAction({ type: 'exchange', tiles: [first, second, third] });
  }
  const phaseLabel = () => {
    switch (table().phase) {
      case 'ended': return '本局结束';
      case 'exchange': return table().exchange ? '换三张' : '等待其他玩家换牌';
      case 'choose-suit': return actions().length ? '定缺' : '等待其他玩家定缺';
      case 'claim': return '等待响应';
      case 'turn': return `轮到${props.room.seats[table().turn].name}`;
    }
  };
  const winners = () => {
    const result = table().result;
    if (result?.kind === 'win') return [result];
    return result?.kind === 'blood' ? result.wins : [];
  };
  const settlementLabel = () => {
    const result = table().result;
    if (result?.kind === 'draw') return '流局';
    if (result?.kind === 'blood') return result.reason === 'wall-empty' ? '牌墙耗尽 · 结算' : '三家已胡 · 结算';
    return '和牌结算';
  };

  return <section class="play" aria-label="麻将牌桌">
    <div class="table-status" role="status">
      <span>牌墙 {table().wallRemaining}</span>
      <strong>{phaseLabel()}</strong>
      <span>{table().deadline === null ? '—' : `${seconds()} 秒`}</span>
    </div>
    <div class="felt">
      <For each={[2, 3, 1, 0]}>{(offset) => {
        const seat = () => (props.room.seat + offset) % props.room.capacity;
        const occupant = () => table().players[seat()];
        return <section class={`position position-${offset}`} aria-label={`${winds[seat()]}位`}>
          <div class="seat-label" classList={{ active: table().phase === 'turn' && table().turn === seat() }}>
            <span>{winds[seat()]}</span><strong>{props.room.seats[seat()].name}</strong>
            <Show when={offset !== 0}><small>{occupant().handCount} 张</small></Show>
            <Show when={occupant().missingSuit !== undefined}><small>缺{kinds[occupant().missingSuit!]}</small></Show>
            <Show when={occupant().won}><small>已胡</small></Show>
            <Show when={table().scores}><small>{table().scores![seat()]} 分</small></Show>
          </div>
          <div class="river"><For each={occupant().river}>{(id) => <Tile id={id} />}</For></div>
          <div class="groups"><For each={occupant().groups}>{(group) => <span><For each={group.tiles}>{(id) => <Tile id={id} />}</For></span>}</For></div>
        </section>;
      }}</For>
    </div>
    <Show when={table().pending}>{(value) => <p class="pending-discard">{props.room.seats[value().from].name} {value().kind === 'added-kong' ? '补杠' : '打出'} <Tile id={value().tile} /></p>}</Show>
    <Show when={actions().length > 0}>
      <div class="actions" aria-label="可用操作"><For each={actions()}>{(action) => <button disabled={!props.enabled} onClick={() => props.onAction(action)}>
        {actionNames[action.type]}{'tiles' in action ? ` ${action.tiles.map(face).join(' ')}` : ''}{action.type === 'choose-suit' ? ` ${kinds[action.suit]}` : ''}
      </button>}</For></div>
    </Show>
    <div class="hand" aria-label="我的手牌"><For each={player().hand ?? []}>{(id) => <button class="hand-tile"
      aria-label={`${table().phase === 'exchange' ? '选择' : '打出'}${face(id)}`}
      aria-pressed={table().phase === 'exchange' ? selected().includes(id) : undefined}
      disabled={!props.enabled || (table().phase === 'exchange'
        ? !selected().includes(id) && (selected().length === 3 || !selectable(id)) : !discard(id))}
      onClick={() => {
        if (table().phase === 'exchange') selectTile(id);
        else { const action = discard(id); if (action) props.onAction(action); }
      }}><Tile id={id} /></button>}</For></div>
    <Show when={table().exchange}><div class="actions"><button disabled={!props.enabled || selected().length !== 3} onClick={exchange}>
      确认换牌 {selected().length} / 3
    </button></div></Show>
    <Show when={table().result}>{(result) => <section class="settlement"><h2>{settlementLabel()}</h2>
      <For each={winners()}>{(win) => <p>{props.room.seats[win.winner].name} {win.from === null ? '自摸' : '点胡'}
          <Show when={win.fan !== undefined}> · {win.fan} 番</Show><Show when={win.patterns?.length}> · {win.patterns!.join('、')}</Show>
      </p>}</For>
      <ul><For each={result().scores}>{(score, index) => <li><span>{props.room.seats[index()].name}</span><strong>{score > 0 ? `+${score}` : score}</strong></li>}</For></ul>
    </section>}</Show>
  </section>;
}
