import { Chess } from 'chess.js';

// Setup scenario: White captures Black pawn
const ch1 = new Chess();
ch1.move('e4');
ch1.move('d5');
ch1.move('exd5'); // White captures Black's pawn on d5

const fenAfter = ch1.fen(); // Active turn is Black
console.log("fenAfter:", fenAfter);

// Now Black plays COUNTER_SACRIFICE
const ch2 = new Chess(fenAfter);
// White's pawn moved from e4 to d5 to capture.
// Reverse it:
ch2.remove('d5');
ch2.put({ type: 'p', color: 'w' }, 'e4');
ch2.put({ type: 'p', color: 'b' }, 'd5'); // Revive Black's pawn
ch2.remove('a7'); // Black sacrifices a7 pawn

const fenAdjusted = ch2.fen();
console.log("fenAdjusted:", fenAdjusted);

// Test if it loads
const ch3 = new Chess();
const ok = ch3.load(fenAdjusted);
console.log("Did it load successfully?", ok);
