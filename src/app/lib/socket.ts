import { io } from 'socket.io-client';

export const socket = io('http://localhost:3001', {
  transports: ['websocket'],
  autoConnect: false,
  reconnection: true,
});

export function ensureConnected(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    const ok = () => { cleanup(); resolve(); };
    const err = (e: any) => { cleanup(); reject(e); };
    const cleanup = () => {
      socket.off('connect', ok);
      socket.off('connect_error', err);
    };
    socket.once('connect', ok);
    socket.once('connect_error', err);
    socket.connect();
  });
}

type JoinRoomOk = {
  ok: true;
  color: 'white' | 'black';
  currentTurn: 'w' | 'b';

  fen: string;
  extra: { w: number; b: number };
  shield: { by: 'w' | 'b' | null; square: string | null };
  cardPlayedBy: 'w' | 'b' | null;
};

type JoinRoomErr = { ok: false; reason: string };

export async function joinRoom(roomId: string): Promise<JoinRoomOk | JoinRoomErr> {
  await ensureConnected();
  return new Promise((resolve) => {
    socket.emit('joinRoom', roomId, (res: any) => {
      if (res?.ok) {
        resolve({
          ok: true,
          color: res.color,
          currentTurn: res.currentTurn,
          fen: res.fen,
          extra: res.extra,
          shield: res.shield,
          cardPlayedBy: res.cardPlayedBy,
        });
      } else {
        resolve({ ok: false, reason: res?.reason || 'join-failed' });
      }
    });
  });
}

export async function createRoom(): Promise<{ ok: boolean; roomId?: string; reason?: string }> {
  await ensureConnected();
  return new Promise((resolve) => {
    socket.emit('createRoom', (res: any) => {
      if (res?.ok) resolve({ ok: true, roomId: res.roomId });
      else resolve({ ok: false, reason: res?.reason || 'create-failed' });
    });
  });
}
