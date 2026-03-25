'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { joinRoom, socket } from '@/app/lib/socket';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/app/lib/firebase';
import ExperienceSurvey from '@/app/components/ExperienceSurvey';
import RulesModal from '@/app/components/RulesModal';

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

// cardsจริงในมือ (client จะใช้ข้อมูลจาก server + map หา name/desc)
type CardInstance = Card & { uid: string };

// นิยามการ์ดทั้งหมด (ฝั่ง client แค่ใช้เพื่อแสดงชื่อ/คำอธิบาย)
const CARD_DEFS: Card[] = [
  {
    id: 'BUFF_EXTRA_MOVE',
    name: 'FORGE',
    desc: 'Gain 1 extra move this turn (cannot capture piece)',
  },
  {
    id: 'DEF_SHIELD',
    name: 'SHIELD',
    desc: 'Protect chosen piece from being captured for 1 turn',
  },
  {
    id: 'COUNTER_SACRIFICE',
    name: 'SACRIFICE',
    desc: 'Counter: Revive just-lost piece by sacrificing 1 of your own',
  },
  {
    id: 'BUFF_PAWN_RANGE',
    name: 'HIT AND RUN',
    desc: 'Attach to any piece permanently. It gains 2 moves per turn (1st move captures naturally, 2nd move only repositions).',
  },
  {
    id: 'BUFF_SUMMON_PAWN',
    name: 'SUMMON PAWN',
    desc: 'Summon a new pawn on your starting rank (White 2, Black 7)',
  },
  {
    id: 'BUFF_SWAP_ALLY',
    name: 'SWAP',
    desc: 'Swap positions of 2 of your pieces',
  },
  {
    id: 'DEF_SAFE_ZONE',
    name: 'SAFE ZONE',
    desc: 'Create a 3x3 safe zone preventing captures for 1 turn',
  },
  {
    id: 'AOE_BLAST',
    name: 'RNG BLAST',
    desc: 'Randomly destroy 1 piece in a 3x3 area after 2 of your turns',
  },
  {
    id: 'CLEANSE_BUFFS',
    name: 'CLEANSE',
    desc: 'Remove effects and buffs from the board',
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
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showRules, setShowRules] = useState(false);

  // Auth Guard
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        router.push('/login?redirect=/room/' + roomId);
      } else {
        setUser(u);
        setAuthLoading(false);
      }
    });
    return () => unsub();
  }, [router, roomId]);

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
  const [hasSubmittedSurvey, setHasSubmittedSurvey] = useState(false);
  const [connectionTimeMs, setConnectionTimeMs] = useState(0);
  const [pings, setPings] = useState<number[]>([]);
  const [cardsPlayedLog, setCardsPlayedLog] = useState<string[]>([]);
  const [checkSide, setCheckSide] = useState<'w' | 'b' | null>(null);

  // restart state
  const [now, setNow] = useState<number>(Date.now());
  const [restartVotes, setRestartVotes] = useState<Set<'w' | 'b'>>(new Set());
  const [restartCounting, setRestartCounting] = useState(false);
  const [restartStartedAt, setRestartStartedAt] = useState<number | null>(null);
  const [restartDuration, setRestartDuration] = useState<number>(5);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalMovesMap, setLegalMovesMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!socket || isOver) return;
    const interval = setInterval(() => {
      const start = Date.now();
      socket.emit('game:ping', () => {
        setPings(prev => [...prev, Date.now() - start]);
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [socket, isOver]);
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
  const [hitAndRunActiveSquare, setHitAndRunActiveSquare] = useState<string | null>(null);
  const [revivedSquareThisTurn, setRevivedSquareThisTurn] = useState<string | null>(null);
  const [aoe, setAoe] = useState<{ by: 'w' | 'b' | null; center: string | null; remaining?: number | null } | null>(
    null
  );

  const [hand, setHand] = useState<CardInstance[]>([]);
  const [cardPlayedBy, setCardPlayedBy] = useState<'w' | 'b' | null>(null);
  const [lockedCardId, setLockedCardId] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<{
    cardId: string;
    uid: string;
    payload: any;
    label: string;
  } | null>(null);

  // overlays (โหมดSelect Targetของการ์ด)
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
    const t0 = Date.now();

    (async () => {
      const uid = user?.displayName || user?.uid || 'guest';
      const res: any = await joinRoom(String(roomId), uid);
      setConnectionTimeMs(Date.now() - t0);

      if (!mounted) return;
      if (!res.ok) {
        alert('Cannot enter room: ' + (res.reason ?? 'unknown'));
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
      if (res.hitAndRunActiveSquare !== undefined) setHitAndRunActiveSquare(res.hitAndRunActiveSquare);
      if (res.revivedSquareThisTurn !== undefined) setRevivedSquareThisTurn(res.revivedSquareThisTurn);
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
        if (data.hitAndRunActiveSquare !== undefined) setHitAndRunActiveSquare(data.hitAndRunActiveSquare);
        if (data.revivedSquareThisTurn !== undefined) setRevivedSquareThisTurn(data.revivedSquareThisTurn);
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
        window.location.reload();
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

  // ฟัง hand update จาก server (เวลาจั่ว/used card)
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
    const senderName = user?.displayName || user?.uid.substring(0, 5) || (color ?? 'spectator');
    socket.emit('chat:message', {
      roomId,
      text: message,
      from: senderName,
    });
    setMessage('');
  }

  // vote restart
  function voteRestart() {
    socket.emit('game:restart:vote', { roomId }, (ack: any) => {
      if (!ack?.ok) alert(ack?.reason || 'Cannot click ready to restart');
    });
  }

  // resign
  function resignGame() {
    if (!confirm('Are you sure you want to resign?')) return;
    socket.emit('game:resign', { roomId }, (ack: any) => {
      if (!ack?.ok) alert(ack?.reason || 'Failed to resign');
    });
  }

  const anySelecting =
    selectingShield ||
    selectingCounterSac ||
    selectingPawnRange ||
    selectingSummonPawn ||
    selectingSwap ||
    selectingSafeZone ||
    selectingAoe; function reportBug() { const text = prompt('Please describe the bug or report an issue:'); if (!text) return; const uid = user?.displayName || user?.uid || 'guest'; socket.emit('game:report_bug', { roomId, text, uid }, () => { alert('Thanks for your feedback!'); }); }

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

  function confirmPendingTarget() {
    if (!pendingTarget) return;

    socket.emit(
      'card:play',
      {
        roomId,
        color,
        card: pendingTarget.cardId,
        uid: pendingTarget.uid,
        payload: pendingTarget.payload,
      },
      (ack: any) => {
        if (!ack?.ok) {
          alert(ack?.reason || 'Play card failed');
        } else {
          setCardsPlayedLog(prev => [...prev, pendingTarget.cardId]);
        }
        cancelSelection();
      }
    );
  }

  function cancelSelection() {
    setPendingTarget(null);
    setLockedCardId(null);
    setSelectingShield(false);
    setShieldCardUid(null);
    setSelectingCounterSac(false);
    setCounterCardUid(null);
    setSelectingPawnRange(false);
    setPawnRangeCardUid(null);
    setSelectingSummonPawn(false);
    setSummonCardUid(null);
    setSelectingSwap(false);
    setSwapCardUid(null);
    setSwapFirstSquare(null);
    setSelectingSafeZone(false);
    setSafeZoneCardUid(null);
    setSelectingAoe(false);
    setAoeCardUid(null);
  }

  // ---- play cards ----
  function playCard(card: CardInstance) {
    if (!meSide || turn !== meSide) return;

    // ป้องกันPlayหลายcardsในเทิร์นเดียว
    if (cardPlayedBy === meSide) {
      alert('You have already played a card this turn');
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

    // CLEANSE_BUFFS หรือการ์ดไม่ต้องเลือกเป้า (FORGE)
    setPendingTarget({
      cardId: card.id,
      uid: card.uid,
      payload: {},
      label: 'Ready to cast'
    });
  }

  // ฟังก์ชันเพื่อให้ปุ่ม Cancel เรียกใช้ง่ายๆ
  const renderCancelBtn = () => (
    <button onClick={cancelSelection} className="ml-3 px-3 py-1 bg-red-500/80 hover:bg-red-500 text-white rounded text-xs font-bold transition-colors">
      Cancel
    </button>
  );

  const renderConfirmBtn = () => (
    <button onClick={confirmPendingTarget} className="ml-3 px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-white rounded text-xs font-bold transition-colors">
      CONFIRM TARGET
    </button>
  );

  // ---- target handlers ----

  // shield target
  function handleSquareClickForShield(square: Square) {
    if (!selectingShield || !shieldCardUid) return;

    const p: any = gameRef.current.get(square as any);
    if (!p || p.color !== meSide) {
      alert('You can only select your own piece');
      setSelectingShield(false);
      setShieldCardUid(null);
      return;
    }

    setPendingTarget({
      cardId: 'DEF_SHIELD',
      uid: shieldCardUid,
      payload: { square },
      label: square
    });
  }

  // counter target
  function handleSquareClickForCounter(square: Square) {
    if (!selectingCounterSac || !counterCardUid) return;
    const p: any = gameRef.current.get(square as any);
    if (!p || !p.color || p.color !== meSide || p.type === 'k') {
      alert('Select your own piece (except King) to sacrifice');
      return;
    }

    setPendingTarget({
      cardId: 'COUNTER_SACRIFICE',
      uid: counterCardUid,
      payload: { sacrificeSquare: square },
      label: square
    });
  }

  // BUFF_PAWN_RANGE (HIT AND RUN): เลือกหมากของเราตัวไหนก็ได้
  function handleSquareClickForPawnRange(square: Square) {
    if (!selectingPawnRange || !pawnRangeCardUid) return;
    const p: any = gameRef.current.get(square as any);
    if (!p || p.color !== meSide) {
      alert('You can only select your own piece');
      return;
    }

    setPendingTarget({
      cardId: 'BUFF_PAWN_RANGE',
      uid: pawnRangeCardUid,
      payload: { square },
      label: square
    });
  }

  // BUFF_SUMMON_PAWN: เลือกช่องว่างบนแถว 2(ขาว) / 7(ดำ)
  function handleSquareClickForSummon(square: Square) {
    if (!selectingSummonPawn || !summonCardUid) return;

    const p: any = gameRef.current.get(square as any);
    if (p) {
      alert('You must select an empty square');
      return;
    }

    const rank = parseInt(square[1]);
    if (meSide === 'w' && rank !== 2) {
      alert('White must summon on rank 2');
      return;
    }
    if (meSide === 'b' && rank !== 7) {
      alert('Black must summon on rank 7');
      return;
    }

    setPendingTarget({
      cardId: 'BUFF_SUMMON_PAWN',
      uid: summonCardUid,
      payload: { square },
      label: square
    });
  }

  // BUFF_SWAP_ALLY: Select 2 allied pieces
  function handleSquareClickForSwap(square: Square) {
    if (!selectingSwap || !swapCardUid) return;

    const p: any = gameRef.current.get(square as any);
    if (!p || p.color !== meSide) {
      alert('You can only select your own piece');
      return;
    }

    if (!swapFirstSquare) {
      // เลือกตัวแรก
      setSwapFirstSquare(square);
      return;
    }

    if (swapFirstSquare === square) {
      alert('You must select a different square');
      return;
    }

    setPendingTarget({
      cardId: 'BUFF_SWAP_ALLY',
      uid: swapCardUid,
      payload: { a: swapFirstSquare, b: square },
      label: `${swapFirstSquare} & ${square}`
    });
  }

  // DEF_SAFE_ZONE 3×3: เลือก center ช่องเดียว
  function handleSquareClickForSafeZone(square: Square) {
    if (!selectingSafeZone || !safeZoneCardUid) return;

    setPendingTarget({
      cardId: 'DEF_SAFE_ZONE',
      uid: safeZoneCardUid,
      payload: { square },
      label: square
    });
  }

  // AOE_BLAST 3×3: เลือก center ช่องเดียว
  function handleSquareClickForAoe(square: Square) {
    if (!selectingAoe || !aoeCardUid) return;

    setPendingTarget({
      cardId: 'AOE_BLAST',
      uid: aoeCardUid,
      payload: { square },
      label: square
    });
  }

  const inviteUrl = typeof window !== 'undefined' ? window.location.href : '';

  // custom square styles (shield + safeZone 3x3 + AOE center + first swap)
  const customSquareStyles: Record<string, any> = {};

  if (pendingTarget) {
    const p = pendingTarget.payload;
    const highlightTarget = (sq: string) => {
      if (!sq) return;
      customSquareStyles[sq] = {
        ...(customSquareStyles[sq] || {}),
        boxShadow: 'inset 0 0 15px 4px rgba(236,72,153,0.8)', // pink glow
        backgroundColor: 'rgba(236,72,153,0.4)',
      };
    };
    if (p.square) highlightTarget(p.square);
    if (p.sacrificeSquare) highlightTarget(p.sacrificeSquare);
    if (p.a) highlightTarget(p.a);
    if (p.b) highlightTarget(p.b);
  }

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

  if (shield.square) {
    customSquareStyles[shield.square] = {
      ...(customSquareStyles[shield.square] || {}),
      boxShadow: 'inset 0 0 15px 4px rgba(6,182,212,0.8)',
      backgroundColor: 'rgba(6,182,212,0.3)',
    };
  }



  if (hitAndRunActiveSquare) {
    customSquareStyles[hitAndRunActiveSquare] = {
      ...(customSquareStyles[hitAndRunActiveSquare] || {}),
      boxShadow: 'inset 0 0 15px 4px rgba(234,88,12,0.8)', // orange glow
      backgroundColor: 'rgba(234,88,12,0.3)',
    };
  }

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

  if (hoverSquare && (selectingAoe || selectingSafeZone)) {
    const area = getArea3x3(hoverSquare);
    Object.keys(area).forEach((sq) => {
      customSquareStyles[sq] = {
        ...(customSquareStyles[sq] || {}),
        backgroundColor: selectingAoe ? 'rgba(239,68,68,0.4)' : 'rgba(234,179,8,0.4)',
        boxShadow: selectingAoe ? 'inset 0 0 0 3px rgba(239,68,68,0.7)' : 'inset 0 0 0 3px rgba(234,179,8,0.7)'
      };
    });
  }

  function describeBuffsOnSquare(
    sq: string | null,
    opts: {
      shield: { by: 'w' | 'b' | null; square: string | null };
      safeZone: { by: 'w' | 'b' | null; square: string | null };
      pawnRange: Record<string, any>;
      hitAndRunActiveSquare: string | null; revivedSquareThisTurn: string | null;
      aoe: { by: 'w' | 'b' | null; center: string | null; remaining?: number | null } | null;
    }
  ): string[] {
    if (!sq) return [];
    const buffs: string[] = [];
    const { shield, safeZone, pawnRange, aoe, hitAndRunActiveSquare, revivedSquareThisTurn } = opts;

    if (shield.square === sq) {
      buffs.push('Shield: Immune to capture for 1 turn');
    }

    if (pawnRange[sq]) {
      buffs.push('Hit and Run: Move twice (2nd move cannot capture)');
    }
    if (hitAndRunActiveSquare === sq) {
      buffs.push('Moving 2nd time (Cannot capture/move others)');
    }
    if (revivedSquareThisTurn === sq) {
      buffs.push('Just Revived (Cannot capture this turn)');
    }

    if (hitAndRunActiveSquare) {
      customSquareStyles[hitAndRunActiveSquare] = {
        ...(customSquareStyles[hitAndRunActiveSquare] || {}),
        boxShadow: 'inset 0 0 15px 4px rgba(234,88,12,0.8)', // orange glow
        backgroundColor: 'rgba(234,88,12,0.3)',
      };
    }

    if (safeZone.square) {
      const area = getArea3x3(safeZone.square);
      if (area[sq]) {
        buffs.push('Safe Zone: 3x3 Safe Area');
      }
    }

    if (aoe?.center) {
      const area = getArea3x3(aoe.center);
      if (area[sq]) {
        buffs.push(
          `AOE Zone: Blast Area (Remaining ${aoe.remaining ?? '?'} turn for caster)`
        );
      }
    }

    return buffs;
  }
  // คืน object map ของช่องที่เดินไปได้ เช่น { e4: true, d5: true }
  function computeLegalMovesFrom(square: Square | null) {
    if (!square) return {};
    try {
      // Force side to move if we are in Extra Move phase
      if (meSide) {
        let fenNow = gameRef.current.fen();
        const parts = fenNow.split(' ');
        if (parts[1] !== meSide) {
          parts[1] = meSide;
          const adjustedFen = parts.join(' ');
          gameRef.current = new Chess(adjustedFen);
        }
      }

      // บอก TS ว่า square เป็น Square
      const moves = gameRef.current.moves({ square: square as Square, verbose: true }) as any[] | string[];
      const out: Record<string, boolean> = {};
      if (!moves) return out;
      for (const m of moves as any[]) {
        if (m && m.to && m.captured && (square as string) === revivedSquareThisTurn) continue;
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

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">
        Checking login status...
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8 grid gap-4 md:grid-cols-[1fr_320px]">
      {/* LEFT */}
      <div className="bg-gray-900 rounded-2xl p-4 text-white flex flex-col gap-3">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <div>
            Room: <span className="font-mono">{String(roomId)}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-gray-800 px-3 py-1 rounded-full text-sm">
              {user.photoURL && (
                <img src={user.photoURL} alt="Profile" className="w-5 h-5 rounded-full" />
              )}
              <span>{user.displayName || 'Player'}</span>
            </div>
            <div>
              You are: <b>{color ?? 'Joining room...'}</b> | Turn:{' '}
              <b>{turn === 'w' ? 'white' : 'black'}</b>
            </div>
            {!isOver && meSide && (
              <button
                onClick={resignGame}
                className="px-3 py-1 text-xs rounded-lg bg-red-600 hover:bg-red-700 font-bold transition font-mono shadow-sm border border-red-500"
                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
              >
                Resign 🏳️
              </button>
            )}
            <button
              onClick={() => window.location.href = '/'}
              className="px-3 py-1 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 font-bold transition font-mono shadow-sm border border-slate-600 ml-2"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
            >
              Home 🏠
            </button>
            <button
              onClick={reportBug}
              className="px-3 py-1 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 font-bold transition font-mono shadow-sm border border-indigo-500 ml-2"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
            >
              Report Bug 🐛
            </button>
            <button
              onClick={() => setShowRules(true)}
              className="px-3 py-1 text-xs rounded-lg bg-orange-600 hover:bg-orange-500 font-bold transition font-mono shadow-sm border border-orange-500 ml-2"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
            >
              Rules 📖
            </button>
          </div>
        </div>

        {/* CLOCK UI */}
        <div className="flex justify-center gap-4 mt-1 text-sm">
          <div
            className={`px-3 py-1 rounded-lg ${clockRunning === 'w' ? 'bg-emerald-600' : 'bg-gray-700'
              }`}
          >
            White ⏱ {formatTime(timeLeft.w)}
          </div>
          <div
            className={`px-3 py-1 rounded-lg ${clockRunning === 'b' ? 'bg-emerald-600' : 'bg-gray-700'
              }`}
          >
            Black ⏱ {formatTime(timeLeft.b)}
          </div>
        </div>

        <div className="w-[95vw] sm:w-[560px] max-w-full aspect-square mx-auto self-center flex items-center justify-center">
          <div className="w-full h-full relative">
            <Chessboard
              id="room-board"
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
                if (hitAndRunActiveSquare && source !== hitAndRunActiveSquare) {
                  alert('You must move the active hit and run piece.');
                  return false;
                }
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
                  // คลิกที่ช่องเดิม → Cancel selection
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

                  // คลิกที่อื่นที่ไม่ใช่เป้า → Cancel
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
                    hitAndRunActiveSquare, revivedSquareThisTurn,
                    aoe,
                  });
                  if (!buffs.length) return 'No buffs';
                  return buffs.join(' | ');
                })()}
              </div>
            )}
          </div>
        </div>

        {/* CARDS */}
        <div className="flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-lg drop-shadow-sm">Hand</h3>
            <div className="text-sm px-3 py-1 rounded-full bg-black/30 border border-white/10">
              Deck: {deckCount ?? '-'} | Graveyard: {graveyardCount ?? '-'}
            </div>
          </div>
          <div className="flex gap-4 overflow-x-auto px-4 py-6 -mx-4 snap-x hide-scrollbar">
            {hand.map((c) => {
              const playable = !isOver && !!meSide && turn === meSide && cardPlayedBy !== meSide;
              const isLocked = lockedCardId === c.uid;
              let tKey = 'indigo';
              if (['BUFF_EXTRA_MOVE', 'BUFF_PAWN_RANGE', 'AOE_BLAST'].includes(c.id)) tKey = 'rose';
              else if (['DEF_SHIELD', 'DEF_SAFE_ZONE', 'CLEANSE_BUFFS'].includes(c.id)) tKey = 'sky';
              else if (['COUNTER_SACRIFICE', 'BUFF_SWAP_ALLY', 'BUFF_SUMMON_PAWN'].includes(c.id)) tKey = 'amber';

              const themes: Record<string, any> = {
                rose: {
                  border: 'border-rose-500/60', hoverBorder: 'hover:border-rose-400', activeBorder: 'border-2 border-rose-500',
                  shadow: 'shadow-[0_30px_60px_-15px_rgba(244,63,94,0.6)]', hoverShadow: 'hover:shadow-[0_20px_40px_-15px_rgba(244,63,94,0.5)]',
                  gradient: 'from-rose-950/90 via-black/40 to-black/90',
                  btn: 'border-rose-500/50 bg-rose-500/10 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.2)]'
                },
                sky: {
                  border: 'border-sky-500/60', hoverBorder: 'hover:border-sky-400', activeBorder: 'border-2 border-sky-500',
                  shadow: 'shadow-[0_30px_60px_-15px_rgba(14,165,233,0.6)]', hoverShadow: 'hover:shadow-[0_20px_40px_-15px_rgba(14,165,233,0.5)]',
                  gradient: 'from-sky-950/90 via-black/40 to-black/90',
                  btn: 'border-sky-500/50 bg-sky-500/10 text-sky-300 shadow-[0_0_10px_rgba(14,165,233,0.2)]'
                },
                amber: {
                  border: 'border-amber-500/60', hoverBorder: 'hover:border-amber-400', activeBorder: 'border-2 border-amber-500',
                  shadow: 'shadow-[0_30px_60px_-15px_rgba(245,158,11,0.6)]', hoverShadow: 'hover:shadow-[0_20px_40px_-15px_rgba(245,158,11,0.5)]',
                  gradient: 'from-amber-950/90 via-black/40 to-black/90',
                  btn: 'border-amber-500/50 bg-amber-500/10 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                },
                indigo: {
                  border: 'border-indigo-500/40', hoverBorder: 'hover:border-indigo-400', activeBorder: 'border-2 border-indigo-400',
                  shadow: 'shadow-[0_30px_60px_-15px_rgba(99,102,241,0.6)]', hoverShadow: 'hover:shadow-[0_20px_40px_-15px_rgba(99,102,241,0.5)]',
                  gradient: 'from-black/90 via-black/20 to-black/90',
                  btn: 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300 shadow-[0_0_10px_rgba(99,102,241,0.2)]'
                }
              };
              const t = themes[tKey];

              return (
                <div
                  key={c.uid}
                  onClick={() => {
                    if (playable && lockedCardId !== c.uid) {
                      setLockedCardId(c.uid);
                      playCard(c);
                    }
                  }}
                  className={`relative shrink-0 rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 snap-center
                    ${isLocked
                      ? `w-40 h-56 sm:w-48 sm:h-72 md:w-56 md:h-80 z-50 -translate-y-4 md:-translate-y-6 ${t.shadow} ${t.activeBorder} scale-105 mx-1 md:mx-2`
                      : `w-28 h-40 sm:w-36 sm:h-52 md:w-44 md:h-64 ${playable ? `cursor-pointer hover:-translate-y-2 md:hover:-translate-y-4 ${t.hoverShadow} border ${t.border} ${t.hoverBorder}` : 'cursor-not-allowed opacity-60 grayscale-[50%] border border-gray-700'}`
                    }
                    group bg-gray-900 flex flex-col justify-between
                  `}
                >
                  <img
                    src={`/cards/${c.id}.png`}
                    alt={c.name}
                    className="absolute inset-0 w-full h-full object-cover z-0 transition-transform duration-500 group-hover:scale-110"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />

                  <div className={`absolute inset-0 bg-gradient-to-b ${t.gradient} z-10 pointer-events-none`} />

                  <div className="relative z-20 p-4 flex flex-col h-full justify-between pointer-events-none">
                    <div>
                      <div className="font-extrabold text-sm sm:text-base md:text-xl text-white tracking-wide uppercase drop-shadow-md" style={{ textShadow: "0 2px 4px rgba(0,0,0,0.8)" }}>{c.name}</div>

                      <div className={`text-[10px] sm:text-xs text-slate-200 mt-1 md:mt-2 font-medium leading-relaxed md:leading-relaxed drop-shadow-md bg-black/50 p-1.5 md:p-2.5 rounded-lg backdrop-blur-md border border-white/10 transition-opacity duration-300 ${isLocked ? 'opacity-100' : 'opacity-0 hidden'}`} style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}>
                        {c.desc}
                      </div>
                    </div>

                    <div className="mt-auto pointer-events-auto">
                      {isLocked ? (
                        <div className="flex flex-col gap-2">
                          {pendingTarget ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmPendingTarget();
                              }}
                              className="w-full font-bold px-3 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-400 hover:to-emerald-300 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)] hover:scale-[1.02] transition-all animate-in fade-in zoom-in duration-200"
                            >
                              {Object.keys(pendingTarget.payload).length === 0 ? 'CONFIRM USE' : 'CONFIRM TARGET'}
                            </button>
                          ) : (
                            <div className={`w-full text-center font-bold px-3 py-2 rounded-xl border-2 border-dashed ${t.btn}`}>
                              SELECT TARGET
                            </div>
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelSelection();
                            }}
                            className="w-full font-bold px-3 py-1.5 rounded-xl bg-white/10 hover:bg-red-500/20 hover:text-red-300 text-gray-300 transition-all text-xs"
                          >
                            CANCEL
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (playable) {
                              setLockedCardId(c.uid);
                              playCard(c);
                            }
                          }}
                          disabled={!playable}
                          className={`w-full font-bold px-3 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-emerald-500 text-white shadow-[0_0_20px_rgba(99,102,241,0.4)] transition-all
                            ${playable ? 'translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 hover:scale-[1.02]' : 'hidden'}
                          `}
                        >
                          SELECT CARD
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
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
              Copy Link
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT: chat */}
      <div className="bg-gray-900 rounded-2xl p-4 text-white flex flex-col h-[400px] md:h-[560px]">
        <div className="font-semibold">Chat</div>
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
            placeholder="Type a message..."
          />
          <button
            onClick={sendChat}
            className="px-3 py-1.5 rounded bg-indigo-500 hover:bg-indigo-600"
          >
            Send
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
                  if (!result) return 'Game Over';
                  if (result.type === 'checkmate') {
                    const iWin = meSide && result.winner === meSide;
                    return iWin ? 'You Win! (Checkmate)' : 'You Lose (Checkmate)';
                  }
                  if (result.type === 'stalemate') return 'Draw (Stalemate)';
                  if (result.type === 'insufficient') return 'Draw (Insufficient Material)';
                  if (result.type === 'timeout') return 'Time Out';
                  if (result.type === 'resign') {
                    const iWin = meSide && result.winner === meSide;
                    return iWin ? 'You Win! (Opponent Resigned 🏳️)' : 'You Resigned 😔';
                  }
                  return 'Game Over';
                })()}
              </div>
              {result?.winner && (
                <div className="text-sm opacity-80">
                  Winner: {result.winner === 'w' ? 'White' : 'Black'}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <div className="text-sm mb-1">Readiness:</div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-1 rounded text-xs ${restartVotes.has('w') ? 'bg-emerald-600' : 'bg-gray-700'
                      }`}
                  >
                    White {restartVotes.has('w') ? '✔' : '…'}
                  </span>
                  <span
                    className={`px-2 py-1 rounded text-xs ${restartVotes.has('b') ? 'bg-emerald-600' : 'bg-gray-700'
                      }`}
                  >
                    Black {restartVotes.has('b') ? '✔' : '…'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {restartCounting ? (
                  <div className="px-3 py-1.5 rounded bg-amber-600 text-white">
                    Restart in {remain}s
                  </div>
                ) : (
                  <button
                    onClick={voteRestart}
                    className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                    disabled={!meSide || restartVotes.has(meSide)}
                  >
                    {!meSide || !restartVotes.has(meSide)
                      ? 'Ready to Restart'
                      : 'Waiting for opponent...'}
                  </button>
                )}
                <button
                  onClick={() => window.location.href = '/'}
                  className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 font-bold transition shadow-sm border border-slate-600 text-white ml-2"
                >
                  Back to Home
                </button>
              </div>
            </div>

            {!restartCounting && (
              <div className="text-xs opacity-70 mt-2 text-center"></div>
            )}
          </div>
        </div>
      )}

      <ExperienceSurvey
        isOpen={isOver && !hasSubmittedSurvey}
        onSubmit={(answers) => {
          const timeL = meSide === 'w' ? timeLeft.w : timeLeft.b;
          const uid = user?.displayName || user?.uid || 'guest';
          socket.emit('game:summary_report', {
            roomId,
            userId: uid, email: user?.email || null,
            timeLeft: timeL,
            cardsPlayed: cardsPlayedLog,
            connectionTimeMs,
            avgPing: pings.length > 0 ? Math.round(pings.reduce((a,b)=>a+b,0)/pings.length) : 0,
            maxPing: pings.length > 0 ? Math.max(...pings) : 0,
            surveyAnswers: answers
          });
          setHasSubmittedSurvey(true);
        }}
        onClose={() => {
          const timeL = meSide === 'w' ? timeLeft.w : timeLeft.b;
          const uid = user?.displayName || user?.uid || 'guest';
          socket.emit('game:summary_report', {
            roomId,
            userId: uid, email: user?.email || null,
            timeLeft: timeL,
            cardsPlayed: cardsPlayedLog,
            connectionTimeMs,
            avgPing: pings.length > 0 ? Math.round(pings.reduce((a,b)=>a+b,0)/pings.length) : 0,
            maxPing: pings.length > 0 ? Math.max(...pings) : 0,
            surveyAnswers: null
          });
        }}
      />

      <RulesModal isOpen={showRules} onClose={() => setShowRules(false)} />
    </div>
  );
}
