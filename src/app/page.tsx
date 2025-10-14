'use client'

import { useEffect, useState, useCallback } from 'react'
import { Chess, Square } from 'chess.js'
import { socket } from './lib/socket'
import ChatBox from './components/ChatBox'
import MoveBox from './components/MoveBox'

export default function Page() {
  const [game, setGame] = useState(new Chess())
  const [fen, setFen] = useState(game.fen())
  const [color, setColor] = useState<'white' | 'black'>('white')
  const [chat, setChat] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [turn, setTurn] = useState<'w' | 'b'>('w')
  const [moveSquares, setMoveSquares] = useState<
    Partial<Record<Square, { background: string }>>
  >({})

  // ✅ handleMove, handleChat แยกออกมาเพื่อไม่ให้ re-register socket ทุกครั้ง
  const handleMove = useCallback(
    ({ from, to }: { from: string; to: string }) => {
      const updated = new Chess(fen)
      updated.move({ from, to, promotion: 'q' })
      setGame(updated)
      setFen(updated.fen())
      setTurn(updated.turn())
      setMoveSquares({})
    },
    [fen]
  )

  const handleChat = useCallback((msg: string) => {
    setChat((prev) => [...prev, msg])
  }, [])

  // ✅ จัดการ socket event แค่ครั้งเดียว
  useEffect(() => {
    socket.on('connect', () =>
      console.log('[CLIENT] Connected with ID:', socket.id)
    )
    socket.on('move', handleMove)
    socket.on('color', (assigned: 'white' | 'black') => setColor(assigned))
    socket.on('chat', handleChat)
    socket.on('connect_error', (err) => console.error('Socket error:', err))
    socket.on('disconnect', () => console.warn('Socket disconnected'))
    socket.on('reconnect', (n) => console.log('Reconnected after', n, 'tries'))

    return () => {
      socket.off('move', handleMove)
      socket.off('color')
      socket.off('chat', handleChat)
    }
  }, [handleMove, handleChat])

  // ✅ ป้องกันฝั่งตรงข้ามขยับหมาก
  const makeAMove = (move: { from: string; to: string }) => {
    const isMyTurn =
      (color === 'white' && turn === 'w') ||
      (color === 'black' && turn === 'b')
    if (!isMyTurn) return false

    const updated = new Chess(fen)
    const result = updated.move({ from: move.from, to: move.to, promotion: 'q' })
    if (result) {
      setGame(updated)
      setFen(updated.fen())
      setTurn(updated.turn())
      setMoveSquares({})
      socket.emit('move', move)
      return true
    }
    return false
  }

  // ✅ แสดงทิศทางการเดิน
  const onMouseOverSquare = (square: Square) => {
    try {
      const moves = game.moves({ square, verbose: true })
      if (moves.length === 0) return
      const highlights: Partial<Record<Square, { background: string }>> = {}
      moves.forEach((m) => {
        highlights[m.to] = {
          background:
            'radial-gradient(circle, rgba(255,255,0,0.4) 36%, transparent 40%)',
        }
      })
      setMoveSquares(highlights)
    } catch (e) {
      console.error('Invalid square hover:', e)
    }
  }

  const onMouseOutSquare = () => {
    setMoveSquares({})
  }

  // ✅ ส่งข้อความ
  const sendMessage = () => {
    if (message.trim() !== '') {
      socket.emit('chat', message)
      setChat((prev) => [...prev, `Me: ${message}`])
      setMessage('')
    }
  }

  return (
    <main className="flex justify-center items-center min-h-screen bg-gray-900 text-white px-4">
      <div className="grid grid-cols-1 md:grid-cols-[auto_300px] gap-6 w-full max-w-7xl">
        <div className="flex flex-col gap-2">
          <MoveBox
            fen={fen}
            color={color}
            makeAMove={makeAMove}
            onMouseOverSquare={(square) => onMouseOverSquare(square as Square)}
            onMouseOutSquare={onMouseOutSquare}
            moveSquares={moveSquares}
          />
          <div className="text-center text-sm text-gray-400">
            Turn:{' '}
            <span className="font-bold text-white">
              {turn === 'w' ? 'White' : 'Black'}
            </span>
          </div>
        </div>

        <ChatBox
          chat={chat}
          message={message}
          setMessage={setMessage}
          sendMessage={sendMessage}
        />
      </div>
    </main>
  )
}
