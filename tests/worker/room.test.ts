import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';
import WebSocket from 'ws';
import type { Action, ClientMessage, Membership, RoomView, ServerMessage } from '../../src/mahjong/protocol/messages';
import { roomIdLength } from '../../src/room/http';
import { startWorker } from './setup';

type Snapshot = Extract<ServerMessage, { type: 'snapshot' }>;
let base: string;
const connections = new Set<WebSocket>();

class Client {
  readonly socket: WebSocket;
  private inbox: ServerMessage[] = [];
  constructor(roomId: string, origin = base) {
    this.socket = new WebSocket(`${base.replace(/^http/, 'ws')}/api/rooms/${roomId}/socket`, { origin });
    connections.add(this.socket);
    this.socket.on('message', (raw) => this.inbox.push(JSON.parse(raw.toString())));
    this.socket.on('error', () => {});
  }
  async opened() {
    await expect.poll(() => this.socket.readyState).toBe(WebSocket.OPEN);
  }
  send(message: ClientMessage) { this.socket.send(JSON.stringify(message)); }
  async take<T extends ServerMessage>(predicate: (message: ServerMessage) => message is T, timeout = 4000): Promise<T> {
    let index = -1;
    await expect.poll(() => { index = this.inbox.findIndex(predicate); return index; }, { timeout, interval: 15 }).toBeGreaterThanOrEqual(0);
    return this.inbox.splice(index, 1)[0] as T;
  }
  snapshot(revision = 0, timeout?: number) {
    return this.take((message): message is Snapshot => message.type === 'snapshot' && message.view.revision > revision, timeout);
  }
  reply(commandId: string) {
    return this.take((message): message is Exclude<ServerMessage, Snapshot> => message.type !== 'snapshot' && message.commandId === commandId);
  }
  close() { this.socket.close(); }
}

afterEach(() => { for (const socket of connections) socket.terminate(); connections.clear(); });

