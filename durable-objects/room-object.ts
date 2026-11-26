import { DurableObject } from 'cloudflare:workers';
import { defineDurableObject } from 'void/durable';
import { roomGames } from '../src/game-registry';
import type { RoomServerMessage, RoomSession, RoomSnapshot } from '../src/room/game-adapter';
import type { RoomCreateResult, RoomRecord } from '../src/room/session';

const roomKey = 'room';
const gameTypeKey = 'game-type';
type Attachment = { seat: number };

class RoomObject extends DurableObject {
  private session?: RoomSession;

  private open(gameType: string) {
    return roomGames.get(gameType)?.openRoom({
      load: <Configuration extends object>() => this.ctx.storage.get<RoomRecord<Configuration>>(roomKey),
      save: (record, alarm) => this.ctx.storage.transaction(async (storage) => {
        await storage.put(roomKey, record);
        await storage.put(gameTypeKey, gameType);
        if (alarm === null) await storage.deleteAlarm();
        else await storage.setAlarm(alarm);
      }),
      now: () => Date.now(),
      publish: (snapshotFor) => this.publish(snapshotFor),
    });
  }

  private async restoreRoom() {
    if (this.session) return this.session;
    const gameType = await this.ctx.storage.get<string>(gameTypeKey);
    // Rooms created before game types were stored all ran Mahjong.
    const selected = gameType ?? (await this.ctx.storage.get(roomKey) ? 'mahjong' : undefined);
    if (selected === undefined) return;
    const session = this.session ??= this.open(selected);
    if (!session) throw new Error(`Unregistered game type: ${selected}`);
    return session;
  }

  create(roomId: string, name: string, token: string, gameType: string, selection?: string) {
    return this.ctx.blockConcurrencyWhile(async (): Promise<RoomCreateResult | 'invalid-game'> => {
      if (this.session) return 'conflict';
      const session = this.open(gameType);
      if (!session) return await this.ctx.storage.get(roomKey) ? 'conflict' : 'invalid-game';
      const result = await session.room.create(roomId, name, token, selection);
      if (result === 'created') this.session = session;
      return result;
    });
  }

  async join(name: string, token: string) {
    const session = await this.restoreRoom();
    return session ? session.room.join(name, token) : { status: 404, message: '房间不存在' } as const;
  }

  async fetch(request: Request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    if (this.ctx.getWebSockets().length >= 32) return new Response('Too many connections', { status: 429 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, frame: string | ArrayBuffer) {
    if (typeof frame !== 'string' || frame.length > 2048) {
      socket.close(1009, 'Invalid frame');
      return;
    }
    let raw: unknown;
    try { raw = JSON.parse(frame); } catch { raw = null; }
    let commandId: string | undefined;
    try {
      const session = await this.restoreRoom();
      if (!session) return socket.close(1008, 'Room not found');
      const message = session.decodeMessage(raw);
      if (!message) return send(socket, { type: 'error', message: '无效消息' });
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (message.type === 'resume') {
        if (attachment) return send(socket, { type: 'error', message: '连接已入座' });
        const view = await session.room.resume(message.token, (snapshot) => {
          if (socket.deserializeAttachment()) return;
          socket.serializeAttachment({ seat: snapshot.seat } satisfies Attachment);
          send(socket, { type: 'snapshot', view: snapshot, events: [] });
        });
        if (!view) return socket.close(1008, 'Invalid seat credentials');
        return;
      }
      if (!attachment) return socket.close(1008, 'Seat credentials required');
      commandId = message.commandId;
      send(socket, await message.run(attachment.seat));
    } catch (error) {
      console.error('Room operation failed:', error);
      send(socket, { type: 'error', message: '房间暂时不可用，请重试', commandId });
    }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string) {
    if (socket.readyState !== WebSocket.CLOSED) {
      if (code === 1005 || code === 1006 || code === 1015) socket.close();
      else socket.close(code, reason);
    }
  }

  async alarm() {
    const session = await this.restoreRoom();
    await session?.room.tick();
  }

  private publish(snapshotFor: (seat: number) => RoomSnapshot) {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (attachment) send(socket, snapshotFor(attachment.seat));
    }
  }
}

function send(socket: WebSocket, message: RoomServerMessage) {
  if (socket.readyState !== WebSocket.OPEN) return;
  try { socket.send(JSON.stringify(message)); } catch { /* The next connection requests a fresh snapshot. */ }
}

// Keep the resource name so Cloudflare resolves existing room IDs to the same storage.
export const GameRoom = defineDurableObject({ name: 'mahjong-room', class: RoomObject });
export default GameRoom;
