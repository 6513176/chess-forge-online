// server.js
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Chess } from 'chess.js';
import { freshCardState, drawOneForSide, playCardOnServer, resolveAoe } from './cards.server.js';
import { MongoClient } from 'mongodb';

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const client = new MongoClient(mongoUri);
let db;

client.connect()
  .then(() => {
    db = client.db('chess_forge');
    console.log('Connected to MongoDB');
  })
  .catch((err) => console.error('Failed to connect to MongoDB:', err));

const cardName = (id) => {
  switch (id) {
    case 'BUFF_EXTRA_MOVE': return 'Forge (Extra Move)';
    case 'DEF_SHIELD': return 'Shield';
    case 'COUNTER_SACRIFICE': return 'Sacrifice';
    case 'BUFF_PAWN_RANGE': return 'Range Buff';
    case 'BUFF_SUMMON_PAWN': return 'Summon Pawn';
    case 'BUFF_SWAP_ALLY': return 'Swap';
    case 'DEF_SAFE_ZONE': return 'Safe Zone';
    case 'AOE_BLAST': return 'AOE Blast';
    case 'CLEANSE_BUFFS': return 'Cleanse';
    default: return id;
  }
};

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' }, transports: ['websocket'] });

app.get('/health', (_, res) => res.status(200).send('OK'));

// ---------- helpers ----------
const opp = (s) => (s === 'w' ? 'b' : 'w');
const INITIAL_CLOCK_SEC = 420;

// 3×3 รอบศูนย์กลาง
function getArea3x3(centerSquare) {
  if (!centerSquare || centerSquare.length !== 2) return [];
  const file = centerSquare[0].charCodeAt(0); // 'a'..'h'
  const rank = parseInt(centerSquare[1], 10); // 1..8
  const squares = [];

  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      const f = file + df;
      const r = rank + dr;
      if (f < 'a'.charCodeAt(0) || f > 'h'.charCodeAt(0)) continue;
      if (r < 1 || r > 8) continue;
      squares.push(String.fromCharCode(f) + r);
    }
  }
  return squares;
}

// ---------- room state ----------
const rooms = new Map();

function freshRoomState() {
  return {
    players: new Map(), // Map<socketId, 'w'|'b'>
    disconnectedColors: new Set(), // สีของผู้เล่นที่หลุดไป
    deletionTimer: null, // ตัวนับเวลาลบห้อง
    turn: 'w',
    extra: { w: 0, b: 0 },
    isExtraMovePhase: { w: false, b: false },
    shield: { by: null, square: null },
    counter: { by: null, armed: false },
    pendingCounter: null,
    lastCapture: null,
    cardPlayedBy: null,
    captureCount: { w: 0, b: 0 },

    // บัพ/โซน
    pawnRange: {}, // { 'e4': true }
    hitAndRunActiveSquare: null,
    safeZone: { by: null, square: null }, // center ของโซน 3x3
    aoe: null, // { by, center, remaining }

    // 🎴 ระบบการ์ดต่อห้อง
    cards: freshCardState(),

    // เก็บกระดานปัจจุบันไว้ที่เซิร์ฟเวอร์
    fen: new Chess().fen(),

    // ⏱ สถานะนาฬิกา (server authoritative)
    clock: {
      baseSec: INITIAL_CLOCK_SEC,
      w: INITIAL_CLOCK_SEC * 1000,
      b: INITIAL_CLOCK_SEC * 1000,
      running: null, // 'w' | 'b' | null (null = ยังไม่เริ่ม/หยุด)
      lastTickAt: null,
    },

    // สถานะเกม / ข้อจำกัด
    gameOver: false,
    result: null,
    noKingBy: null,

    // restart
    restart: {
      votes: new Set(),
      counting: false,
      timer: null,
      durationSec: 5,
      startedAt: null,
    },
  };
}

function ensureState(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, freshRoomState());
  return rooms.get(roomId);
}

function resetRoomInPlace(st) {
  const keepPlayers = st.players;
  if (st.restart.timer) clearTimeout(st.restart.timer);
  const next = freshRoomState();
  next.players = keepPlayers;
  return next;
}

