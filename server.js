import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { Chess } from 'chess.js'
import { freshCardState, drawOneForSide, playCardOnServer } from './cards.server.js'
const cardName = (id) => {
  switch (id) {
    case 'BUFF_EXTRA_MOVE': return 'Forge (เดินเพิ่ม 1 ครั้ง)';
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

const app = express()
const server = createServer(app)
const io = new Server(server, { cors: { origin: '*' }, transports: ['websocket'] })

app.get('/health', (_, res) => res.status(200).send('OK'))

// ---------- helpers ----------
const opp = (s) => (s === 'w' ? 'b' : 'w')
const INITIAL_CLOCK_SEC = 420

// 3×3 รอบศูนย์กลาง
function getArea3x3(centerSquare) {
  if (!centerSquare || centerSquare.length !== 2) return []
  const file = centerSquare[0].charCodeAt(0) // 'a'..'h'
  const rank = parseInt(centerSquare[1], 10) // 1..8
  const squares = []

  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      const f = file + df
      const r = rank + dr
      if (f < 'a'.charCodeAt(0) || f > 'h'.charCodeAt(0)) continue
      if (r < 1 || r > 8) continue
      squares.push(String.fromCharCode(f) + r)
    }
  }
  return squares
}

// ---------- room state ----------
const rooms = new Map()

function freshRoomState() {
  return {
    players: new Map(), // Map<socketId, 'w'|'b'>
    turn: 'w',
    extra: { w: 0, b: 0 },
    shield: { by: null, square: null },
    counter: { by: null, armed: false },
    pendingCounter: null,
    lastCapture: null,
    cardPlayedBy: null,
    captureCount: { w: 0, b: 0 },

    // บัพ/โซน
    pawnRange: {}, // { 'e4': true }
    safeZone: { by: null, square: null }, // center ของโซน 3x3
    aoe: null, // { by, center, remaining }

    // 🎴 ระบบการ์ดต่อห้อง
    cards: freshCardState(),

    // เก็บกระดานปัจจุบันไว้ที่เซิร์ฟเวอร์
    fen: new Chess().fen(),

    // ⏱ สถานะนาฬิกา (server authoritative)
    clock: {
      baseSec: INITIAL_CLOCK_SEC,
      w: INITIAL_CLOCK_SEC,
      b: INITIAL_CLOCK_SEC,
      running: null, // 'w' | 'b' | null (null = ยังไม่เริ่ม/หยุด)
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
  }
}

function ensureState(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, freshRoomState())
  return rooms.get(roomId)
}

function resetRoomInPlace(st) {
  const keepPlayers = st.players
  if (st.restart.timer) clearTimeout(st.restart.timer)
  const next = freshRoomState()
  next.players = keepPlayers
  return next
}

// sync มือให้ฝั่งเดียว (ไม่ให้ศัตรูเห็น)
function syncHandToSide(roomId, side) {
  const st = rooms.get(roomId)
  if (!st) return
  const hand = st.cards?.hands?.[side] || []

  for (const [sockId, s] of st.players.entries()) {
    if (s === side) {
      io.to(sockId).emit('card:hand', hand)
    }
  }
}

// ประเมินจาก FEN หลังเดิน
function evaluateGameState(fen) {
  const ch = new Chess(fen)
  const sideToMove = ch.turn() // 'w' | 'b'

  if (ch.isCheckmate()) {
    return {
      over: true,
      payload: { type: 'checkmate', winner: sideToMove === 'w' ? 'b' : 'w' },
    }
  }
  if (ch.isStalemate()) {
    return { over: true, payload: { type: 'stalemate' } }
  }
  if (ch.isInsufficientMaterial()) {
    return { over: true, payload: { type: 'insufficient' } }
  }
  if (ch.isCheck()) {
    return { over: false, payload: { type: 'check', sideInCheck: sideToMove } }
  }
  return { over: false, payload: { type: 'safe' } }
}

