import { Chess } from 'chess.js';

try {
  const fenEnPassant = 'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR w KQkq d3 0 2';
  const ch = new Chess(fenEnPassant);
  console.log('En passant FEN loaded successfully');
} catch (e) {
  console.log('En passant FEN failed:', e.message);
}
