'use client'

import { Chessboard } from 'react-chessboard'

export default function MoveBox({
  fen,
  color,
  makeAMove,
  onMouseOverSquare,
  onMouseOutSquare,
  moveSquares,
}: {
  fen: string
  color: 'white' | 'black'
  makeAMove: (move: { from: string; to: string }) => boolean
  onMouseOverSquare: (square: string) => void
  onMouseOutSquare: () => void
  moveSquares: Partial<Record<string, { background: string }>> // ✅ เปลี่ยนจาก any
}) {

  return (
    <div className="p-4 bg-gray-800 rounded-2xl shadow-xl w-full max-w-[680px]">
      <Chessboard
        position={fen}
        onPieceDrop={(source, target) => makeAMove({ from: source, to: target })}
        boardOrientation={color}
        onMouseOverSquare={onMouseOverSquare}
        onMouseOutSquare={onMouseOutSquare}
        customSquareStyles={moveSquares}
        customBoardStyle={{
          width: '100%',
          height: 'auto',
          borderRadius: 16,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}
      />
      <div className="mt-4 text-center text-sm text-gray-400">
        Your Color: <span className="font-bold text-white">{color}</span>
      </div>
    </div>
  )
}

