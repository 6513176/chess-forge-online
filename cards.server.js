// cards.server.js (ESM version)

// ==== Card ทั้ง 26 ใบ ====
// ตอนนี้ใช้ 3 ชนิดเดิม แต่กระจายจำนวนให้ครบ 26 ใบ
// ถ้าคุณออกแบบการ์ดใหม่ ค่อยมาแก้ตรงนี้ทีหลังได้
const ALL_CARD_IDS = [
  // 10 ใบ: BUFF_EXTRA_MOVE
  'BUFF_EXTRA_MOVE',
  'BUFF_EXTRA_MOVE',
  'BUFF_EXTRA_MOVE',
  'BUFF_EXTRA_MOVE',
  'BUFF_EXTRA_MOVE',
  'BUFF_EXTRA_MOVE',
  'BUFF_EXTRA_MOVE',
  'BUFF_EXTRA_MOVE',
  'BUFF_EXTRA_MOVE',
  'BUFF_EXTRA_MOVE',

  // 8 ใบ: DEF_SHIELD
  'DEF_SHIELD',
  'DEF_SHIELD',
  'DEF_SHIELD',
  'DEF_SHIELD',
  'DEF_SHIELD',
  'DEF_SHIELD',
  'DEF_SHIELD',
  'DEF_SHIELD',

  // 8 ใบ: COUNTER_SACRIFICE
  'COUNTER_SACRIFICE',
  'COUNTER_SACRIFICE',
  'COUNTER_SACRIFICE',
  'COUNTER_SACRIFICE',
  'COUNTER_SACRIFICE',
  'COUNTER_SACRIFICE',
  'COUNTER_SACRIFICE',
  'COUNTER_SACRIFICE',
];

const mkUid = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

// random deck 26 ใบจาก ALL_CARD_IDS
function createNewDeck() {
  const arr = [...ALL_CARD_IDS];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr; // CardId[]
}

// จั่ว n ใบจาก deck (mutate deck)
function drawCards(deck, n) {
  const drawn = [];
  for (let i = 0; i < n; i++) {
    if (!deck.length) break;
    const id = deck.shift(); // เอาจากหัวกอง
    drawn.push({ id, uid: mkUid() }); // CardInstance แบบ {id, uid}
  }
  return drawn;
}

// state เริ่มต้นของระบบการ์ดในห้องนึง
export function freshCardState() {
  const deck = createNewDeck(); // 26 ใบ
  const hands = { w: [], b: [] };

  // แจกคนละ 3 → deck เหลือ 20
  hands.w = drawCards(deck, 3);
  hands.b = drawCards(deck, 3);

  return {
    deck,               // CardId[]
    hands,              // { w: CardInstance[], b: CardInstance[] }
    graveyard: [],      // ใบที่ใช้แล้ว
    playedThisTurn: { w: false, b: false },
  };
}

// จั่ว 1 ใบให้ฝั่งที่ระบุ
export function drawOneForSide(cardState, side) {
  const got = drawCards(cardState.deck, 1);
  if (got.length) {
    cardState.hands[side].push(got[0]);
    return got[0];
  }
  return null;
}

// เอาการ์ดออกจากมือด้วย uid แล้วโยนเข้ากองทิ้ง
export function removeFromHand(cardState, side, uid) {
  const hand = cardState.hands[side];
  const idx = hand.findIndex((c) => c.uid === uid);
  if (idx >= 0) {
    const [removed] = hand.splice(idx, 1);
    cardState.graveyard.push(removed);
    return removed;
  }
  return null;
}
