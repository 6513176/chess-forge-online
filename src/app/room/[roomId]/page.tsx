'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { joinRoom, socket } from '@/app/lib/socket';

type CardId = 'BUFF_EXTRA_MOVE' | 'DEF_SHIELD' | 'COUNTER_SACRIFICE';
type Card = { id: CardId; name: string; desc: string; playNeedsTargetSquare?: boolean };

// ใบจริงในมือ (client จะใช้ข้อมูลจาก server + map หา name/desc)
type CardInstance = Card & { uid: string };

const CARD_DEFS: Card[] = [
  { id: 'BUFF_EXTRA_MOVE',    name: 'FORGE',     desc: 'ได้เดินเพิ่มอีก 1 ครั้งในเทิร์นนี้' },
  { id: 'DEF_SHIELD',         name: 'SHEILD',    desc: 'กันชิ้นที่เลือกไม่ให้โดนกิน 1 เทิร์น', playNeedsTargetSquare: true },
  { id: 'COUNTER_SACRIFICE',  name: 'SACRIFICE', desc: 'ตายแทน” (1 ครั้ง)' },
];

const CARD_MAP: Record<CardId, Card> = {
  BUFF_EXTRA_MOVE:    CARD_DEFS[0],
  DEF_SHIELD:         CARD_DEFS[1],
  COUNTER_SACRIFICE:  CARD_DEFS[2],
};

// map จาก {id, uid} ที่ได้จาก server → CardInstance ที่มี name/desc
function fromServerCard(raw: { id: CardId; uid: string }): CardInstance {
  const def = CARD_MAP[raw.id];
  return { ...def, uid: raw.uid };
}

