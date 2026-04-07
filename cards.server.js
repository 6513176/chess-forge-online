// cards.server.js (ESM version)
import { Chess } from 'chess.js'

/**
 * รายการการ์ดทั้งหมด (26 cards)
 *  - ถ้าต้องการเพิ่ม/ลด ให้แก้ที่นี่
 * 'BUFF_EXTRA_MOVE'
 * 'FORGE'
 * 'SUMMON_PAWN'
 * 'SWAP_ALLY'
 * 'SHIELD'
 * 'SAFE_ZONE'
 * 'SACRIFICE'
 * 'RNG_BLAST'
 * 'CLEANSE'
 */
const ALL_CARD_IDS = [
  // Attack - 40% (10 cards)
  'FORGE', 'FORGE', 'FORGE', 'FORGE', 'FORGE', 'FORGE', // 6
  'RNG_BLAST', 'RNG_BLAST', 'RNG_BLAST', 'RNG_BLAST', // 4

  // Defense - 30% (8 cards)
  'SHIELD', 'SHIELD', 'SHIELD', // 3
  'SAFE_ZONE', 'SAFE_ZONE', 'SAFE_ZONE', // 3
  'CLEANSE', 'CLEANSE', // 2

  // Special - 30% (8 cards)
  'SUMMON_PAWN', 'SUMMON_PAWN', 'SUMMON_PAWN', // 3
  'SWAP_ALLY', 'SWAP_ALLY', 'SWAP_ALLY', // 3
  'SACRIFICE', 'SACRIFICE', // 2
]

const mkUid = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36)

// random deck 26 cardsจาก ALL_CARD_IDS
function createNewDeck() {
  const arr = [...ALL_CARD_IDS]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr // CardId[]
}

// จั่ว n cardsจาก deck (mutate deck)
function drawCards(deck, n) {
  const drawn = []
  for (let i = 0; i < n; i++) {
    if (!deck.length) break
    const id = deck.shift() // เอาจากหัวกอง
    drawn.push({ id, uid: mkUid() }) // CardInstance แบบ {id, uid}
  }
  return drawn
}

// state เริ่มต้นของSystemการ์ดในห้องนึง
export function freshCardState() {
  const deck = createNewDeck() // 26 cards
  const hands = { w: [], b: [] }

  // แจกคนละ 3 → deck Remaining 20
  hands.w = drawCards(deck, 3)
  hands.b = drawCards(deck, 3)

  return {
    deck, // CardId[]
    hands, // { w: CardInstance[], b: CardInstance[] }
    graveyard: [], // cardsที่ใช้แล้ว
    playedThisTurn: { w: false, b: false },
  }
}

// จั่ว 1 cardsให้ฝั่งที่ระบุ
export function drawOneForSide(cardState, side) {
  const got = drawCards(cardState.deck, 1)
  if (got.length) {
    cardState.hands[side].push(got[0])
    return got[0]
  }
  return null
}

// เอาการ์ดออกจากมือด้วย uid แล้วโยนเข้ากองทิ้ง
export function removeFromHand(cardState, side, uid) {
  const hand = cardState.hands[side]
  const idx = hand.findIndex((c) => c.uid === uid)
  if (idx >= 0) {
    const [removed] = hand.splice(idx, 1)
    cardState.graveyard.push(removed)
    return removed
  }
  return null
}

/**
 * ฟังก์ชันกลางใช้Playการ์ดทุกcardsใน server
 * @param {Object} params
 *  - st: room state
 *  - roomId: string
 *  - side: 'w' | 'b'
 *  - card: CardId
 *  - uid: string
 *  - payload: any
 *  - io: socket.io server instance
 *  - syncHandToSide: function(roomId, side)
 */
