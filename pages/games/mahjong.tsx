import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { fetch as apiFetch, FetchError } from 'void/client';
import { Board } from '../../src/mahjong/client/board';
import { membershipSchema, type Action, type ClientMessage, type Membership, type RoomView, type ServerMessage } from '../../src/mahjong/protocol/messages';
import { roomIdLength } from '../../src/room/http';
import type { Props } from './mahjong.server';
import '../style.css';

const storageKey = 'mahjong-membership-v1';
const rulesetTiles: Record<string, string> = { basic: '東', sichuan: '萬', guangdong: '發' };

function storeMembership(roomId: string, membership?: Membership) {
  const key = `${storageKey}:${roomId}`;
  try {
    if (membership) sessionStorage.setItem(key, JSON.stringify(membership));
    else sessionStorage.removeItem(key);
  } catch { /* The current connection can still use the seat token in memory. */ }
}

function readMembership(roomId: string) {
  try {
    const stored = sessionStorage.getItem(`${storageKey}:${roomId}`);
    if (stored === null) return;
    const parsed = membershipSchema.safeParse(JSON.parse(stored));
    if (parsed.success && parsed.data.roomId === roomId) return parsed.data;
  } catch { /* The page can still enter a room without a cached seat. */ }
  storeMembership(roomId);
}