// sync มือให้ฝั่งเดียว (ไม่ให้ศัตรูเห็น)
function syncHandToSide(roomId, side) {
  const st = rooms.get(roomId);
  if (!st) return;
  const hand = st.cards?.hands?.[side] || [];

  for (const [sockId, s] of st.players.entries()) {
    if (s === side) {
      io.to(sockId).emit('card:hand', hand);
    }
  }
}

// ประเมินจาก FEN หลังเดิน
function evaluateGameState(fen) {
  const ch = new Chess(fen);
  const sideToMove = ch.turn(); // 'w' | 'b'

  if (ch.isCheckmate()) {
    return {
      over: true,
      payload: { type: 'checkmate', winner: sideToMove === 'w' ? 'b' : 'w' },
    };
  }
  if (ch.isStalemate()) {
    return { over: true, payload: { type: 'stalemate' } };
  }
  if (ch.isInsufficientMaterial()) {
    return { over: true, payload: { type: 'insufficient' } };
  }
  if (ch.isCheck()) {
    return { over: false, payload: { type: 'check', sideInCheck: sideToMove } };
  }
  return { over: false, payload: { type: 'safe' } };
}




// ---------- clock loop (นับเวลาใน server ทุกห้อง เซิร์ฟเวอร์ทำแค่ดักจับ timeout) ----------
setInterval(() => {
  const now = Date.now();
  for (const [roomId, st] of rooms.entries()) {
    if (st.gameOver) continue;
    const clk = st.clock;
    if (!clk || !clk.running || !clk.lastTickAt) continue;

    const elapsed = now - clk.lastTickAt;
    const remaining = clk[clk.running] - elapsed;

    if (remaining <= 0) {
      // ⏱ หมดเวลา -> แพ้
      clk[clk.running] = 0;
      st.gameOver = true;
      const winner = opp(clk.running);
      st.result = { type: 'timeout', winner };
      clk.running = null;

      io.to(roomId).emit('clock:update', {
        w: Math.ceil(clk.w / 1000),
        b: Math.ceil(clk.b / 1000),
        running: null,
      });
      io.to(roomId).emit('game:over', st.result);
    } else {
      // ส่งอัปเดตเวลาให้ Client เดินทุกวินาทีแบบ Realtime นำหน้า (Client ยังไม่ได้ทำอนิเมชั่นเอง)
      const sendW = clk.running === 'w' ? remaining : clk.w;
      const sendB = clk.running === 'b' ? remaining : clk.b;

      io.to(roomId).emit('clock:update', {
        w: Math.ceil(sendW / 1000),
        b: Math.ceil(sendB / 1000),
        running: clk.running,
      });
    }
  }
}, 1000); // เช็คทุก 1 วินาที และส่งให้ Client อัปเดต UI