export function playCardOnServer({
  st,
  roomId,
  side,
  card,
  uid,
  payload,
  io,
  syncHandToSide,
}) {
  const hand = st.cards?.hands?.[side] || []
  if (!hand.some((c) => c.uid === uid && c.id === card)) {
    return { ok: false, reason: 'card-not-in-hand' }
  }

  switch (card) {



    case 'FORGE': {
      const sq = payload?.square
      if (!sq) return { ok: false, reason: 'need-target-square' }

      const ch = new Chess(st.fen)
      const p = ch.get(sq)
      if (!p || p.color !== side) {
        return { ok: false, reason: 'not-your-piece' }
      }


      if (!st.pawnRange) st.pawnRange = {}
      st.pawnRange[sq] = { by: side }

      st.cardPlayedBy = side

      removeFromHand(st.cards, side, uid)
      syncHandToSide(roomId, side)

      io.to(roomId).emit('card:update', {
        pawnRange: st.pawnRange,
        cardPlayedBy: st.cardPlayedBy,
      })
      return { ok: true }
    }

    case 'SUMMON_PAWN': {
      const sq = payload?.square
      if (!sq) return { ok: false, reason: 'need-square' }

      const ch = new Chess(st.fen)
      if (ch.get(sq)) return { ok: false, reason: 'not-empty' }

      const rank = parseInt(sq[1])
      if (side === 'w' && rank !== 2)
        return { ok: false, reason: 'white-in-rank-2' }
      if (side === 'b' && rank !== 7)
        return { ok: false, reason: 'black-in-rank-7' }

      ch.put({ type: 'p', color: side }, sq)
      const fenNew = ch.fen()
      st.fen = fenNew

      st.cardPlayedBy = side
      removeFromHand(st.cards, side, uid)
      syncHandToSide(roomId, side)

      io.to(roomId).emit('game:move', {
        move: {},
        fenAfter: fenNew,
        currentTurn: st.turn,
      })
      io.to(roomId).emit('card:update', { cardPlayedBy: st.cardPlayedBy })

      return { ok: true }
    }

    case 'SWAP_ALLY': {
      const a = payload?.a
      const b = payload?.b
      if (!a || !b) return { ok: false, reason: 'need-two-squares' }

      const ch = new Chess(st.fen)
      const pa = ch.get(a)
      const pb = ch.get(b)

      if (!pa || pa.color !== side) return { ok: false, reason: 'bad-a' }
      if (!pb || pb.color !== side) return { ok: false, reason: 'bad-b' }
      if (a === b) return { ok: false, reason: 'same-square' }

      // ❌ ป้องกันไม่ให้ pawn ไปอยู่ rank 1 หรือ 8
      const rankA = parseInt(a[1], 10)
      const rankB = parseInt(b[1], 10)
      if (
        (pa.type === 'p' && (rankB === 1 || rankB === 8)) ||
        (pb.type === 'p' && (rankA === 1 || rankA === 8))
      ) {
        return { ok: false, reason: 'pawn-cannot-swap-to-edge-rank' }
      }

      // safer put: เอาข้อมูล {type, color} สลับลงใน board() ของ chess.js โดยตรง ป้องกันบั๊กเวลามีพระราชาเกี่ยวข้อง
      const board = ch.board()
      const fileA = a.charCodeAt(0) - 97
      const idxRankA = 8 - parseInt(a[1], 10)
      const fileB = b.charCodeAt(0) - 97
      const idxRankB = 8 - parseInt(b[1], 10)

      const temp = board[idxRankA][fileA]
      board[idxRankA][fileA] = board[idxRankB][fileB]
      board[idxRankB][fileB] = temp

      let placement = ''
      for (let r = 0; r < 8; r++) {
        let empty = 0
        for (let f = 0; f < 8; f++) {
          const p = board[r][f]
          if (p) {
            if (empty > 0) { placement += empty; empty = 0 }
            placement += p.color === 'w' ? p.type.toUpperCase() : p.type.toLowerCase()
          } else {
            empty++
          }
        }
        if (empty > 0) placement += empty
        if (r < 7) placement += '/'
      }

      const parts = ch.fen().split(' ')
      parts[0] = placement
      parts[1] = side === 'w' ? 'b' : 'w'
      parts[3] = '-' // Strip en-passant square
      const fenNew = parts.join(' ')
      st.fen = fenNew

      removeFromHand(st.cards, side, uid)
      syncHandToSide(roomId, side)

      io.to(roomId).emit('game:move', {
        move: {},
        fenAfter: fenNew,
        currentTurn: parts[1],
      })

      return { ok: true, endsTurn: true }
    }

    // -------- ป้องกัน / Safe zone 3x3 --------
    case 'SHIELD': {
      st.shield = { by: side, square: payload?.square || null }
      st.cardPlayedBy = side

      removeFromHand(st.cards, side, uid)
      syncHandToSide(roomId, side)

      io.to(roomId).emit('card:update', {
        shield: st.shield,
        cardPlayedBy: st.cardPlayedBy,
      })
      return { ok: true }
    }

    case 'SAFE_ZONE': {
      const sq = payload?.square
      if (!sq) return { ok: false, reason: 'need-square' }

      // ตีความเป็นศูนย์กลางของโซน 3x3
      st.safeZone = { by: side, square: sq }
      st.cardPlayedBy = side

      removeFromHand(st.cards, side, uid)
      syncHandToSide(roomId, side)

      io.to(roomId).emit('card:update', {
        safeZone: st.safeZone,
        cardPlayedBy: st.cardPlayedBy,
      })
      return { ok: true }
    }

    // -------- AOE 3×3 ดีเลย์ 1 เทิร์น (ระเบิดหลังจบตาอีกฝั่ง) --------
    case 'RNG_BLAST': {
      const sq = payload?.square
      if (!sq) return { ok: false, reason: 'need-square' }

      st.aoe = {
        by: side,
        center: sq,
        remaining: 2,
      }
      st.cardPlayedBy = side

      removeFromHand(st.cards, side, uid)
      syncHandToSide(roomId, side)

      io.to(roomId).emit('card:update', {
        aoe: st.aoe,
        cardPlayedBy: st.cardPlayedBy,
      })

      io.to(roomId).emit('chat:message', {
        from: 'system',
        text: `RNG Blast placed by ${side === 'w' ? 'White' : 'Black'} at ${sq} (detonates next turn)`,
      })

      return { ok: true }
    }

    // -------- ล้างบัพทั้งหมด --------
    case 'CLEANSE': {
      // ล้างทุกบัพ/สถานะทั้งสองฝั่ง
      st.extra = { w: 0, b: 0 }
      st.shield = { by: null, square: null }
      st.safeZone = { by: null, square: null }
      st.pawnRange = {}
      st.noKingBy = null
      st.aoe = null
      st.hitAndRunActiveSquare = null; st.revivedSquareThisTurn = null;

      st.cardPlayedBy = side

      removeFromHand(st.cards, side, uid)
      syncHandToSide(roomId, side)

      io.to(roomId).emit('card:update', {
        extra: st.extra,
        shield: st.shield,
        safeZone: st.safeZone,
        pawnRange: st.pawnRange,
        aoe: st.aoe,
        hitAndRunActiveSquare: st.hitAndRunActiveSquare, revivedSquareThisTurn: st.revivedSquareThisTurn,
        noKingBy: st.noKingBy,
        cardPlayedBy: st.cardPlayedBy,
      })

      return { ok: true }
    }

    // -------- โต้กลับ --------
    case 'SACRIFICE': {
      const lc = st.lastCapture
      if (!lc || lc.victim !== side || st.turn !== side) {
        return { ok: false, reason: 'no-recent-capture' }
      }
      const sq = payload?.sacrificeSquare
      if (!sq) return { ok: false, reason: 'need-sacrifice-square' }

      const ch = new Chess(lc.fenAfter)
      const atkColor = lc.victim === 'w' ? 'b' : 'w'
      const atkType = lc.attackerPieceType || 'p'
      ch.remove(lc.attackerTo)
      ch.put({ type: atkType, color: atkColor }, lc.attackerFrom)

      const reviveType = lc.capturedPieceType || 'p'
      ch.put({ type: reviveType, color: lc.victim }, lc.capturedSquare)

      ch.remove(sq)

      const parts = ch.fen().split(' ')
      parts[3] = '-'
      const fenAdjusted = parts.join(' ')

      // อัปเดตห้อง + สื่อสารไป client
      st.fen = fenAdjusted
      st.lastCapture = null
      st.cardPlayedBy = side
      st.noKingBy = side; st.revivedSquareThisTurn = lc.capturedSquare;

      removeFromHand(st.cards, side, uid)
      syncHandToSide(roomId, side)

      io.to(roomId).emit('counter:resolved', {
        fen: fenAdjusted,
        currentTurn: st.turn,
      })
      io.to(roomId).emit('card:update', {
        cardPlayedBy: st.cardPlayedBy,
        noKingBy: st.noKingBy, revivedSquareThisTurn: st.revivedSquareThisTurn,
      })

      return { ok: true }
    }

    default:
      return { ok: false, reason: 'unknown-card' }
  }
}