export default function MahjongPage(props: Props) {
  const [name, setName] = createSignal('');
  const [roomCode, setRoomCode] = createSignal(props.roomCode);
  const [invited, setInvited] = createSignal(Boolean(props.roomCode));
  const selected = () => props.rulesets.find(({ id }) => id === props.selectedRulesetId);
  const [membership, setMembership] = createSignal<Membership>();
  const [view, setView] = createSignal<RoomView>();
  const [connection, setConnection] = createSignal<'connecting' | 'ready' | 'offline'>('connecting');
  const [busy, setBusy] = createSignal(false);
  const [pending, setPending] = createSignal<string>();
  const [error, setError] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  let socket: WebSocket | undefined;

  onMount(() => {
    if (props.roomCode) setMembership(readMembership(props.roomCode));
  });

  function forgetSeat(roomId: string) {
    storeMembership(roomId);
    setRoomCode(roomId);
    setInvited(true);
    setMembership(undefined);
    setView(undefined);
    setPending(undefined);
    setError('');
    setCopied(false);
  }

  createEffect(on(membership, (session) => {
    if (!session) return;
    const { roomId, token } = session;
    const url = new URL(`/api/rooms/${roomId}/socket`, location.origin);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;
    let backoff = 500;
    function connect() {
      setConnection('connecting');
      const active = new WebSocket(url);
      socket = active;
      active.onopen = () => active.send(JSON.stringify({ type: 'resume', token }));
      active.onmessage = ({ data }) => {
        if (closed) return;
        const message = JSON.parse(data) as ServerMessage;
        if (message.type === 'snapshot') {
          setView((current) => !current || message.view.revision >= current.revision ? message.view : current);
          if (connection() !== 'ready') setError('');
          setConnection('ready');
          backoff = 500;
        } else {
          if (message.commandId === pending()) setPending(undefined);
          if (message.type === 'error') {
            setError(message.message);
            if (connection() === 'connecting' && !message.commandId) active.close();
          }
        }
      };
      active.onclose = (event) => {
        if (closed) return;
        setPending(undefined);
        setConnection('offline');
        if (event.code === 1008) {
          forgetSeat(roomId);
          setError('座位凭证已失效，请重新加入');
          return;
        }
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 5000);
      };
    }
    connect();
    onCleanup(() => { closed = true; clearTimeout(retry); socket?.close(); });
  }));

  async function enter(join: boolean) {
    if (busy() || !name().trim()) return;
    const rulesetId = selected()?.id;
    if (join ? roomCode().length !== roomIdLength : !rulesetId) return;
    setBusy(true);
    setError('');
    try {
      const body = { name: name().trim() };
      const roomId = roomCode();
      const response: Membership = join
        ? readMembership(roomId) ?? await apiFetch('/api/rooms/[roomId]/join', { method: 'POST', params: { roomId }, body })
        : await apiFetch('/api/rooms', { method: 'POST', body: { ...body, gameType: props.gameType, rulesetId } });
      const url = new URL(location.href);
      url.searchParams.set('room', response.roomId);
      history.replaceState(null, '', url);
      setMembership(response);
      storeMembership(response.roomId, response);
    } catch (cause) {
      if (cause instanceof FetchError && cause.status === 404) setError('找不到这个房间');
      else if (cause instanceof FetchError && cause.status === 409) setError('房间已满或已经开局');
      else setError('暂时无法进入，请检查房间码或重试');
    } finally { setBusy(false); }
  }

  function send(action?: Action) {
    const table = view()?.table;
    if (connection() !== 'ready' || pending() || socket?.readyState !== WebSocket.OPEN) return;
    if (action && !table) return;
    const commandId = crypto.randomUUID();
    const message: ClientMessage = action
      ? { type: 'act', commandId, decisionId: table!.decisionId, action }
      : { type: 'start', commandId };
    setError('');
    setPending(commandId);
    socket.send(JSON.stringify(message));
  }

  async function share() {
    try {
      const invite = new URL('/games/mahjong', location.origin);
      invite.searchParams.set('room', membership()!.roomId);
      await navigator.clipboard.writeText(invite.href);
      setCopied(true);
    } catch { setError('复制失败，可从地址栏复制邀请链接'); }
  }

  return (
    <main class="hall">
      <header class="masthead"><a class="brand" href="/">四方牌桌</a><span>麻将大厅</span></header>
      <Show when={membership()} fallback={
        <Show when={selected() || invited()} fallback={
          <section class="catalog">
            <a class="back-link" href="/">‹ 游戏大厅</a>
            <h1>选择玩法</h1>
            <ul class="catalog-grid">
              <For each={props.rulesets}>{(rule) => <li>
                <a class="catalog-card ruleset-card" href={`/games/mahjong?ruleset=${encodeURIComponent(rule.id)}`}>
                  <span class="tile catalog-tile" aria-hidden="true">{rulesetTiles[rule.id] ?? '中'}</span>
                  <strong>{rule.name}</strong>
                  <small>{rule.seats} 人桌</small>
                </a>
              </li>}</For>
            </ul>
          </section>
        }>
          <section class="lobby room-entry">
            <a class="back-link" href="/games/mahjong">‹ 选择玩法</a>
            <h1>{selected()?.name ?? '加入好友房'}</h1>
            <form onSubmit={(event) => { event.preventDefault(); void enter(true); }}>
              <label>昵称<input maxlength={16} value={name()} onInput={(event) => setName(event.currentTarget.value)} autocomplete="nickname" required /></label>
              <label>房间码<input maxlength={roomIdLength} value={roomCode()} onInput={(event) => setRoomCode(event.currentTarget.value.replace(/[^a-f\d]/gi, '').toUpperCase())} autocomplete="off" spellcheck={false} /></label>
              <div class="controls">
                <Show when={selected()}>
                  <button type="button" disabled={busy() || !name().trim()} onClick={() => void enter(false)}>创建房间</button>
                </Show>
                <button type="submit" classList={{ quiet: Boolean(selected()) }} disabled={busy() || !name().trim() || roomCode().length !== roomIdLength}>加入房间</button>
              </div>
            </form>
          </section>
        </Show>
      }>
        <section class="room-head">
          <div><span class="label">房间码</span><strong>{membership()!.roomId}</strong>
            <Show when={view()}>{(room) => <span class="label">{props.rulesets.find(({ id }) => id === room().rulesetId)?.name ?? room().rulesetId}</span>}</Show>
          </div>
          <div class="controls"><button class="quiet" onClick={() => void share()}>{copied() ? '已复制' : '复制邀请链接'}</button>
            <a class="back-link" href="/games/mahjong">返回大厅</a></div>
        </section>
        <Show when={connection() !== 'ready'}><p class="status" role="status">{connection() === 'offline' ? '连接中断，正在重连' : '正在连接牌桌'}</p></Show>
        <Show when={view()}>
          {(room) => <Show when={room().table} fallback={
            <section class="waiting"><h1>等待入座 <small>{room().seats.length} / {room().capacity}</small></h1>
              <ol class="waiting-seats"><For each={['东', '南', '西', '北']}>{(wind, seat) => <li><span>{wind}</span><strong>{room().seats[seat()]?.name ?? '空座'}</strong></li>}</For></ol>
              <Show when={room().seat === room().owner}><button disabled={room().seats.length !== room().capacity || connection() !== 'ready' || Boolean(pending())} onClick={() => send()}>开局</button></Show>
            </section>
          }>
            <Board room={room()} enabled={connection() === 'ready' && !pending()} onAction={send} />
          </Show>}
        </Show>
      </Show>
      <Show when={error()}><p class="error" role="alert">{error()}</p></Show>
    </main>
  );
}