// ระเบิด AOE: เลือกสุ่ม 1 ตัวในโซน 3×3 (ไม่ระเบิดคิง)
function resolveAoe(roomId, st) {
  if (!st.aoe || !st.aoe.center) {
    st.aoe = null
    io.to(roomId).emit('card:update', { aoe: null })
    return
  }

  const ch = new Chess(st.fen)
  const area = getArea3x3(st.aoe.center)
  const targets = []

  for (const sq of area) {
    const p = ch.get(sq)
    if (p && p.type !== 'k') {
      targets.push({ sq, p })
    }
  }

  if (!targets.length) {
    // ไม่มีตัวให้ระเบิด
    st.aoe = null
    io.to(roomId).emit('card:update', { aoe: null })
    return
  }

  const idx = Math.floor(Math.random() * targets.length)
  const victimSq = targets[idx].sq

  ch.remove(victimSq)
  const fenNew = ch.fen()
  st.fen = fenNew
  st.aoe = null

  io.to(roomId).emit('game:move', {
    move: {
      from: null,
      to: null,
      san: 'AOE',
      special: 'AOE_BLAST',
      target: victimSq,
    },
    fenAfter: fenNew,
    currentTurn: st.turn,
  })
  io.to(roomId).emit('card:update', { aoe: null })
}

// ---------- clock loop (นับเวลาใน server ทุกห้อง) ----------
setInterval(() => {
  for (const [roomId, st] of rooms.entries()) {
    if (st.gameOver) continue
    const clk = st.clock
    if (!clk || !clk.running) continue // ยังไม่เริ่ม หรือพักอยู่

    const side = clk.running // 'w' หรือ 'b'
    if (clk[side] <= 0) continue // เผื่อมีหลุดยังไง

    // หักเวลา 1 วินาที
    clk[side] = Math.max(0, clk[side] - 1)

    if (clk[side] <= 0) {
      // ⏱ หมดเวลา -> แพ้
      st.gameOver = true
      const winner = opp(side)
      st.result = { type: 'timeout', winner }
      clk.running = null

      io.to(roomId).emit('clock:update', {
        w: clk.w,
        b: clk.b,
        running: clk.running,
      })
      io.to(roomId).emit('game:over', st.result)
    } else {
      // ยังไม่หมด ยิงอัปเดตเวลาให้ client
      io.to(roomId).emit('clock:update', {
        w: clk.w,
        b: clk.b,
        running: clk.running,
      })
    }
  }
}, 1000) // 1 วิ/ติ๊ก

