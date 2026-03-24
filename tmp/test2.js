import { Chess } from 'chess.js';

const fenAfter = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2';

const ch2 = new Chess(fenAfter);
ch2.remove('d5');
ch2.put({ type: 'p', color: 'w' }, 'e4');
ch2.put({ type: 'p', color: 'b' }, 'd5'); 
ch2.remove('a7'); 

const fenAdjusted = ch2.fen();
console.log("fenAdjusted:", fenAdjusted);

try {
  const ch3 = new Chess(fenAdjusted);
  const moves = ch3.moves({ verbose: true });
  console.log('Moves available:', moves.length);
  if (moves.length > 0) console.log(moves[0]);
} catch (e) {
  console.log('Error loading fenAdjusted:', e.message);
}