// ---------- socket ----------
io.on('connection', (socket) => {
  // สร้างห้อง
  socket.on('createRoom', (ack) => {
    try {
      let roomId;
      do {
        roomId = Math.random().toString(36).slice(2, 8);
      } while (rooms.has(roomId));
      rooms.set(roomId, freshRoomState());
      ack?.({ ok: true, roomId });
    } catch (err) {
      console.error('[createRoom] error:', err);
      ack?.({ ok: false, reason: 'server-error' });
    }
  });

  // เข้าห้อง
  socket.on('joinRoom', (roomId, ack) => {
    try {
      if (!roomId) return ack?.({ ok: false, reason: 'no-room-id' });
      const st = ensureState(roomId);

      //  สุ่มสี หรือให้ตัวละครที่ว่างอยู่ (เวลามีคนหลุด)
      const used = new Set(st.players.values());
      let color = null;

      // ยกเลิกการตั้งเวลาลบห้อง (ถ้ามี) เพราะมีคนเข้ามาใหม่
      if (st.deletionTimer) {
        clearTimeout(st.deletionTimer);
        st.deletionTimer = null;
      }

      if (!used.has('w') && !used.has('b')) {
        // ห้องว่างไม่มีคนเลย (อาจจะหลุดทั้งคู่ หรือ เพิ่งสร้างห้อง)
        if (st.disconnectedColors.size > 0) {
          // มีคนหลุด ให้สีแรกที่หลุดไป
          color = Array.from(st.disconnectedColors)[0];
        } else {
          color = Math.random() < 0.5 ? 'w' : 'b';
        }
      } else if (!used.has('w')) {
        color = 'w';
      } else if (!used.has('b')) {
        color = 'b';
      } else {
        return ack?.({ ok: false, reason: 'room-full' });
      }

      st.disconnectedColors.delete(color);

      socket.join(roomId);
      st.players.set(socket.id, color);
      const side = color; // 'w' | 'b'

      // ส่งสถานะทั้งหมดกลับไปเพื่อซิงก์ client
      ack?.({
        ok: true,
        color: color === 'w' ? 'white' : 'black',
        currentTurn: st.turn,
        fen: st.fen,
        extra: st.extra,
        shield: st.shield,
        safeZone: st.safeZone,
        pawnRange: st.pawnRange,
        hitAndRunActiveSquare: st.hitAndRunActiveSquare,
        aoe: st.aoe,
        cardPlayedBy: st.cardPlayedBy,
        clock: st.clock
          ? {
            w: Math.ceil(st.clock.w / 1000),
            b: Math.ceil(st.clock.b / 1000),
            running: st.clock.running,
            lastTickAt: st.clock.lastTickAt,
          }
          : null,
        hand: st.cards.hands[side] || [],
        deckCount: st.cards.deck.length,
        graveyardCount: st.cards.graveyard.length,
      });

      // 🎴 ส่งไพ่ในมือให้ player นี้อีกรอบผ่าน event
      io.to(socket.id).emit('card:hand', st.cards.hands[side] || []);

      socket.once('disconnect', () => {
        try {
          const s = rooms.get(roomId);
          if (!s) return;

          const disconnectedColor = s.players.get(socket.id);
          if (disconnectedColor) {
            s.disconnectedColors.add(disconnectedColor);
          }

          s.players.delete(socket.id);
          socket.to(roomId).emit('opponent-left');

          if (s.players.size === 0) {
            // ถ้าไม่มีคนอยู่ในห้องแล้ว ให้หน่วงเวลา 5 นาที (300,000 ms) ก่อนลบห้อง
            s.deletionTimer = setTimeout(() => {
              rooms.delete(roomId);
              console.log(`[Room] ${roomId} deleted after 5 minutes of inactivity.`);
            }, 5 * 60 * 1000);
          }
        } catch (err) {
          console.error('[disconnect] error:', err);
        }
      });
      io.to(socket.id).emit('card:hand', st.cards.hands[side] || [])


      io.to(socket.id).emit('card:counts', {
        deck: st.cards.deck.length,
        graveyard: st.cards.graveyard.length,
      });
    } catch (err) {
      console.error('[joinRoom] error:', err);
      ack?.({ ok: false, reason: 'server-error' });
    }
  });

  // แชท
  socket.on('chat:message', ({ roomId, text, from }) => {
    try {
      io.to(roomId).emit('chat:message', { text, from });
    } catch (err) {
      console.error('[chat:message] error:', err);
    }
  });

  // ---------- cards ----------
  socket.on('card:play', ({ roomId, color, card, uid, payload }, cb) => {
    try {
      const st = rooms.get(roomId);
      if (!st) return cb?.({ ok: false, reason: 'no-room' });
      if (st.gameOver) return cb?.({ ok: false, reason: 'game-over' });

      const side = color === 'white' ? 'w' : 'b';
      if (st.turn !== side) return cb?.({ ok: false, reason: 'not-your-turn' });
      if (st.cardPlayedBy === side) return cb?.({ ok: false, reason: 'card-already-used-this-turn' });

      const result = playCardOnServer({
        st,
        roomId,
        side,
        card,
        uid,
        payload,
        io,
        syncHandToSide,
      });

      // ถ้าเล่นสำเร็จ — ส่งจำนวนการ์ดล่าสุดให้ client ทุกคนในห้อง + log
      if (result && result.ok) {
        if (result.endsTurn) {
          st.turn = st.turn === 'w' ? 'b' : 'w';
          st.cardPlayedBy = null;
          st.noKingBy = null;

          if (st.shield.by && st.turn === st.shield.by) st.shield = { by: null, square: null };
          if (st.safeZone.by && st.turn === st.safeZone.by) st.safeZone = { by: null, square: null };

          if (st.safeZone.by && st.turn === st.safeZone.by) st.safeZone = { by: null, square: null };

          if (st.clock && !st.gameOver) {
            const now = Date.now();
            if (st.clock.running && st.clock.lastTickAt) {
              st.clock[st.clock.running] = Math.max(0, st.clock[st.clock.running] - (now - st.clock.lastTickAt));
            }
            st.clock.running = st.turn;
            st.clock.lastTickAt = now;
            io.to(roomId).emit('clock:update', {
              w: Math.ceil(st.clock.w / 1000),
              b: Math.ceil(st.clock.b / 1000),
              running: st.clock.running,
            });
          }

          io.to(roomId).emit('card:update', {
            cardPlayedBy: st.cardPlayedBy,
          noKingBy: st.noKingBy,
          hitAndRunActiveSquare: null,
            shield: st.shield,
            safeZone: st.safeZone
          });
        }

        io.to(roomId).emit('card:counts', {
          deck: st.cards.deck.length,
          graveyard: st.cards.graveyard.length,
        });

        const sideName = side === 'w' ? 'White' : 'Black';
        io.to(roomId).emit('chat:message', {
          from: 'system',
          text: `[CARD] ${sideName} plays ${cardName(card)}`,
        });
      }

      cb?.(result);
    } catch (err) {
      console.error('[card:play] error:', err);
      cb?.({ ok: false, reason: 'server-error' });
    }
  });

  // ---------- moves ----------
  socket.on('game:move', ({ roomId, move, fenBefore, fenAfter, by, capturedSquare }, cb) => {
    try {
      const st = rooms.get(roomId);
      if (!st) return cb?.({ ok: false, reason: 'no-room' });
      if (st.gameOver) return cb?.({ ok: false, reason: 'game-over' });

      const side = st.players.get(socket.id);
      if (!side) return cb?.({ ok: false, reason: 'not-in-room' });

      // ตรวจสิทธิ์ตาเดิน
      if (side !== st.turn || side !== by) {
        return cb?.({ ok: false, reason: 'not-your-turn' });
      }

      // ✅ เช็คว่าตานี้เป็น extra move จากการ์ด BUFF_EXTRA_MOVE หรือเปล่า
      const isExtraPhase = st.isExtraMovePhase?.[side] === true;
      const fromRangeBuff = st.pawnRange && st.pawnRange[move?.from] ? true : false; // ไว้ใช้ข้อ 2 ต่อ

      // เริ่มจับเวลาครั้งแรก
      if (st.clock && !st.clock.running) {
        st.clock.running = st.turn;
        st.clock.lastTickAt = Date.now();
      }

      // ถ้าเป็น extra move → ห้ามกิน "อะไรทั้งนั้น"
      if (isExtraPhase && move.capturedPieceType) {
        socket.emit('game:moveRejected', {
          reason: 'Extra move allows movement only, no capturing',
        });
        return cb?.({ ok: false, reason: 'extra-move-no-capture' });
      }



      // กันกินช่องที่เป็น safe zone (3x3 รอบ center)
      if (st.safeZone?.square && capturedSquare) {
        const area = getArea3x3(st.safeZone.square);
        if (area.includes(capturedSquare)) {
          socket.emit('game:moveRejected', { reason: 'Safe zone' });
          return cb?.({ ok: false, reason: 'safe-zone' });
        }
      }

      // กันกินชิ้นที่ติดโล่
      if (st.shield.square && capturedSquare && capturedSquare === st.shield.square) {
        socket.emit('game:moveRejected', { reason: 'Shielded' });
        return cb?.({ ok: false, reason: 'shielded' });
      }

      // ย้ายโล่ตาม
      if (st.shield.by === side && st.shield.square === move.from) {
        st.shield.square = move.to;
        io.to(roomId).emit('card:update', { shield: st.shield });
      }

      // บันทึกการ “ตายล่าสุด” + นับการกิน + แจกการ์ดทุก 2 คิล
      if (capturedSquare) {
        st.lastCapture = {
          victim: opp(side),
          capturedSquare,
          fenAfter,
          attackerFrom: move.from,
          attackerTo: move.to,
          attackerPieceType: move.attackerPieceType || null,
          capturedPieceType: move.capturedPieceType || null,
        };

        st.captureCount[side] = (st.captureCount?.[side] ?? 0) + 1;

        // ✅ log ลงแชท
        const sideName = side === 'w' ? 'White' : 'Black';
        const atk = move.attackerPieceType || '?';
        const vic = move.capturedPieceType || '?';
        const text = `[CAPTURE] ${sideName} ${atk}@${move.from} x ${vic}@${capturedSquare}`;
        io.to(roomId).emit('chat:message', { text, from: 'system' });

        // ทุก ๆ 2 คิล → จั่วการ์ด 1 ใบจากเด็ค
        if (st.captureCount[side] % 2 === 0) {
          drawOneForSide(st.cards, side);
          syncHandToSide(roomId, side);

          // ส่งจำนวนการ์ดให้ client
          io.to(roomId).emit('card:counts', {
            deck: st.cards.deck.length,
            graveyard: st.cards.graveyard.length,
          });
        }
      }

      // --- จัดการเทิร์น / เสริมพลัง / อายุบัพ ---
      const hadExtra = st.extra[side] > 0;
      const pieceHasRangeBuff = !!(st.pawnRange && st.pawnRange[move.from]);
      
      // ให้สิทธิ์เดินเบี้ยอีกครั้งเฉพาะเกมที่ยังไม่ได้ใช้โควต้า Range Buff ในเทิร์นนี้
      const usedRangeBuff = pieceHasRangeBuff && !st.hitAndRunActiveSquare;

      if (hadExtra || usedRangeBuff) {
        // ✅ ตานี้ยังเป็นฝั่งเดิม (ได้เดินต่ออีก 1 ครั้ง)
        if (hadExtra) {
          st.extra[side] -= 1;
          st.isExtraMovePhase[side] = true;
          io.to(roomId).emit('card:update', {
            extra: st.extra,
            noKingBy: st.noKingBy,
          });
        } else if (usedRangeBuff) {
          st.hitAndRunActiveSquare = move.to; io.to(roomId).emit('card:update', { hitAndRunActiveSquare: st.hitAndRunActiveSquare });
        }
      } else {
        // เปลี่ยนเทิร์นตามปกติ
        st.turn = opp(st.turn);
        st.cardPlayedBy = null;
        st.noKingBy = null;
        st.hitAndRunActiveSquare = null;
        st.isExtraMovePhase[side] = false;
        io.to(roomId).emit('card:update', {
          cardPlayedBy: st.cardPlayedBy,
          noKingBy: st.noKingBy,
          hitAndRunActiveSquare: null,
        });

        // โล่หมดอายุเมื่อเทิร์นวนกลับมาหาผู้ลงโล่
        if (st.shield.by && st.turn === st.shield.by) {
          st.shield = { by: null, square: null };
          io.to(roomId).emit('card:update', { shield: st.shield });
        }

        // safe zone หมดอายุเมื่อเทิร์นวนกลับมาหาผู้ลง safe zone
        if (st.safeZone.by && st.turn === st.safeZone.by) {
          st.safeZone = { by: null, square: null };
          io.to(roomId).emit('card:update', { safeZone: st.safeZone });
        }

        // (อดีตเคยมีเช็ค AOE ดีเลย์ตรงนี้ ตอนนี้ย้ายไประเบิดทันทีเลยลบทิ้งไปแล้ว)
      }

      // sync อัปเดตเวลาแบบ Precision Clock
      if (st.clock && !st.gameOver) {
        const now = Date.now();
        // หักลบเวลาที่เพิ่งใช้ไปของคนที่เดิน (แม้จะเป็น Extra move ก็ถูกหักเวลา)
        if (st.clock.running && st.clock.lastTickAt) {
          st.clock[st.clock.running] = Math.max(0, st.clock[st.clock.running] - (now - st.clock.lastTickAt));
        }

        // อัปเดตเทิร์นล่าสุด
        st.clock.running = st.turn;
        st.clock.lastTickAt = Date.now();

        io.to(roomId).emit('clock:update', {
          w: Math.ceil(st.clock.w / 1000),
          b: Math.ceil(st.clock.b / 1000),
          running: st.clock.running,
          lastTickAt: st.clock.lastTickAt // Client จะใช้ ref นี้ไป animate หลอกๆ
        });
      }

      // ถ้าเหยื่อเป็นคนเดินแล้ว → หมดสิทธิ์โต้กลับในตานั้น
      if (st.lastCapture && side === st.lastCapture.victim) st.lastCapture = null;

      //  เก็บ FEN ล่าสุดไว้ที่ห้อง
      st.fen = fenAfter;

      // ถ้าช่องต้นทางมีบัพ pawnRange → ย้ายบัพไปช่องปลาย
      if (st.pawnRange && st.pawnRange[move.from]) {
        st.pawnRange[move.to] = st.pawnRange[move.from];
        delete st.pawnRange[move.from];
        io.to(roomId).emit('card:update', { pawnRange: st.pawnRange });
      }

      // ถ้าช่องที่ถูกกินมีบัพ → ลบออก (ตัวนั้นตายแล้ว)
      if (capturedSquare && st.pawnRange && st.pawnRange[capturedSquare]) {
        delete st.pawnRange[capturedSquare];
        io.to(roomId).emit('card:update', { pawnRange: st.pawnRange });
      }

      //  broadcast กระดาน (ตาปัจจุบันที่คำนวณแล้ว)
      io.to(roomId).emit('game:move', { move, fenAfter, currentTurn: st.turn });

      // ===== ตรวจ AOE 1-turn delay =====
      if (st.aoe) {
        st.aoe.remaining -= 1;
        if (st.aoe.remaining <= 0) {
          resolveAoe(roomId, st, io);
        } else {
          io.to(roomId).emit('card:update', { aoe: st.aoe });
        }
      }

      const evalRes = evaluateGameState(fenAfter);
      if (evalRes.over) {
        st.gameOver = true;
        st.result = evalRes.payload;
        if (st.clock) st.clock.running = null; // หยุดนาฬิกาเมื่อเกมจบ

        io.to(roomId).emit('game:over', st.result);
      } else if (evalRes.payload.type === 'check') {
        io.to(roomId).emit('game:check', {
          sideInCheck: evalRes.payload.sideInCheck,
        });
      }

      cb?.({ ok: true });
    } catch (err) {
      console.error('[game:move] error:', err);
      cb?.({ ok: false, reason: 'server-error' });
    }
  });

  // ---------- RESIGN ----------
  socket.on('game:resign', ({ roomId }, cb) => {
    try {
      const st = rooms.get(roomId);
      if (!st) return cb?.({ ok: false, reason: 'no-room' });
      if (st.gameOver) return cb?.({ ok: false, reason: 'game-over' });

      const side = st.players.get(socket.id);
      if (!side) return cb?.({ ok: false, reason: 'not-in-room' });

      st.gameOver = true;
      const winner = opp(side);
      st.result = { type: 'resign', winner };
      if (st.clock) st.clock.running = null;

      io.to(roomId).emit('game:over', st.result);

      const sideName = side === 'w' ? 'White' : 'Black';
      io.to(roomId).emit('chat:message', { from: 'system', text: `[RESIGN] ${sideName} resigned` });

      cb?.({ ok: true });
    } catch (err) {
      console.error('[game:resign] error:', err);
      cb?.({ ok: false, reason: 'server-error' });
    }
  });

  // ---------- SUMMARY REPORT (Consolidated Analytics) ----------
  socket.on('game:summary_report', (data) => {
    try {
      const { 
        roomId, 
        userId, 
        timeLeft, 
        cardsPlayed, 
        connectionTimeMs, 
        surveyAnswers 
      } = data;
      
      const payload = {
        roomId,
        userId: userId && userId !== 'guest' ? userId : socket.id,
        socketId: socket.id,
        timeLeftSeconds: timeLeft,
        cardsPlayedCount: cardsPlayed?.length || 0,
        cardsPlayedList: cardsPlayed || [],
        connectionTimeMs,
        hasCompletedSurvey: surveyAnswers !== null,
        ...(surveyAnswers || {}),
        createdAt: new Date()
      };

      if (db) {
        db.collection('match_summaries').insertOne(payload)
          .then(() => console.log(`[MongoDB] Match summary saved for ${payload.userId} in room ${roomId}`))
          .catch((err) => console.error('[MongoDB] Insert error:', err));
      } else {
        console.warn('[MongoDB] Database not connected. Summary dropped.');
      }
    } catch (err) {
      console.error('[game:summary_report] error:', err);
    }
  });

  // ---------- READY TO RESTART ----------
  socket.on('game:restart:vote', ({ roomId }, cb) => {
    try {
      const st = rooms.get(roomId);
      if (!st) return cb?.({ ok: false, reason: 'no-room' });
      if (!st.gameOver) return cb?.({ ok: false, reason: 'not-over' });

      const side = st.players.get(socket.id);
      if (!side) return cb?.({ ok: false, reason: 'not-in-room' });

      st.restart.votes.add(side);

      io.to(roomId).emit('game:restart:state', {
        votes: Array.from(st.restart.votes),
        counting: st.restart.counting,
        durationSec: st.restart.durationSec,
        startedAt: st.restart.startedAt,
      });

      const bothReady = st.restart.votes.has('w') && st.restart.votes.has('b');
      if (bothReady && !st.restart.counting) {
        st.restart.counting = true;
        st.restart.startedAt = Date.now();

        io.to(roomId).emit('game:restart:state', {
          votes: Array.from(st.restart.votes),
          counting: true,
          durationSec: st.restart.durationSec,
          startedAt: st.restart.startedAt,
        });

        st.restart.timer = setTimeout(() => {
          const newState = resetRoomInPlace(st);
          rooms.set(roomId, newState);
          syncHandToSide(roomId, 'w');
          syncHandToSide(roomId, 'b');

          const startFen = new Chess().fen();
          newState.fen = startFen;

          // reset clock
          if (newState.clock) {
            newState.clock.w = INITIAL_CLOCK_SEC * 1000;
            newState.clock.b = INITIAL_CLOCK_SEC * 1000;
            newState.clock.running = null; // จะเริ่มใหม่เมื่อมีการเดินตาแรก
            newState.clock.lastTickAt = null;
          }

          io.to(roomId).emit('game:reset', {
            fen: startFen,
            currentTurn: newState.turn,
          });

          // ส่งค่าเวลาเริ่มต้นไปให้ client ทันที
          if (newState.clock) {
            io.to(roomId).emit('clock:update', {
              w: Math.ceil(newState.clock.w / 1000),
              b: Math.ceil(newState.clock.b / 1000),
              running: newState.clock.running,
            });
          }
          io.to(roomId).emit('card:counts', {
            deck: newState.cards.deck.length,
            graveyard: newState.cards.graveyard.length,
          });
        }, st.restart.durationSec * 1000);
      }

      cb?.({ ok: true });
    } catch (err) {
      console.error('[game:restart:vote] error:', err);
      cb?.({ ok: false, reason: 'server-error' });
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`listening on *:${PORT}`));
