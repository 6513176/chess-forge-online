'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { joinRoom, socket } from '@/app/lib/socket';

// ---- Card types ----
type CardId =
  | 'BUFF_EXTRA_MOVE'
  | 'DEF_SHIELD'
  | 'COUNTER_SACRIFICE'
  | 'BUFF_PAWN_RANGE'
  | 'BUFF_SUMMON_PAWN'
  | 'BUFF_SWAP_ALLY'
  | 'DEF_SAFE_ZONE'
  | 'AOE_BLAST'
  | 'CLEANSE_BUFFS';

type Card = {
  id: CardId;
  name: string;
  desc: string;
};

// ใบจริงในมือ (client จะใช้ข้อมูลจาก server + map หา name/desc)
type CardInstance = Card & { uid: string };

// นิยามการ์ดทั้งหมด (ฝั่ง client แค่ใช้เพื่อแสดงชื่อ/คำอธิบาย)
const CARD_DEFS: Card[] = [
  {
    id: 'BUFF_EXTRA_MOVE',
    name: 'FORGE',
    desc: 'ได้เดินเพิ่มอีก 1 ครั้งในเทิร์นนี้ (แต่ห้ามกินราชา)',
  },
  {
    id: 'DEF_SHIELD',
    name: 'SHIELD',
    desc: 'กันชิ้นที่เลือกไม่ให้โดนกิน 1 เทิร์น',
  },
  {
    id: 'COUNTER_SACRIFICE',
    name: 'SACRIFICE',
    desc: 'โต้กลับ: ย้อนคืนหมากที่เพิ่งตาย โดยสละหมากเรา 1 ตัว',
  },
  {
    id: 'BUFF_PAWN_RANGE',
    name: 'PAWN RANGE+',
    desc: 'เลือกเบี้ย 1 ตัว ให้เดิน 2 ช่องได้ตลอดเกม',
  },
  {
    id: 'BUFF_SUMMON_PAWN',
    name: 'SUMMON PAWN',
    desc: 'เรียกเบี้ยใหม่บนแถวตั้งต้นของเรา (ขาวแถว 2, ดำแถว 7)',
  },
  {
    id: 'BUFF_SWAP_ALLY',
    name: 'SWAP',
    desc: 'สลับตำแหน่งหมากของคุณ 2 ตัว',
  },
  {
    id: 'DEF_SAFE_ZONE',
    name: 'SAFE ZONE',
    desc: 'สร้างเขตปลอดภัย 3×3 รอบช่องที่เลือก 1 เทิร์น',
  },
  {
    id: 'AOE_BLAST',
    name: 'AOE BLAST',
    desc: 'สุ่มทำลายหมาก 1 ตัวในพื้นที่ 3×3 หลังผ่านไป 2 เทิร์นของคุณ',
  },
  {
    id: 'CLEANSE_BUFFS',
    name: 'CLEANSE',
    desc: 'ล้างบัพ',
  },
];

const CARD_MAP: Record<CardId, Card> = CARD_DEFS.reduce((acc, c) => {
  acc[c.id] = c;
  return acc;
}, {} as Record<CardId, Card>);

// map จาก {id, uid} ที่ได้จาก server → CardInstance ที่มี name/desc
function fromServerCard(raw: { id: CardId; uid: string }): CardInstance {
  const def = CARD_MAP[raw.id];
  return { ...def, uid: raw.uid };
}

// เวลาเริ่มต้นต่อฝั่ง (ต้องให้ server ใช้ค่าเดียวกันด้วย)
const INITIAL_TIME = 420; // 300 วินาที = 5 นาที