export function resolveAoe(roomId, st, io) {
  if (!st.aoe || !st.aoe.center) {
    st.aoe = null;
    io.to(roomId).emit('card:update', { aoe: null });
    return;
  }

  const sq = st.aoe.center;
  const ch = new Chess(st.fen);

  const file = sq.charCodeAt(0);
  const rank = parseInt(sq[1], 10);
  const targets = [];

  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      const f = file + df;
      const r = rank + dr;
      if (f < 97 || f > 104) continue;
      if (r < 1 || r > 8) continue;

      const checkSq = String.fromCharCode(f) + r;
      const p = ch.get(checkSq);
      if (p && p.type !== 'k') {
        targets.push({ sq: checkSq, p });
      }
    }
  }

  if (!targets.length) {
    io.to(roomId).emit('chat:message', {
      from: 'system',
      text: `RNG Blast at ${sq} detonated but found no valid targets.`,
    });
  } else {
    const idx = Math.floor(Math.random() * targets.length);
    const victimSq = targets[idx].sq;
    const victimPiece = targets[idx].p;

    ch.remove(victimSq);
    const parts = ch.fen().split(' ');
    parts[3] = '-';
    const fenNew = parts.join(' ');
    st.fen = fenNew;

    io.to(roomId).emit('game:move', {
      move: {
        from: null,
        to: null,
        san: 'AOE',
        special: 'RNG_BLAST',
        target: victimSq,
        victimType: victimPiece.type,
        victimColor: victimPiece.color,
      },
      fenAfter: fenNew,
      currentTurn: st.turn,
    });

    const pt = victimPiece.type === 'p' ? 'Pawn' : victimPiece.type.toUpperCase();
    const sideName = victimPiece.color === 'w' ? 'White' : 'Black';

    io.to(roomId).emit('chat:message', {
      from: 'system',
      text: `RNG BLAST at ${sq} destroyed ${sideName} ${pt} at ${victimSq}`,
    });
  }

  st.aoe = null;
  io.to(roomId).emit('card:update', { aoe: null });
}