async function post(path: string, name: string, rulesetId?: string) {
  const body = path === '/api/rooms' ? { name, gameType: 'mahjong', rulesetId } : { name };
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function membership(path: string, name: string, expected: number, rulesetId?: string) {
  const response = await post(path, name, rulesetId);
  expect(response.status, await response.clone().text()).toBe(expected);
  return await response.json() as Membership;
}

async function resume(session: Membership) {
  const client = new Client(session.roomId);
  await client.opened();
  client.send({ type: 'resume', token: session.token });
  return { client, view: (await client.snapshot()).view };
}

async function fullRoom(rulesetId?: string) {
  const host = await membership('/api/rooms', '东', 200, rulesetId);
  const sessions = [host];
  for (const name of ['南', '西', '北']) sessions.push(await membership(`/api/rooms/${host.roomId}/join`, name, 200));
  const peers = await Promise.all(sessions.map(resume));
  return { host, sessions, peers };
}

async function start(peers: Awaited<ReturnType<typeof fullRoom>>['peers']) {
  const commandId = randomUUID();
  peers[0].client.send({ type: 'start', commandId });
  expect(await peers[0].client.reply(commandId)).toMatchObject({ type: 'ack' });
  return Promise.all(peers.map(async ({ client, view }) => (await client.snapshot(view.revision)).view));
}

async function act(peers: Awaited<ReturnType<typeof fullRoom>>['peers'], views: RoomView[], seat: number, action: Action) {
  const commandId = randomUUID();
  peers[seat].client.send({ type: 'act', commandId, decisionId: views[seat].table!.decisionId, action });
  expect(await peers[seat].client.reply(commandId)).toEqual({ type: 'ack', commandId });
  return Promise.all(peers.map(async ({ client }, owner) => (await client.snapshot(views[owner].revision)).view));
}

describe('真实 Void Worker 与四人 WebSocket', () => {
  beforeAll(async () => {
    const worker = await startWorker();
    base = worker.url;
    return worker.close;
  });

  it('先展示游戏，再选玩法，最后展示房间表单', async () => {
    const page = await fetch(base);
    expect(page.status).toBe(200);
    const home = await page.text();
    expect(home).toContain('href="/games/mahjong"');
    expect(home).not.toContain('四川麻将');
    const lobby = await fetch(`${base}/games/mahjong`);
    expect(lobby.status).toBe(200);
    const html = await lobby.text();
    expect(html).toContain('基础麻将');
    expect(html).toContain('四川麻将 · 血战到底');
    expect(html).toContain('广东麻将 · 鸡平胡（无花）');
    expect(html).not.toContain('创建房间');
    const selected = await (await fetch(`${base}/games/mahjong?ruleset=sichuan`)).text();
    expect(selected).toContain('创建房间');
    expect(selected).toContain('加入房间');
    const roomId = 'A'.repeat(roomIdLength);
    const legacyInvite = await fetch(`${base}/?room=${roomId}`, { redirect: 'manual' });
    expect(legacyInvite.headers.get('location')).toBe(`/games/mahjong?room=${roomId}`);
    const invite = await (await fetch(`${base}/games/mahjong?room=${roomId}`)).text();
    expect(invite).toContain(`value="${roomId}"`);
    expect(invite).toContain('加入房间');
    expect(invite).not.toContain('创建房间');
  });

  it('校验客户端指定的游戏与玩法组合', async () => {
    for (const body of [{ name: '东' }, { name: '东', gameType: 'gomoku', rulesetId: 'sichuan' }]) {
      const response = await fetch(`${base}/api/rooms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    const invalidRuleset = await post('/api/rooms', '东', 'unregistered');
    expect(invalidRuleset.status).toBe(400);
    expect(await invalidRuleset.json()).toEqual({ message: '玩法不可用' });
  });

  it('验证入座、房间隔离、身份、重连、重复动作和完整结算', async () => {
    const { host, sessions, peers } = await fullRoom();
    const separateSession = await membership('/api/rooms', '另一桌', 200);
    const separate = await resume(separateSession);
    expect(separate.view.roomId).not.toBe(host.roomId);
    expect(separate.view.seats).toEqual([{ name: '另一桌' }]);
    expect(await post(`/api/rooms/${host.roomId}/join`, '第五位')).toHaveProperty('status', 409);
    expect(await post('/api/rooms', '  ')).toHaveProperty('status', 400);
    expect(await post(`/api/rooms/${'0'.repeat(roomIdLength)}/join`, '访客')).toHaveProperty('status', 404);
    expect(await fetch(`${base}/api/rooms/${host.roomId}/socket`)).toHaveProperty('status', 426);

    const unauthorized = new Client(host.roomId);
    await unauthorized.opened();
    const rejected = new Promise<number>((resolve) => unauthorized.socket.once('close', resolve));
    unauthorized.send({ type: 'resume', token: separateSession.token });
    expect(await rejected).toBe(1008);

    const nonHost = randomUUID();
    peers[1].client.send({ type: 'start', commandId: nonHost });
    expect(await peers[1].client.reply(nonHost)).toMatchObject({ type: 'error' });
    let views = await start(peers);
    for (const [seat, view] of views.entries()) {
      expect(view.seat).toBe(seat);
      expect(view.table?.players.map((player) => player.hand?.length)).toEqual(
        [0, 1, 2, 3].map((owner) => owner === seat ? owner === 0 ? 14 : 13 : undefined),
      );
      expect(JSON.stringify(view)).not.toContain(sessions[seat].token);
    }

    peers[2].client.close();
    const recovered = await resume(sessions[2]);
    expect(recovered.view).toEqual(views[2]);
    peers[2] = recovered;
    const first = views[0].table!;
    const discard = first.actions.find((action) => action.type === 'discard')!;
    const command: ClientMessage = { type: 'act', commandId: randomUUID(), decisionId: first.decisionId, action: discard };
    peers[0].client.send(command);
    peers[0].client.send(command);
    expect(await peers[0].client.reply(command.commandId)).toMatchObject({ type: 'ack' });
    expect(await peers[0].client.reply(command.commandId)).toMatchObject({ type: 'ack' });
    const latest = await Promise.all(peers.map(({ client }, seat) => client.snapshot(views[seat].revision)));
    expect(latest[0].view.revision).toBe(views[0].revision + 1);
    expect(latest[0].events[0]).toMatchObject({ type: 'discard', seat: 0 });
    const stale = { ...command, commandId: randomUUID() };
    peers[0].client.send(stale);
    expect(await peers[0].client.reply(stale.commandId)).toMatchObject({ type: 'error' });
    views = latest.map((item) => item.view);

    for (let step = 0; views[0].table?.phase !== 'ended' && step < 430; step++) {
      const seat = views.findIndex((view) => view.table!.actions.length > 0);
      expect(seat).toBeGreaterThanOrEqual(0);
      const table = views[seat].table!;
      const action = table.actions.find((candidate) => candidate.type === 'win')
        ?? table.actions.find((candidate) => candidate.type === 'discard' || candidate.type === 'pass')!;
      peers[seat].client.send({ type: 'act', commandId: randomUUID(), decisionId: table.decisionId, action });
      views = await Promise.all(peers.map(async ({ client }, owner) => (await client.snapshot(views[owner].revision)).view));
    }
    expect(views[0].table?.phase).toBe('ended');
    const result = views[0].table!.result!;
    expect(result.scores.reduce((sum, score) => sum + score, 0)).toBe(0);
    for (const view of views) expect(view.table?.result).toEqual(result);
    expect((await resume(sessions[0])).view.table?.result).toEqual(result);
  });

  it('没有客户端发动作时通过真实 Durable Object Alarm 推进', async () => {
    const { peers } = await fullRoom();
    const [before] = await start(peers);
    const after = await peers[0].client.snapshot(before.revision, 38_000);
    expect(after.events[0]).toMatchObject({ type: 'discard', seat: 0 });
    expect(after.view.table?.decisionId).toBeGreaterThan(before.table!.decisionId);
  });

  it.each(['sichuan', 'guangdong'])('跨 HTTP、WebSocket 与恢复验证 %s 对局', async (rulesetId) => {
    expect(await post('/api/rooms', '未知玩法', 'unknown')).toHaveProperty('status', 400);
    const { peers, sessions } = await fullRoom(rulesetId);
    let views = await start(peers);
    expect(views.map((view) => view.rulesetId)).toEqual(Array(4).fill(rulesetId));
    const isGuangdong = rulesetId === 'guangdong';
    expect(views.map((view) => view.rulesetVersion)).toEqual(Array(4).fill(1));
    expect(views[0].table?.wallRemaining).toBe(rulesetId === 'sichuan' ? 55 : 83);
    const initialDealer = views[0].table!.turn;
    if (isGuangdong) {
      for (const [seat, view] of views.entries()) {
        expect(view.table?.round).toEqual({ dealer: initialDealer, wind: 0, hand: 1, complete: false });
        expect(view.table?.players[seat].hand).toHaveLength(seat === initialDealer ? 14 : 13);
      }
    }
    if (rulesetId === 'sichuan') {
      expect(views[0].table?.phase).toBe('exchange');
      const window = views[0].table!.decisionId;
      for (const seat of [0, 2, 1, 3]) {
        expect(views[seat].table!.decisionId).toBe(window);
        const [a, b, c] = views[seat].table!.exchange!.groups[0];
        views = await act(peers, views, seat, { type: 'exchange', tiles: [a, b, c] });
        if (seat === 0) {
          peers[seat].client.close();
          peers[seat] = await resume(sessions[seat]);
          expect(peers[seat].view.table?.exchange).toBeUndefined();
          expect(peers[seat].view.table?.decisionId).toBe(window);
        }
      }
      expect(views[0].table?.phase).toBe('choose-suit');
      views = await act(peers, views, 0, { type: 'choose-suit', suit: 0 });
      expect(views[1].table?.players[0].missingSuit).toBeUndefined();
      for (const seat of [1, 2, 3]) views = await act(peers, views, seat, { type: 'choose-suit', suit: 2 });
      expect(views[1].table?.players[0].missingSuit).toBe(0);
    }
    expect(views[0].table?.phase).toBe('turn');
    for (let step = 0; views[0].table?.phase !== 'ended' && step < 430; step++) {
      const seat = views.findIndex((view) => view.table!.actions.length);
      expect(seat).toBeGreaterThanOrEqual(0);
      const actions = views[seat].table!.actions;
      const win = isGuangdong ? undefined : actions.find(({ type }) => type === 'win');
      const action = win ?? actions.find(({ type }) => type === 'discard' || type === 'pass');
      expect(action).toBeDefined();
      views = await act(peers, views, seat, action!);
    }
    const result = views[0].table?.result;
    expect(views[0].table?.phase).toBe('ended');
    expect(result?.scores.reduce((sum, score) => sum + score, 0)).toBe(0);
    expect(views.every((view) => JSON.stringify(view.table?.result) === JSON.stringify(result))).toBe(true);
    expect((await resume(sessions[1])).view.table?.result).toEqual(result);
    if (isGuangdong) {
      expect(result).toEqual({ kind: 'draw', scores: [0, 0, 0, 0] });
      const ended = views[0].table!;
      const nextHand = { type: 'next-hand' } as const;
      expect(ended.actions).toContainEqual(nextHand);
      expect(views[1].table!.actions).toEqual([]);
      const unauthorized = { type: 'act', action: nextHand, decisionId: ended.decisionId, commandId: randomUUID() } as const;
      peers[1].client.send(unauthorized);
      expect(await peers[1].client.reply(unauthorized.commandId)).toMatchObject({ type: 'error' });

      views = await act(peers, views, 0, nextHand);
      const next = views[0].table!;
      expect(next).toMatchObject({ phase: 'turn', turn: initialDealer, wallRemaining: 83, result: null,
        round: { dealer: initialDealer, wind: 0, hand: 1, complete: false }, scores: [0, 0, 0, 0] });
      expect(next.decisionId).toBeGreaterThan(ended.decisionId);
      const stale = { ...unauthorized, commandId: randomUUID() };
      peers[0].client.send(stale);
      expect(await peers[0].client.reply(stale.commandId)).toMatchObject({ type: 'error' });
      expect((await resume(sessions[0])).view.table).toEqual(next);
    }
  });
});