// ---------- socket ----------
io.on('connection', (socket) => {
  // สร้างห้อง
  socket.on('createRoom', (ack) => {
    const roomId = Math.random().toString(36).slice(2, 8)
    rooms.set(roomId, freshRoomState())
    ack?.({ ok: true, roomId })
  })

  // เข้าห้อง
  socket.on('joinRoom', (roomId, ack) => {
    if (!roomId) return ack?.({ ok: false, reason: 'no-room-id' })
    const st = ensureState(roomId)

    //  สุ่มสี
    const used = new Set(st.players.values())
    let color = null
    if (!used.has('w') && !used.has('b')) {
      color = Math.random() < 0.5 ? 'w' : 'b'
    } else if (!used.has('w')) {
      color = 'w'
    } else if (!used.has('b')) {
      color = 'b'
    } else {
      return ack?.({ ok: false, reason: 'room-full' })
    }

    socket.join(roomId)
    st.players.set(socket.id, color)
    const side = color // 'w' | 'b'

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
      aoe: st.aoe,
      cardPlayedBy: st.cardPlayedBy,
      clock: st.clock
        ? {
            w: st.clock.w,
            b: st.clock.b,
            running: st.clock.running,
          }
        : null,
      hand: st.cards.hands[side] || [], // 🎴 มือของเรา
    })

    // 🎴 ส่งไพ่ในมือให้ player นี้อีกรอบผ่าน event
    io.to(socket.id).emit('card:hand', st.cards.hands[side] || [])

    socket.once('disconnect', () => {
      const s = rooms.get(roomId)
      if (!s) return
      s.players.delete(socket.id)
      socket.to(roomId).emit('opponent-left')
      if (s.players.size === 0) rooms.delete(roomId)
    })
  })

  // แชท
  socket.on('chat:message', ({ roomId, text, from }) => {
    io.to(roomId).emit('chat:message', { text, from })
  })

  // ---------- cards ----------
    socket.on('card:play', ({ roomId, color, card, uid, payload }, cb) => {
    const st = rooms.get(roomId)
    if (!st) return cb?.({ ok: false, reason: 'no-room' })
    if (st.gameOver) return cb?.({ ok: false, reason: 'game-over' })

    const side = color === 'white' ? 'w' : 'b'
    if (st.turn !== side) return cb?.({ ok: false, reason: 'not-your-turn' })
    if (st.cardPlayedBy === side)
      return cb?.({ ok: false, reason: 'card-already-used-this-turn' })

    const result = playCardOnServer({
      st,
      roomId,
      side,
      card,
      uid,
      payload,
      io,
      syncHandToSide,
    })

    // ✅ ถ้าใช้การ์ดสำเร็จ ให้ log ลงแชท
    if (result.ok) {
      const sideName = side === 'w' ? 'White' : 'Black'
      const text = `[CARD] ${sideName} ใช้การ์ด ${cardName(card)}`
      io.to(roomId).emit('chat:message', { text, from: 'system' })
    }

    cb?.(result)
  })


  // ---------- moves ----------
    socket.on(
    'game:move',
    ({ roomId, move, fenBefore, fenAfter, by, capturedSquare }, cb) => {
      const st = rooms.get(roomId)
      if (!st) return cb?.({ ok:false, reason:'no-room' })
      if (st.gameOver) return cb?.({ ok:false, reason:'game-over' })

      const side = st.players.get(socket.id)
      if (!side) return cb?.({ ok:false, reason:'not-in-room' })

      // ตรวจสิทธิ์ตาเดิน
      if (side !== st.turn || side !== by) {
        return cb?.({ ok:false, reason:'not-your-turn' })
      }

      // ✅ เช็คว่าตานี้เป็น extra move จากการ์ด BUFF_EXTRA_MOVE หรือเปล่า
      const hasGlobalExtra = st.extra?.[side] > 0
      const fromRangeBuff =
        st.pawnRange && st.pawnRange[move?.from] ? true : false  // ไว้ใช้ข้อ 2 ต่อ

      // เริ่มจับเวลาครั้งแรก
      if (st.clock && !st.clock.running) {
        st.clock.running = st.turn
      }

      // ❌ เดิม: ห้ามกินคิงเฉย ๆ
      // if (st.noKingBy === side && move.capturedPieceType === 'k') { ... }

      // ✅ ใหม่: ถ้าเป็น extra move (hasGlobalExtra) → ห้ามกิน "อะไรทั้งนั้น"
      if (hasGlobalExtra && move.capturedPieceType) {
        socket.emit('game:moveRejected', {
          reason: 'Extra move สามารถเดินได้อย่างเดียว ห้ามกินหมาก',
        })
        return cb?.({ ok:false, reason:'extra-move-no-capture' })
      }
if (fromRangeBuff && move.capturedPieceType) {
        socket.emit('game:moveRejected', {
          reason: 'ตัวที่มีบัพเดิน 2 รอบ ห้ามกินหมาก',
        })
        return cb?.({ ok:false, reason:'range-buff-no-capture' })
      }

      // กันกินช่องที่เป็น safe zone (3x3 รอบ center)
      if (st.safeZone?.square && capturedSquare) {
        const area = getArea3x3(st.safeZone.square)
        if (area.includes(capturedSquare)) {
          socket.emit('game:moveRejected', { reason: 'Safe zone' })
          return cb?.({ ok: false, reason: 'safe-zone' })
        }
      }

      // กันกินชิ้นที่ติดโล่
      if (
        st.shield.square &&
        capturedSquare &&
        capturedSquare === st.shield.square
      ) {
        socket.emit('game:moveRejected', { reason: 'Shielded' })
        return cb?.({ ok: false, reason: 'shielded' })
      }

      // ย้ายโล่ตาม
      if (st.shield.by === side && st.shield.square === move.from) {
        st.shield.square = move.to
        io.to(roomId).emit('card:update', { shield: st.shield })
      }

      // บันทึกการ “ตายล่าสุด” + นับการกิน + แจกการ์ดทุก 2 คิล
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
        }

        st.captureCount[side] = (st.captureCount?.[side] ?? 0) + 1

        // ✅ log ลงแชท
        const sideName = side === 'w' ? 'White' : 'Black'
        const atk = move.attackerPieceType || '?'
        const vic = move.capturedPieceType || '?'
        const text =
          `${sideName} ${atk}x${vic}${capturedSquare}`
        io.to(roomId).emit('chat:message', { text, from: 'system' })

        // ทุก ๆ 2 คิล → จั่วการ์ด 1 ใบจากเด็ค
        if (st.captureCount[side] % 2 === 0) {
          drawOneForSide(st.cards, side)
          syncHandToSide(roomId, side)
        }
      }


      // --- จัดการเทิร์น / เสริมพลัง / อายุบัพ / ดีเลย์ AOE ---
            // --- จัดการเทิร์น / เสริมพลัง / อายุบัพ / ดีเลย์ AOE ---
      const hadExtra = st.extra[side] > 0
      const usedRangeBuff = !!(st.pawnRange && st.pawnRange[move.from])

      if (hadExtra || usedRangeBuff) {
        // ✅ ตานี้ยังเป็นฝั่งเดิม (ได้เดินต่ออีก 1 ครั้ง)
        if (hadExtra) {
          st.extra[side] -= 1
          io.to(roomId).emit('card:update', {
            extra: st.extra,
            noKingBy: st.noKingBy,
          })
        }
        // ถ้าใช้จาก range buff ไม่ต้องลดอะไร บัพติดตัวไปตลอด
      } else {
        // เปลี่ยนเทิร์นตามปกติ
        st.turn = opp(st.turn)
        st.cardPlayedBy = null
        st.noKingBy = null
        io.to(roomId).emit('card:update', {
          cardPlayedBy: st.cardPlayedBy,
          noKingBy: st.noKingBy,
        })

        // โล่หมดอายุเมื่อเทิร์นวนกลับมาหาผู้ลงโล่
        if (st.shield.by && st.turn === st.shield.by) {
          st.shield = { by: null, square: null }
          io.to(roomId).emit('card:update', { shield: st.shield })
        }

        // safe zone หมดอายุเมื่อเทิร์นวนกลับมาหาผู้ลง safe zone
        if (st.safeZone.by && st.turn === st.safeZone.by) {
          st.safeZone = { by: null, square: null }
          io.to(roomId).emit('card:update', { safeZone: st.safeZone })
        }

        // AOE ดีเลย์ 2 เทิร์นของฝั่งที่ลงการ์ด
        if (st.aoe && side === st.aoe.by) {
  st.aoe.remaining -= 1;

  if (st.aoe.remaining <= 0) {
    resolveAoe(roomId, st);   // ทำลายตัว 1 ตัวใน 3×3
  } else {
    io.to(roomId).emit('card:update', { aoe: st.aoe });
  }
}
      }


      // sync ให้ clock วิ่งตามเทิร์นปัจจุบัน
      if (st.clock && !st.gameOver) {
        st.clock.running = st.turn
      }

      // ถ้าเหยื่อเป็นคนเดินแล้ว → หมดสิทธิ์โต้กลับในตานั้น
      if (st.lastCapture && side === st.lastCapture.victim) st.lastCapture = null

      //  เก็บ FEN ล่าสุดไว้ที่ห้อง
      st.fen = fenAfter
      // ถ้าช่องต้นทางมีบัพ pawnRange → ย้ายบัพไปช่องปลาย
      if (st.pawnRange && st.pawnRange[move.from]) {
        st.pawnRange[move.to] = st.pawnRange[move.from]
        delete st.pawnRange[move.from]
        io.to(roomId).emit('card:update', { pawnRange: st.pawnRange })
      }

      // ถ้าช่องที่ถูกกินมีบัพ → ลบออก (ตัวนั้นตายแล้ว)
      if (capturedSquare && st.pawnRange && st.pawnRange[capturedSquare]) {
        delete st.pawnRange[capturedSquare]
        io.to(roomId).emit('card:update', { pawnRange: st.pawnRange })
      }

      //  broadcast กระดาน (ตาปัจจุบันที่คำนวณแล้ว)
      io.to(roomId).emit('game:move', { move, fenAfter, currentTurn: st.turn })

      const evalRes = evaluateGameState(fenAfter)
      if (evalRes.over) {
        st.gameOver = true
        st.result = evalRes.payload
        if (st.clock) st.clock.running = null // หยุดนาฬิกาเมื่อเกมจบ
        io.to(roomId).emit('game:over', st.result)
      } else if (evalRes.payload.type === 'check') {
        io.to(roomId).emit('game:check', {
          sideInCheck: evalRes.payload.sideInCheck,
        })
      }

      cb?.({ ok: true })
    }
  )

  // ---------- READY TO RESTART ----------
  socket.on('game:restart:vote', ({ roomId }, cb) => {
    const st = rooms.get(roomId)
    if (!st) return cb?.({ ok: false, reason: 'no-room' })
    if (!st.gameOver) return cb?.({ ok: false, reason: 'not-over' })

    const side = st.players.get(socket.id)
    if (!side) return cb?.({ ok: false, reason: 'not-in-room' })

    st.restart.votes.add(side)

    io.to(roomId).emit('game:restart:state', {
      votes: Array.from(st.restart.votes),
      counting: st.restart.counting,
      durationSec: st.restart.durationSec,
      startedAt: st.restart.startedAt,
    })

    const bothReady = st.restart.votes.has('w') && st.restart.votes.has('b')
    if (bothReady && !st.restart.counting) {
      st.restart.counting = true
      st.restart.startedAt = Date.now()

      io.to(roomId).emit('game:restart:state', {
        votes: Array.from(st.restart.votes),
        counting: true,
        durationSec: st.restart.durationSec,
        startedAt: st.restart.startedAt,
      })

      st.restart.timer = setTimeout(() => {
        const newState = resetRoomInPlace(st)
        rooms.set(roomId, newState)

        const startFen = new Chess().fen()
        newState.fen = startFen

        // reset clock
        if (newState.clock) {
          newState.clock.w = INITIAL_CLOCK_SEC
          newState.clock.b = INITIAL_CLOCK_SEC
          newState.clock.running = null // จะเริ่มใหม่เมื่อมีการเดินตาแรก
        }

        io.to(roomId).emit('game:reset', {
          fen: startFen,
          currentTurn: newState.turn,
        })

        // ส่งค่าเวลาเริ่มต้นไปให้ client ทันที
        if (newState.clock) {
          io.to(roomId).emit('clock:update', {
            w: newState.clock.w,
            b: newState.clock.b,
            running: newState.clock.running,
          })
        }
      }, st.restart.durationSec * 1000)
    }

    cb?.({ ok: true })
  })
})

server.listen(3001, () => console.log('listening on *:3001'))