// เวลาเริ่มต้นต่อฝั่ง (ต้องให้ server ใช้ค่าเดียวกันด้วย)
const INITIAL_TIME = 300; // 300 วินาที = 5 นาที

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();

  // --- game states ---
  const gameRef = useRef(new Chess());
  const [fen, setFen] = useState(gameRef.current.fen());
  const [turn, setTurn] = useState<'w' | 'b'>('w');
  const [color, setColor] = useState<'white' | 'black' | null>(null);

  const [isOver, setIsOver] = useState(false);
  const [result, setResult] = useState<{ type: string; winner?: 'w' | 'b' } | null>(null);
  const [checkSide, setCheckSide] = useState<'w' | 'b' | null>(null);

  // restart state
  const [now, setNow] = useState<number>(Date.now());
  const [restartVotes, setRestartVotes] = useState<Set<'w' | 'b'>>(new Set());
  const [restartCounting, setRestartCounting] = useState(false);
  const [restartStartedAt, setRestartStartedAt] = useState<number | null>(null);
  const [restartDuration, setRestartDuration] = useState<number>(5);

  // clock จาก server
  const [timeLeft, setTimeLeft] = useState<{ w: number; b: number }>({
    w: INITIAL_TIME, // เดี๋ยว joinRoom จะทับด้วยค่าจริงจาก server
    b: INITIAL_TIME,
  });
  const [clockRunning, setClockRunning] = useState<'w' | 'b' | null>(null);

  // เวลาก่อนรีเซ็ต
  const remain =
    restartCounting && restartStartedAt
      ? Math.max(0, restartDuration - Math.floor((now - restartStartedAt) / 1000))
      : 0;

  // --- card states/overlays ---
  const [extraMove, setExtraMove] = useState<{ w: number; b: number }>({ w: 0, b: 0 });
  const [shield, setShield] = useState<{ by: null | 'w' | 'b'; square: null | string }>({
    by: null,
    square: null,
  });
  const [hand, setHand] = useState<CardInstance[]>([]);
  const [cardPlayedBy, setCardPlayedBy] = useState<'w' | 'b' | null>(null);

  // overlays
  const [selectingShield, setSelectingShield] = useState(false);
  const [shieldCardUid, setShieldCardUid] = useState<string | null>(null);
  const [selectingCounterSac, setSelectingCounterSac] = useState(false);
  const [counterCardUid, setCounterCardUid] = useState<string | null>(null);

  // chat
  const [chat, setChat] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  // tick สำหรับ countdown (ใช้เฉพาะ restart modal)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // ❌ ไม่ต้องแจกการ์ดเริ่มต้นฝั่ง client แล้ว
  // server เป็นคนแจกผ่าน res.hand + card:hand

  // join room + socket listeners
  useEffect(() => {
    let mounted = true;

    (async () => {
      const res: any = await joinRoom(String(roomId));
      if (!mounted) return;
      if (!res.ok) {
        alert('เข้าห้องไม่ได้: ' + (res.reason ?? 'unknown'));
        return;
      }

      // reset UI flags
      setIsOver(false);
      setCheckSide(null);

      setColor(res.color!);
      if (res.currentTurn) setTurn(res.currentTurn);

      // โหลด FEN ปัจจุบันจาก server
      if (res.fen) {
        try {
          const ch = new Chess(res.fen);
          gameRef.current = ch;
          setFen(ch.fen());
        } catch {
          // ignore invalid FEN
        }
      }

      // ซิงก์ card state (public)
      if (res.extra) setExtraMove(res.extra);
      if (res.shield) setShield(res.shield);
      if (res.cardPlayedBy !== undefined) setCardPlayedBy(res.cardPlayedBy);

      // ซิงก์ hand เริ่มเกม (private hand จาก server)
      if (res.hand && Array.isArray(res.hand)) {
        setHand(res.hand.map(fromServerCard));
      }

      // ซิงก์ clock ถ้า server ส่งมา
      if (res.clock) {
        setTimeLeft({ w: res.clock.w, b: res.clock.b });
        setClockRunning(res.clock.running ?? null);
      }

      // handlers
      const onCardUpdate = (data: any) => {
        if (data.extra) setExtraMove(data.extra);
        if (data.shield) setShield(data.shield);
        if (data.cardPlayedBy !== undefined) setCardPlayedBy(data.cardPlayedBy);
      };

      const onGameMove = ({ fenAfter, currentTurn }: any) => {
        gameRef.current.load(fenAfter);
        setFen(gameRef.current.fen());
        if (currentTurn) setTurn(currentTurn);
        setCheckSide(null);
      };

      const onReject = ({ reason }: any) => {
        alert('Move rejected: ' + reason);
        setFen(gameRef.current.fen());
      };

      const onChat = ({ text, from }: any) =>
        setChat((c) => [...c, `${from}: ${text}`]);

      const onCounterResolved = ({ fen, currentTurn }: any) => {
        gameRef.current.load(fen);
        setFen(gameRef.current.fen());
        if (currentTurn) setTurn(currentTurn);
      };

      const onCheck = ({ sideInCheck }: any) => setCheckSide(sideInCheck);

      const onOver = (res: any) => {
        setIsOver(true);
        setCheckSide(null);
        setResult(res);
      };

      const onRestartState = (s: any) => {
        setRestartVotes(new Set<'w' | 'b'>(s.votes || []));
        setRestartCounting(!!s.counting);
        if (s.durationSec != null) setRestartDuration(s.durationSec);
        setRestartStartedAt(s.startedAt ?? null);
      };

      const onReset = ({ fen, currentTurn }: any) => {
        if (!mounted) return;
        gameRef.current.load(fen);
        setFen(gameRef.current.fen());
        setTurn(currentTurn);
        setIsOver(false);
        setResult(null);
        setRestartVotes(new Set());
        setRestartCounting(false);
        setRestartStartedAt(null);
        // เวลาใหม่จะถูกส่งมาทาง clock:update จาก server
      };

      // register
      socket.on('card:update', onCardUpdate);
      socket.on('game:move', onGameMove);
      socket.on('game:moveRejected', onReject);
      socket.on('chat:message', onChat);
      socket.on('counter:resolved', onCounterResolved);
      socket.on('game:check', onCheck);
      socket.on('game:over', onOver);
      socket.on('game:restart:state', onRestartState);
      socket.on('game:reset', onReset);

      // cleanup สำหรับ effect นี้
      return () => {
        socket.off('card:update', onCardUpdate);
        socket.off('game:move', onGameMove);
        socket.off('game:moveRejected', onReject);
        socket.off('chat:message', onChat);
        socket.off('counter:resolved', onCounterResolved);
        socket.off('game:check', onCheck);
        socket.off('game:over', onOver);
        socket.off('game:restart:state', onRestartState);
        socket.off('game:reset', onReset);
      };
    })();

    return () => {
      mounted = false;
    };
  }, [roomId]);

  // ฟัง clock:update แยกต่างหาก
  useEffect(() => {
    const onClockUpdate = (payload: {
      w: number;
      b: number;
      running: 'w' | 'b' | null;
    }) => {
      setTimeLeft({ w: payload.w, b: payload.b });
      setClockRunning(payload.running ?? null);
    };

    socket.on('clock:update', onClockUpdate);
    return () => {
      socket.off('clock:update', onClockUpdate);
    };
  }, []);

  // ฟัง hand update จาก server (เวลาจั่ว/ใช้การ์ด)
  useEffect(() => {
    const onHand = (cards: { id: CardId; uid: string }[]) => {
      setHand(cards.map(fromServerCard));
    };
    socket.on('card:hand', onHand);
    return () => {
      socket.off('card:hand', onHand);
    };
  }, []);

  const meSide: 'w' | 'b' | null = useMemo(
    () => (color === 'white' ? 'w' : color === 'black' ? 'b' : null),
    [color]
  );

  const formatTime = (sec: number) => {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
  };

  // chat send
  function sendChat() {
    if (!message.trim()) return;
    socket.emit('chat:message', {
      roomId,
      text: message,
      from: color ?? 'spectator',
    });
    setMessage('');
  }

  // vote restart
  function voteRestart() {
    socket.emit('game:restart:vote', { roomId }, (ack: any) => {
      if (!ack?.ok) alert(ack?.reason || 'ไม่สามารถกดพร้อมรีสตาร์ทได้');
    });
  }

  // make move
  function handleMove({ from, to }: { from: Square; to: Square }) {
    if (!meSide || turn !== meSide) return false;

    // force side to move
    let fenNow = gameRef.current.fen();
    const parts = fenNow.split(' ');
    if (parts[1] !== meSide) {
      parts[1] = meSide;
      const adjustedFen = parts.join(' ');
      const temp = new Chess(adjustedFen);
      gameRef.current = temp;
    }

    const game = gameRef.current;
    const p = game.get(from as any);
    if (!p || p.color !== meSide) return false;

    const willPromote =
      p.type === 'p' &&
      ((p.color === 'w' && to[1] === '8') || (p.color === 'b' && to[1] === '1'));
    const moveObj: any = { from, to };
    if (willPromote) moveObj.promotion = 'q';

    const fenBefore = game.fen();
    let mv: any;
    try {
      mv = game.move(moveObj);
    } catch {
      return false;
    }
    if (!mv) return false;

    const fenAfter = game.fen();

    // client-side guard: extra move cannot capture king
    const myExtra = meSide === 'w' ? extraMove.w : extraMove.b;
    if (myExtra > 0 && mv.captured === 'k') {
      game.undo();
      setFen(game.fen());
      alert('ห้ามกิน King ด้วยการเดินจากการ์ดเสริมพลัง');
      return false;
    }

    setFen(fenAfter);

    socket.emit(
      'game:move',
      {
        roomId,
        move: {
          from,
          to,
          san: mv.san,
          capturedPieceType: mv.captured || null,
          attackerPieceType: mv.piece || null,
        },
        fenBefore,
        fenAfter,
        by: meSide,
        capturedSquare: mv.captured ? to : null,
      },
      (ack: any) => {
        if (!ack || !ack.ok) {
          game.undo();
          setFen(game.fen());
        }
      }
    );

    return true;
  }

  // play cards
  function playCard(card: CardInstance) {
    if (!meSide || turn !== meSide) return;

    if (card.id === 'DEF_SHIELD') {
      setSelectingShield(true);
      setShieldCardUid(card.uid);
      return;
    }

    if (card.id === 'COUNTER_SACRIFICE') {
      setSelectingCounterSac(true);
      setCounterCardUid(card.uid);
      return;
    }

    socket.emit(
      'card:play',
      { roomId, color, card: card.id, uid: card.uid },
      (ack: any) => {
        if (!ack?.ok) {
          alert(ack?.reason || 'Play card failed');
        }
        // ถ้า ok: server จะลบจากมือ + ส่ง card:hand มาเอง
      }
    );
  }

  // shield target
  function handleSquareClickForShield(square: Square) {
    if (!selectingShield || !shieldCardUid) return;

    const p: any = gameRef.current.get(square as any);
    if (!p || p.color !== meSide) {
      alert('เลือกหมากของตัวเองเท่านั้น');
      setSelectingShield(false);
      setShieldCardUid(null);
      return;
    }

    socket.emit(
      'card:play',
      { roomId, color, card: 'DEF_SHIELD', uid: shieldCardUid, payload: { square } },
      (ack: any) => {
        if (!ack?.ok) {
          alert(ack?.reason || 'Play card failed');
        }
        // ถ้า ok: server จะอัปเดตมือให้ผ่าน card:hand
        setSelectingShield(false);
        setShieldCardUid(null);
      }
    );
  }

  // counter target
  function handleSquareClickForCounter(square: Square) {
    if (!selectingCounterSac || !counterCardUid) return;
    const p: any = gameRef.current.get(square as any);
    if (!p || !p.color || p.color !== meSide || p.type === 'k') {
      alert('เลือกเฉพาะหมากของคุณ (ยกเว้นราชา) เพื่อสละชีพ');
      return;
    }
    socket.emit(
      'card:play',
      {
        roomId,
        color,
        card: 'COUNTER_SACRIFICE',
        uid: counterCardUid,
        payload: { sacrificeSquare: square },
      },
      (ack: any) => {
        if (!ack?.ok) {
          alert(ack?.reason || 'ใช้การ์ดไม่ได้');
        }
        // ถ้า ok: server จะอัปเดตมือให้ผ่าน card:hand
        setSelectingCounterSac(false);
        setCounterCardUid(null);
      }
    );
  }

  const inviteUrl = typeof window !== 'undefined' ? window.location.href : '';

  return (
    <div className="min-h-screen p-4 md:p-8 grid gap-4 md:grid-cols-[1fr_320px]">
      {/* LEFT */}
      <div className="bg-gray-900 rounded-2xl p-4 text-white flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <div>
            Room: <span className="font-mono">{String(roomId)}</span>
          </div>
          <div>
            คุณคือ: <b>{color ?? 'กำลังเข้าห้อง…'}</b> | เทิร์น:{' '}
            <b>{turn === 'w' ? 'white' : 'black'}</b>
          </div>
        </div>

        {/* CLOCK UI */}
        <div className="flex justify-center gap-4 mt-1 text-sm">
          <div
            className={`px-3 py-1 rounded-lg ${
              clockRunning === 'w' ? 'bg-emerald-600' : 'bg-gray-700'
            }`}
          >
            White ⏱ {formatTime(timeLeft.w)}
          </div>
          <div
            className={`px-3 py-1 rounded-lg ${
              clockRunning === 'b' ? 'bg-emerald-600' : 'bg-gray-700'
            }`}
          >
            Black ⏱ {formatTime(timeLeft.b)}
          </div>
        </div>

        <div className="self-center" style={{ width: 560, height: 560 }}>
          <div className="w-[560px] h-[560px]">
            <Chessboard
              id="room-board"
              boardWidth={560}
              position={fen}
              boardOrientation={color === 'black' ? 'black' : 'white'}
              showBoardNotation={false}
              animationDuration={150}
              arePiecesDraggable={
                !isOver &&
                !!meSide &&
                turn === meSide &&
                !selectingShield &&
                !selectingCounterSac
              }
              isDraggablePiece={({ piece }) => {
                if (!meSide || turn !== meSide || selectingShield || selectingCounterSac)
                  return false;
                const my = meSide === 'w' ? 'w' : 'b';
                return piece.startsWith(my);
              }}
              onPieceDrop={(source: string, target: string) => {
                if (selectingShield || selectingCounterSac) return false;
                return !!handleMove({ from: source as Square, to: target as Square });
              }}
              onSquareClick={(sq: string) => {
                const square = sq as Square;
                if (selectingShield) return handleSquareClickForShield(square);
                if (selectingCounterSac) return handleSquareClickForCounter(square);
              }}
              customBoardStyle={{ borderRadius: 12 }}
              customSquareStyles={{
                ...(shield.square
                  ? {
                      [shield.square]: {
                        boxShadow: 'inset 0 0 0 3px rgba(56,189,248,0.85)',
                      },
                    }
                  : {}),
              }}
            />
          </div>
        </div>

        {/* CARDS */}
        <div className="flex-shrink-0">
          <h3 className="font-semibold mb-2">การ์ดของฉัน</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {hand.map((c) => (
              <div key={c.uid} className="bg-gray-800 p-3 rounded-xl">
                <div className="font-semibold">{c.name}</div>
                <div className="text-sm opacity-80">{c.desc}</div>
                <button
                  onClick={() => playCard(c)}
                  disabled={
                    isOver || !meSide || turn !== meSide || cardPlayedBy === meSide
                  }
                  className="mt-2 px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50"
                >
                  ใช้การ์ด
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* STATUS + INVITE */}
        <div className="text-sm opacity-80 space-y-1 flex-shrink-0">
          <div>
            Extra move เหลือ: W {extraMove.w} / B {extraMove.b}
          </div>
          <div>
            Shield:{' '}
            {shield.square
              ? `${shield.square} (โดย ${shield.by === 'w' ? 'white' : 'black'})`
              : '-'}
          </div>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1"
              value={inviteUrl}
              readOnly
            />
            <button
              onClick={() => navigator.clipboard.writeText(inviteUrl)}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600"
            >
              คัดลอกลิงก์
            </button>
          </div>
        </div>

        {(selectingShield || selectingCounterSac) && (
          <div className="text-center text-sm -mt-2">
            {selectingShield ? (
              <span className="text-cyan-300">
                โหมดโล่ป้องกัน: คลิกหมากของตัวเองเพื่อคุ้มกัน
              </span>
            ) : (
              <span className="text-amber-300">
                โต้กลับ: คลิก “หมากของคุณ (ยกเว้นราชา)” 1 ตัวเพื่อสละชีพแทน
              </span>
            )}
          </div>
        )}
      </div>

      {/* RIGHT: chat */}
      <div className="bg-gray-900 rounded-2xl p-4 text-white flex flex-col h-[560px]">
        <div className="font-semibold">แชท</div>
        <div className="flex-1 overflow-y-auto mt-2 space-y-1">
          {chat.map((line, i) => (
            <div key={i} className="text-sm bg-gray-800 px-2 py-1 rounded">
              {line}
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendChat();
            }}
            placeholder="พิมพ์ข้อความ…"
          />
          <button
            onClick={sendChat}
            className="px-3 py-1.5 rounded bg-indigo-500 hover:bg-indigo-600"
          >
            ส่ง
          </button>
        </div>
      </div>

      {/* ===== MODAL OVERLAY  ===== */}
      {isOver && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl bg-gray-900 border border-gray-700 shadow-xl p-4">
            <div className="text-center mb-3">
              <div className="text-lg font-bold">
                {(() => {
                  if (!result) return 'จบเกม';
                  if (result.type === 'checkmate') {
                    const iWin = meSide && result.winner === meSide;
                    return iWin ? 'คุณชนะ! (Checkmate)' : 'คุณแพ้ (Checkmate)';
                  }
                  if (result.type === 'stalemate') return 'เสมอ (Stalemate)';
                  if (result.type === 'insufficient') return 'เสมอ (ตัวไม่พอให้เมต)';
                  if (result.type === 'timeout') return 'หมดเวลา';
                  return 'จบเกม';
                })()}
              </div>
              {result?.winner && (
                <div className="text-sm opacity-80">
                  ผู้ชนะ: {result.winner === 'w' ? 'White' : 'Black'}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <div className="text-sm mb-1">ความพร้อม:</div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-1 rounded text-xs ${
                      restartVotes.has('w') ? 'bg-emerald-600' : 'bg-gray-700'
                    }`}
                  >
                    White {restartVotes.has('w') ? '✔' : '…'}
                  </span>
                  <span
                    className={`px-2 py-1 rounded text-xs ${
                      restartVotes.has('b') ? 'bg-emerald-600' : 'bg-gray-700'
                    }`}
                  >
                    Black {restartVotes.has('b') ? '✔' : '…'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {restartCounting ? (
                  <div className="px-3 py-1.5 rounded bg-amber-600 text-white">
                    รีเซ็ตใน {remain}s
                  </div>
                ) : (
                  <button
                    onClick={voteRestart}
                    className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                    disabled={!meSide || restartVotes.has(meSide)}
                  >
                    {!meSide || !restartVotes.has(meSide)
                      ? 'พร้อมเริ่มใหม่'
                      : 'รออีกฝั่ง…'}
                  </button>
                )}
              </div>
            </div>

            {!restartCounting && (
              <div className="text-xs opacity-70 mt-2 text-center"></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
