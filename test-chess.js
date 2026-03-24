import { Chess } from 'chess.js';

const ch = new Chess();
ch.move('e4');
ch.move('d5');
const fenBefore = ch.fen();
const mv = ch.move('exd5'); // White captures on d5
const fenAfter = ch.fen();

console.log('fenBefore:', fenBefore);
console.log('fenAfter:', fenAfter);

// Now Black plays COUNTER_SACRIFICE sacrificing their e7 pawn
const ch2 = new Chess(fenAfter);
// Attack color = White, victim = Black
ch2.remove('d5'); // attackerTo
ch2.put({ type: 'p', color: 'w' }, 'e4'); // attackerFrom

ch2.put({ type: 'p', color: 'b' }, 'd5'); // revive victim

ch2.remove('e7'); // sac

const parts = ch2.fen().split(' ');
parts[3] = '-';
const fenAdjusted = parts.join(' ');

console.log('fenAdjusted:', fenAdjusted);

const ch3 = new Chess(fenAdjusted);
console.log('Black moves after sacrifice:');
console.log(ch3.moves({ verbose: true }));