// helper 3×3 รอบ center (ใช้สำหรับ safe zone / aoe highlight)
function getArea3x3(centerSquare: string | null) {
  if (!centerSquare || centerSquare.length !== 2) return {};
  const file = centerSquare[0].charCodeAt(0); // 'a'..'h'
  const rank = parseInt(centerSquare[1], 10); // 1..8
  const out: Record<string, boolean> = {};

  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      const f = file + df;
      const r = rank + dr;
      if (f < 'a'.charCodeAt(0) || f > 'h'.charCodeAt(0)) continue;
      if (r < 1 || r > 8) continue;
      const sq = String.fromCharCode(f) + r;
      out[sq] = true;
    }
  }
  return out;
}

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();

  // --- game states ---
  const gameRef = useRef(new Chess());
  const [fen, setFen] = useState(gameRef.current.fen());
  const [turn, setTurn] = useState<'w' | 'b'>('w');
  const [color, setColor] = useState<'white' | 'black' | null>(null);
  const [hoverSquare, setHoverSquare] = useState<string | null>(null);


  const [isOver, setIsOver] = useState(false);
  const [result, setResult] = useState<{ type: string; winner?: 'w' | 'b' } | null>(
    null
  );
  const [checkSide, setCheckSide] = useState<'w' | 'b' | null>(null);

  // restart state
  const [now, setNow] = useState<number>(Date.now());
  const [restartVotes, setRestartVotes] = useState<Set<'w' | 'b'>>(new Set());
  const [restartCounting, setRestartCounting] = useState(false);
  const [restartStartedAt, setRestartStartedAt] = useState<number | null>(null);
  const [restartDuration, setRestartDuration] = useState<number>(5);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalMovesMap, setLegalMovesMap] = useState<Record<string, boolean>>({});
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
  const [extraMove, setExtraMove] = useState<{ w: number; b: number }>({
    w: 0,
    b: 0,
  });
  const [shield, setShield] = useState<{ by: null | 'w' | 'b'; square: null | string }>(
    {
      by: null,
      square: null,
    }
  );
  const [safeZone, setSafeZone] = useState<{ by: null | 'w' | 'b'; square: null | string }>(
    {
      by: null,
      square: null,
    }
  );
  const [pawnRange, setPawnRange] = useState<Record<string, boolean>>({}); // { square: true }
  const [aoe, setAoe] = useState<{ by: 'w' | 'b' | null; center: string | null; remaining?: number | null } | null>(
    null
  );

  const [hand, setHand] = useState<CardInstance[]>([]);
  const [cardPlayedBy, setCardPlayedBy] = useState<'w' | 'b' | null>(null);

  // overlays (โหมดเลือกเป้าหมายของการ์ด)
  const [selectingShield, setSelectingShield] = useState(false);
  const [shieldCardUid, setShieldCardUid] = useState<string | null>(null);

  const [selectingCounterSac, setSelectingCounterSac] = useState(false);
  const [counterCardUid, setCounterCardUid] = useState<string | null>(null);

  const [selectingPawnRange, setSelectingPawnRange] = useState(false);
  const [pawnRangeCardUid, setPawnRangeCardUid] = useState<string | null>(null);

  const [selectingSummonPawn, setSelectingSummonPawn] = useState(false);
  const [summonCardUid, setSummonCardUid] = useState<string | null>(null);

  const [selectingSwap, setSelectingSwap] = useState(false);
  const [swapCardUid, setSwapCardUid] = useState<string | null>(null);
  const [swapFirstSquare, setSwapFirstSquare] = useState<Square | null>(null);

  const [selectingSafeZone, setSelectingSafeZone] = useState(false);
  const [safeZoneCardUid, setSafeZoneCardUid] = useState<string | null>(null);

  const [selectingAoe, setSelectingAoe] = useState(false);
  const [aoeCardUid, setAoeCardUid] = useState<string | null>(null);
  const [deckCount, setDeckCount] = useState<number | null>(null);
  const [graveyardCount, setGraveyardCount] = useState<number | null>(null);

  // chat
  const [chat, setChat] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  // tick สำหรับ countdown (ใช้เฉพาะ restart modal)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

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
      if (res.safeZone) setSafeZone(res.safeZone);
      if (res.pawnRange) setPawnRange(res.pawnRange);
      if (res.aoe) setAoe(res.aoe);
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
            // ซิงก์ deck counts ถ้ามี
      if (typeof res.deckCount === 'number') setDeckCount(res.deckCount);
      if (typeof res.graveyardCount === 'number') setGraveyardCount(res.graveyardCount);

      // handlers
      const onCardUpdate = (data: any) => {
        if (data.extra) setExtraMove(data.extra);
        if (data.shield) setShield(data.shield);
        if (data.safeZone) setSafeZone(data.safeZone);
        if (data.pawnRange) setPawnRange(data.pawnRange);
        if (data.aoe !== undefined) setAoe(data.aoe || null);
        if (data.cardPlayedBy !== undefined) setCardPlayedBy(data.cardPlayedBy);
      };

            const onGameMove = ({ fenAfter, currentTurn }: any) => {
        // อัปเดตกระดานจาก server -> โหลด FEN ใหม่
        gameRef.current.load(fenAfter);
        setFen(gameRef.current.fen());
        if (currentTurn) setTurn(currentTurn);
        setCheckSide(null);

        // เคลียร์ selection / legal highlights ทุกครั้งที่มีการอัปเดตกระดานจาก server
        setSelectedSquare(null);
        setLegalMovesMap({});
      };


            const onReject = ({ reason }: any) => {
        alert('Move rejected: ' + reason);
        setFen(gameRef.current.fen());

        // เคลียร์ selection (ถ้ามี) เพราะ move ถูก reject
        setSelectedSquare(null);
        setLegalMovesMap({});
      };


      const onChat = ({ text, from }: any) =>
        setChat((c) => [...c, `${from}: ${text}`]);

            const onCounterResolved = ({ fen, currentTurn }: any) => {
        gameRef.current.load(fen);
        setFen(gameRef.current.fen());
        if (currentTurn) setTurn(currentTurn);

        // เคลียร์ selection เมื่อ counter ถูก resolve (board เปลี่ยน)
        setSelectedSquare(null);
        setLegalMovesMap({});
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

        // เคลียร์ selection / legal highlights
        setSelectedSquare(null);
        setLegalMovesMap({});
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
  useEffect(() => {
    const onCardCounts = (payload: { deck: number; graveyard: number }) => {
      setDeckCount(payload.deck);
      setGraveyardCount(payload.graveyard);
    };
    socket.on('card:counts', onCardCounts);
    return () => {
      socket.off('card:counts', onCardCounts);
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

  const anySelecting =
    selectingShield ||
    selectingCounterSac ||
    selectingPawnRange ||
    selectingSummonPawn ||
    selectingSwap ||
    selectingSafeZone ||
    selectingAoe;

  // make move
  function handleMove({ from, to }: { from: Square; to: Square }) {
    if (!meSide || turn !== meSide) return false;
    if (anySelecting) return false;

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
    if (myExtra > 0 && mv.captured) {
      game.undo();
      setFen(game.fen());
      alert('Extra move ใช้เดินอย่างเดียว ห้ามกินหมาก');
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

  // ---- play cards ----
  function playCard(card: CardInstance) {
    if (!meSide || turn !== meSide) return;

    // ป้องกันเล่นหลายใบในเทิร์นเดียว
    if (cardPlayedBy === meSide) {
      alert('ใช้การ์ดในเทิร์นนี้ไปแล้ว');
      return;
    }

    // การ์ดที่ต้องเลือกเป้าบนบอร์ด
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

    if (card.id === 'BUFF_PAWN_RANGE') {
      setSelectingPawnRange(true);
      setPawnRangeCardUid(card.uid);
      return;
    }

    if (card.id === 'BUFF_SUMMON_PAWN') {
      setSelectingSummonPawn(true);
      setSummonCardUid(card.uid);
      return;
    }

    if (card.id === 'BUFF_SWAP_ALLY') {
      setSelectingSwap(true);
      setSwapCardUid(card.uid);
      setSwapFirstSquare(null);
      return;
    }

    if (card.id === 'DEF_SAFE_ZONE') {
      setSelectingSafeZone(true);
      setSafeZoneCardUid(card.uid);
      return;
    }

    if (card.id === 'AOE_BLAST') {
      setSelectingAoe(true);
      setAoeCardUid(card.uid);
      return;
    }

    // CLEANSE_BUFFS หรือการ์ดไม่ต้องเลือกเป้า
    socket.emit(
      'card:play',
      { roomId, color, card: card.id, uid: card.uid },
      (ack: any) => {
        if (!ack?.ok) {
          alert(ack?.reason || 'Play card failed');
        }
      }
    );
  }

  // ---- target handlers ----

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
        setSelectingCounterSac(false);
        setCounterCardUid(null);
      }
    );
  }

  // BUFF_PAWN_RANGE: เลือก pawn ของเรา
  function handleSquareClickForPawnRange(square: Square) {
    if (!selectingPawnRange || !pawnRangeCardUid) return;
    const p: any = gameRef.current.get(square as any);
    if (!p || p.color !== meSide || p.type !== 'p') {
      alert('เลือกเฉพาะเบี้ยของคุณเท่านั้น');
      return;
    }

    socket.emit(
      'card:play',
      {
        roomId,
        color,
        card: 'BUFF_PAWN_RANGE',
        uid: pawnRangeCardUid,
        payload: { square },
      },
      (ack: any) => {
        if (!ack?.ok) {
          alert(ack?.reason || 'ใช้การ์ดไม่ได้');
        }
        setSelectingPawnRange(false);
        setPawnRangeCardUid(null);
      }
    );
  }

  // BUFF_SUMMON_PAWN: เลือกช่องว่างบนแถว 2(ขาว) / 7(ดำ)
  function handleSquareClickForSummon(square: Square) {
    if (!selectingSummonPawn || !summonCardUid) return;

    const p: any = gameRef.current.get(square as any);
    if (p) {
      alert('ต้องเลือกช่องว่างเท่านั้น');
      return;
    }

    const rank = parseInt(square[1]);
    if (meSide === 'w' && rank !== 2) {
      alert('ขาวต้องวางบนแถว 2 เท่านั้น');
      return;
    }
    if (meSide === 'b' && rank !== 7) {
      alert('ดำต้องวางบนแถว 7 เท่านั้น');
      return;
    }

    socket.emit(
      'card:play',
      {
        roomId,
        color,
        card: 'BUFF_SUMMON_PAWN',
        uid: summonCardUid,
        payload: { square },
      },
      (ack: any) => {
        if (!ack?.ok) {
          alert(ack?.reason || 'ใช้การ์ดไม่ได้');
        }
        setSelectingSummonPawn(false);
        setSummonCardUid(null);
      }
    );
  }

  // BUFF_SWAP_ALLY: เลือกหมากเรา 2 ตัว
  function handleSquareClickForSwap(square: Square) {
    if (!selectingSwap || !swapCardUid) return;

    const p: any = gameRef.current.get(square as any);
    if (!p || p.color !== meSide) {
      alert('เลือกเฉพาะหมากของคุณเท่านั้น');
      return;
    }

    if (!swapFirstSquare) {
      // เลือกตัวแรก
      setSwapFirstSquare(square);
      return;
    }

    if (swapFirstSquare === square) {
      alert('ต้องเลือกอีกช่องที่ต่างกัน');
      return;
    }

    // เลือกตัวที่สอง ครบแล้ว ยิงไป server
    socket.emit(
      'card:play',
      {
        roomId,
        color,
        card: 'BUFF_SWAP_ALLY',
        uid: swapCardUid,
        payload: { a: swapFirstSquare, b: square },
      },
      (ack: any) => {
        if (!ack?.ok) {
          alert(ack?.reason || 'ใช้การ์ดไม่ได้');
        }
        setSelectingSwap(false);
        setSwapCardUid(null);
        setSwapFirstSquare(null);
      }
    );
  }

  // DEF_SAFE_ZONE 3×3: เลือก center ช่องเดียว
  function handleSquareClickForSafeZone(square: Square) {
    if (!selectingSafeZone || !safeZoneCardUid) return;

    socket.emit(
      'card:play',
      {
        roomId,
        color,
        card: 'DEF_SAFE_ZONE',
        uid: safeZoneCardUid,
        payload: { square },
      },
      (ack: any) => {
        if (!ack?.ok) {
          alert(ack?.reason || 'ใช้การ์ดไม่ได้');
        }
        setSelectingSafeZone(false);
        setSafeZoneCardUid(null);
      }
    );
  }

  // AOE_BLAST 3×3: เลือก center ช่องเดียว
  function handleSquareClickForAoe(square: Square) {
    if (!selectingAoe || !aoeCardUid) return;

    socket.emit(
      'card:play',
      {
        roomId,
        color,
        card: 'AOE_BLAST',
        uid: aoeCardUid,
        payload: { square },
      },
      (ack: any) => {
        if (!ack?.ok) {
          alert(ack?.reason || 'ใช้การ์ดไม่ได้');
        }
        setSelectingAoe(false);
        setAoeCardUid(null);
      }
    );
  }

  const inviteUrl = typeof window !== 'undefined' ? window.location.href : '';

  // custom square styles (shield + safeZone 3x3 + AOE center + first swap)
  const customSquareStyles: Record<string, any> = {};

    // --- selected square + legal moves highlighting ---
  if (selectedSquare) {
    customSquareStyles[selectedSquare] = {
      ...(customSquareStyles[selectedSquare] || {}),
      boxShadow: 'inset 0 0 0 4px rgba(96,165,100.95)', // blue ring สำหรับต้นทาง
    };
  }

  Object.keys(legalMovesMap).forEach((sq) => {
  customSquareStyles[sq] = {
    ...(customSquareStyles[sq] || {}),
    backgroundColor: 'rgba(34,197,94,0.45)',  
  };
});



  if (safeZone.square) {
    const area = getArea3x3(safeZone.square);
    Object.keys(area).forEach((sq) => {
      customSquareStyles[sq] = {
        ...(customSquareStyles[sq] || {}),
        boxShadow:
          'inset 0 0 0 3px rgba(250,204,21,0.75)', 
          backgroundColor: 'rgba(250,204,94,0.45)',  
      };
    });
  }
function describeBuffsOnSquare(
  sq: string | null,
  opts: {
    shield: { by: 'w' | 'b' | null; square: string | null };
    safeZone: { by: 'w' | 'b' | null; square: string | null };
    pawnRange: Record<string, any>;
    aoe: { by: 'w' | 'b' | null; center: string | null; remaining?: number | null } | null;
  }
): string[] {
  if (!sq) return [];
  const buffs: string[] = [];
  const { shield, safeZone, pawnRange, aoe } = opts;

  if (shield.square === sq) {
    buffs.push('Shield: กันโดนกิน 1 เทิร์น');
  }

  if (pawnRange[sq]) {
    buffs.push('Range Buff: เดิน 2 รอบ (ห้ามกิน)');
  }

  if (safeZone.square) {
    const area = getArea3x3(safeZone.square);
    if (area[sq]) {
      buffs.push('Safe Zone: พื้นที่ปลอดภัย 3×3');
    }
  }

  if (aoe?.center) {
    const area = getArea3x3(aoe.center);
    if (area[sq]) {
      buffs.push(
        `AOE Zone: พื้นที่ระเบิด (เหลือ ${aoe.remaining ?? '?'} เทิร์นของผู้ใช้)`
      );
    }
  }

  return buffs;
}
  // คืน object map ของช่องที่เดินไปได้ เช่น { e4: true, d5: true }
  function computeLegalMovesFrom(square: Square | null) {
  if (!square) return {};
  try {
    // บอก TS ว่า square เป็น Square
    const moves = gameRef.current.moves({ square: square as Square, verbose: true }) as any[] | string[];
    const out: Record<string, boolean> = {};
    if (!moves) return out;
    for (const m of moves as any[]) {
      if (m && m.to) out[m.to] = true;
    }
    return out;
  } catch {
    return {};
  }
}

  // AOE center highlight (วงสีชมพู)
    // AOE center highlight (วงสีชมพู)
    // AOE 3×3 highlight (ชมพู)
  if (aoe?.center) {
    const area = getArea3x3(aoe.center);
    Object.keys(area).forEach((sq) => {
      customSquareStyles[sq] = {
        ...(customSquareStyles[sq] || {}),
        boxShadow: 'inset 0 0 0 3px rgba(244,114,182,1)',
        backgroundColor: 'rgba(34,5,5,0.45)', 
      };
    });
  }



  if (swapFirstSquare) {
    customSquareStyles[swapFirstSquare] = {
      ...(customSquareStyles[swapFirstSquare] || {}),
      boxShadow: 'inset 0 0 0 3px rgba(129,140,248,0.9)',
    };
  }

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
              onMouseOverSquare={(sq: string) => {
                setHoverSquare(sq);
              }}
              onMouseOutSquare={() => {
                setHoverSquare(null);
              }}
              arePiecesDraggable={
                !isOver && !!meSide && turn === meSide && !anySelecting
              }
              isDraggablePiece={({ piece }) => {
                if (!meSide || turn !== meSide || anySelecting) return false;
                const my = meSide === 'w' ? 'w' : 'b';
                return piece.startsWith(my);
              }}
                            onPieceDrop={(source: string, target: string) => {
                if (anySelecting) return false;
                const ok = !!handleMove({ from: source as Square, to: target as Square });
                // ถ้าทำสำเร็จ ให้ล้าง selection / legal highlights
                if (ok) {
                  setSelectedSquare(null);
                  setLegalMovesMap({});
                }
                return ok;
              }}

                            onSquareClick={(sq: string) => {
                const square = sq as Square;

                // ถ้าอยู่ในโหมดเลือกการ์ด ให้ไป handler การ์ดก่อน
                if (selectingShield) return handleSquareClickForShield(square);
                if (selectingCounterSac) return handleSquareClickForCounter(square);
                if (selectingPawnRange) return handleSquareClickForPawnRange(square);
                if (selectingSummonPawn) return handleSquareClickForSummon(square);
                if (selectingSwap) return handleSquareClickForSwap(square);
                if (selectingSafeZone) return handleSquareClickForSafeZone(square);
                if (selectingAoe) return handleSquareClickForAoe(square);

                // ถ้าไม่ใช่โหมดการ์ด: เลือกหมาก / เดินผ่านคลิก
                // ถ้าไม่มีสิทธิ์ (ไม่ใช่เทิร์นเรา) ปิดการเลือก
                if (!meSide || turn !== meSide) {
                  setSelectedSquare(null);
                  setLegalMovesMap({});
                  return;
                }

                const piece: any = gameRef.current.get(square as any);

                // ถ้ามี selection อยู่แล้ว
                if (selectedSquare) {
                  // คลิกที่ช่องเดิม → ยกเลิก selection
                  if (selectedSquare === square) {
                    setSelectedSquare(null);
                    setLegalMovesMap({});
                    return;
                  }

                  // ถ้าคลิกที่ช่องเป้าจาก legalMoves → เดิน
                  if (legalMovesMap[square]) {
                    // เรียก handleMove (จะตรวจสิทธิ์อีกชั้นที่ server)
                    handleMove({ from: selectedSquare, to: square });
                    setSelectedSquare(null);
                    setLegalMovesMap({});
                    return;
                  }

                  // ถ้าคลิกหมากของเราอื่นๆ → เปลี่ยน selection
                  if (piece && piece.color === meSide) {
                    setSelectedSquare(square);
                    setLegalMovesMap(computeLegalMovesFrom(square));
                    return;
                  }

                  // คลิกที่อื่นที่ไม่ใช่เป้า → ยกเลิก
                  setSelectedSquare(null);
                  setLegalMovesMap({});
                  return;
                }

                // ถ้ายังไม่มี selection: ถ้าคลิกหมากของเรา ให้ select
                if (piece && piece.color === meSide) {
                  setSelectedSquare(square);
                  setLegalMovesMap(computeLegalMovesFrom(square));
                }
              }}

              customBoardStyle={{ borderRadius: 12 }}
              customSquareStyles={customSquareStyles}
            />
             {hoverSquare && (
            <div className="mt-1 text-xs text-gray-300 text-center">
              <span className="font-mono mr-1">{hoverSquare}:</span>
              {(() => {
                const buffs = describeBuffsOnSquare(hoverSquare, {
                  shield,
                  safeZone,
                  pawnRange,
                  aoe,
                });
                if (!buffs.length) return 'ไม่มีบัพ';
                return buffs.join(' | ');
              })()}
            </div>
          )}
          </div>
        </div>

        {/* CARDS */}
        <div className="flex-shrink-0"><div>
            Deck: {deckCount ?? '-'} | Graveyard: {graveyardCount ?? '-'}
          </div>
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

        {(selectingShield ||
          selectingCounterSac ||
          selectingPawnRange ||
          selectingSummonPawn ||
          selectingSwap ||
          selectingSafeZone ||
          selectingAoe) && (
          <div className="text-center text-sm -mt-2">
            {selectingShield && (
              <span className="text-cyan-300">
                SHIELD: คลิกหมากของตัวเองเพื่อคุ้มกัน
              </span>
            )}
            {selectingCounterSac && !selectingShield && (
              <span className="text-amber-300">
                SACRIFICE: คลิกหมากของคุณ (ยกเว้นราชา) 1 ตัวเพื่อสละชีพ
              </span>
            )}
            {selectingPawnRange &&
              !selectingShield &&
              !selectingCounterSac && (
                <span className="text-emerald-300">
                  PAWN RANGE+: คลิกเบี้ยของคุณ 1 ตัว
                </span>
              )}
            {selectingSummonPawn &&
              !selectingShield &&
              !selectingCounterSac &&
              !selectingPawnRange && (
                <span className="text-lime-300">
                  SUMMON PAWN: คลิกช่องว่างบนแถวตั้งต้นของฝั่งคุณ
                </span>
              )}
            {selectingSwap &&
              !selectingShield &&
              !selectingCounterSac &&
              !selectingPawnRange &&
              !selectingSummonPawn && (
                <span className="text-indigo-300">
                  SWAP: คลิกหมากของคุณ 2 ตัวที่จะสลับตำแหน่ง
                </span>
              )}
            {selectingSafeZone &&
              !selectingShield &&
              !selectingCounterSac &&
              !selectingPawnRange &&
              !selectingSummonPawn &&
              !selectingSwap && (
                <span className="text-yellow-300">
                  SAFE ZONE: คลิกช่องใดก็ได้เพื่อเป็นศูนย์กลางโซนปลอดภัย 3×3
                </span>
              )}
            {selectingAoe &&
              !selectingShield &&
              !selectingCounterSac &&
              !selectingPawnRange &&
              !selectingSummonPawn &&
              !selectingSwap &&
              !selectingSafeZone && (
                <span className="text-pink-300">
                  AOE BLAST: คลิกช่องใดก็ได้เพื่อเป็นศูนย์กลาง 3×3 สำหรับระเบิด
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
