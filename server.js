import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { Chess } from 'chess.js'
import { freshCardState, drawOneForSide, removeFromHand } from './cards.server.js';



const app = express()
const server = createServer(app)
const io = new Server(server, { cors: { origin: '*' }, transports: ['websocket'] })

app.get('/health', (_, res) => res.status(200).send('OK'))

// ---------- helpers ----------
const opp = (s) => (s === 'w' ? 'b' : 'w')
const INITIAL_CLOCK_SEC = 300

// ---------- room state ----------
const rooms = new Map()

function freshRoomState() {
  return {
    players: new Map(),           // Map<socketId, 'w'|'b'>
    turn: 'w',
    extra: { w: 0, b: 0 },
    shield: { by: null, square: null },
    counter: { by: null, armed: false },  
    pendingCounter: null,
    lastCapture: null,
    cardPlayedBy: null,
    captureCount: { w: 0, b: 0 },

    // 🎴 ระบบการ์ดต่อห้อง
    cards: freshCardState(),

    // เก็บกระดานปัจจุบันไว้ที่เซิร์ฟเวอร์
    fen: new Chess().fen(),

    // ⏱ สถานะนาฬิกา (server authoritative)
    clock: {
      baseSec: INITIAL_CLOCK_SEC,
      w: INITIAL_CLOCK_SEC,
      b: INITIAL_CLOCK_SEC,
      running: null,   // 'w' | 'b' | null (null = ยังไม่เริ่ม/หยุด)
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
    return { over: true, payload: { type: 'checkmate', winner: sideToMove === 'w' ? 'b' : 'w' } }
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

// ---------- clock loop (นับเวลาใน server ทุกห้อง) ----------
setInterval(() => {
  for (const [roomId, st] of rooms.entries()) {
    if (st.gameOver) continue
    const clk = st.clock
    if (!clk || !clk.running) continue  // ยังไม่เริ่ม หรือพักอยู่

    const side = clk.running            // 'w' หรือ 'b'
    if (clk[side] <= 0) continue        // เผื่อมีหลุดยังไง

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
    if (!roomId) return ack?.({ ok:false, reason:'no-room-id' })
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
      return ack?.({ ok:false, reason:'room-full' })
    }

    socket.join(roomId)
    st.players.set(socket.id, color)
    const side = color  // 'w' | 'b'

    // ส่งสถานะทั้งหมดกลับไปเพื่อซิงก์ client
        // ส่งสถานะทั้งหมดกลับไปเพื่อซิงก์ client
    ack?.({
      ok: true,
      color: color === 'w' ? 'white' : 'black',
      currentTurn: st.turn,
      fen: st.fen,
      extra: st.extra,
      shield: st.shield,
      cardPlayedBy: st.cardPlayedBy,
      clock: st.clock ? {
        w: st.clock.w,
        b: st.clock.b,
        running: st.clock.running,
      } : null,
      hand: st.cards.hands[side] || [],   // 🎴 มือของเรา
    })

    // 🎴 ส่งไพ่ในมือให้ player นี้อีกรอบผ่าน event
    io.to(socket.id).emit('card:hand', st.cards.hands[side] || [])


    socket.once('disconnect', () => {
      const s = rooms.get(roomId); if (!s) return
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
    if (!st) return cb?.({ ok:false, reason:'no-room' })
    if (st.gameOver) return cb?.({ ok:false, reason:'game-over' })

    const side = color === 'white' ? 'w' : 'b'
    if (st.turn !== side) return cb?.({ ok:false, reason:'not-your-turn' })
    if (st.cardPlayedBy === side) return cb?.({ ok:false, reason:'card-already-used-this-turn' })

    const hand = st.cards?.hands?.[side] || []
    if (!hand.some(c => c.uid === uid && c.id === card)) {
      return cb?.({ ok:false, reason:'card-not-in-hand' })
    }

    switch (card) {
      case 'BUFF_EXTRA_MOVE': {
        st.extra[side] += 1
        st.cardPlayedBy = side
        st.noKingBy = side           //ห้ามกินคิงในเทิร์นนี้

        removeFromHand(st.cards, side, uid)
        syncHandToSide(roomId, side)

        io.to(roomId).emit('card:update', {
          extra: st.extra,
          cardPlayedBy: st.cardPlayedBy,
          noKingBy: st.noKingBy,
        })
        return cb?.({ ok:true })
      }

      case 'DEF_SHIELD': {
        st.shield = { by: side, square: payload?.square || null }
        st.cardPlayedBy = side

        removeFromHand(st.cards, side, uid)
        syncHandToSide(roomId, side)

        io.to(roomId).emit('card:update', { shield: st.shield, cardPlayedBy: st.cardPlayedBy })
        return cb?.({ ok:true })
      }

      case 'COUNTER_SACRIFICE': {
        const lc = st.lastCapture
        if (!lc || lc.victim !== side || st.turn !== side) {
          return cb?.({ ok:false, reason:'no-recent-capture' })
        }
        const sq = payload?.sacrificeSquare
        if (!sq) return cb?.({ ok:false, reason:'need-sacrifice-square' })

        const ch = new Chess(lc.fenAfter)
        const atkColor = lc.victim === 'w' ? 'b' : 'w'
        const atkType  = lc.attackerPieceType || 'p'
        ch.remove(lc.attackerTo)
        ch.put({ type: atkType, color: atkColor }, lc.attackerFrom)

        const reviveType = lc.capturedPieceType || 'p'
        ch.put({ type: reviveType, color: lc.victim }, lc.capturedSquare)

        ch.remove(sq)

        const fenAdjusted = ch.fen()

        // อัปเดตห้อง + สื่อสารไป client
        st.fen = fenAdjusted           //  เก็บ FEN ล่าสุด
        st.lastCapture = null
        st.cardPlayedBy = side
        st.noKingBy = side            

        removeFromHand(st.cards, side, uid)
        syncHandToSide(roomId, side)

        io.to(roomId).emit('counter:resolved', {
          fen: fenAdjusted,
          currentTurn: st.turn,
        })
        io.to(roomId).emit('card:update', {
          cardPlayedBy: st.cardPlayedBy,
          noKingBy: st.noKingBy,
        })

        return cb?.({ ok:true })
      }

      default:
        return cb?.({ ok:false, reason:'unknown-card' })
    }
  })

  // ---------- moves ----------
  socket.on('game:move', ({ roomId, move, fenBefore, fenAfter, by, capturedSquare }, cb) => {
    const st = rooms.get(roomId)
    if (!st) return cb?.({ ok:false, reason:'no-room' })
    if (st.gameOver) return cb?.({ ok:false, reason:'game-over' })

    const side = st.players.get(socket.id)
    if (!side) return cb?.({ ok:false, reason:'not-in-room' })

    // ตรวจสิทธิ์ตาเดิน
    if (side !== st.turn || side !== by) {
      return cb?.({ ok:false, reason:'not-your-turn' })
    }

    // เริ่มจับเวลาครั้งแรก
    if (st.clock && !st.clock.running) {
      st.clock.running = st.turn  // ปกติคือ 'w' ในตาแรก
    }

    // ห้ามกินคิง ขณะติดสถานะพิเศษ
    if (st.noKingBy === side && move.capturedPieceType === 'k') {
      socket.emit('game:moveRejected', { reason: 'Cannot capture king in special phase' })
      return cb?.({ ok:false, reason:'special-cant-capture-king' })
    }

    // กันกินชิ้นที่ติดโล่
    if (st.shield.square && capturedSquare && capturedSquare === st.shield.square) {
      socket.emit('game:moveRejected', { reason: 'Shielded' })
      return cb?.({ ok:false, reason:'shielded' })
    }

    // ย้ายโล่ตาม
    if (st.shield.by === side && st.shield.square === move.from) {
      st.shield.square = move.to
      io.to(roomId).emit('card:update', { shield: st.shield })
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
      }

      st.captureCount[side] = (st.captureCount?.[side] ?? 0) + 1

      // ทุก ๆ 2 คิล → จั่วการ์ด 1 ใบจากเด็ค
      if (st.captureCount[side] % 2 === 0) {
        drawOneForSide(st.cards, side)
        syncHandToSide(roomId, side)
      }
    }

    // --- จัดการเทิร์น / เสริมพลัง / อายุโล่ / เคลียร์ noKingBy ---
    const hadExtra = st.extra[side] > 0
    if (hadExtra) {
      st.extra[side] -= 1
      io.to(roomId).emit('card:update', { extra: st.extra, noKingBy: st.noKingBy })
    } else {
      st.turn = opp(st.turn)
      st.cardPlayedBy = null
      st.noKingBy = null
      io.to(roomId).emit('card:update', { cardPlayedBy: st.cardPlayedBy, noKingBy: st.noKingBy })

      // โล่หมดอายุเมื่อเทิร์นวนกลับมาหาผู้ลงโล่
      if (st.shield.by && st.turn === st.shield.by) {
        st.shield = { by: null, square: null }
        io.to(roomId).emit('card:update', { shield: st.shield })
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

    //  broadcast กระดาน (ตาปัจจุบันที่คำนวณแล้ว)
    io.to(roomId).emit('game:move', { move, fenAfter, currentTurn: st.turn })

    const evalRes = evaluateGameState(fenAfter)
    if (evalRes.over) {
      st.gameOver = true
      st.result = evalRes.payload
      if (st.clock) st.clock.running = null   // หยุดนาฬิกาเมื่อเกมจบ
      io.to(roomId).emit('game:over', st.result)
    } else if (evalRes.payload.type === 'check') {
      io.to(roomId).emit('game:check', { sideInCheck: evalRes.payload.sideInCheck })
    }

    cb?.({ ok:true })
  })

  // ---------- READY TO RESTART ----------
  socket.on('game:restart:vote', ({ roomId }, cb) => {
    const st = rooms.get(roomId)
    if (!st) return cb?.({ ok:false, reason:'no-room' })
    if (!st.gameOver) return cb?.({ ok:false, reason:'not-over' })

    const side = st.players.get(socket.id)
    if (!side) return cb?.({ ok:false, reason:'not-in-room' })

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
          newState.clock.running = null      // จะเริ่มใหม่เมื่อมีการเดินตาแรก
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

    cb?.({ ok:true })
  })
})

server.listen(3001, () => console.log('listening on *:3001'))
