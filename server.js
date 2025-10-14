import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'

const app = express()
const server = createServer(app)
const io = new Server(server, {
  cors: {
    origin: '*',
  },
})

let players = []

io.on('connection', (socket) => {
  console.log('a user connected:', socket.id)

  if (players.length < 2) {
    const assignedColor = players.length === 0 ? 'white' : 'black'
    players.push({ id: socket.id, color: assignedColor })
    socket.emit('color', assignedColor)
  }

  socket.on('move', (move) => {
    socket.broadcast.emit('move', move)
  })

  // ✅ แชทระหว่างผู้เล่น
  socket.on('chat', (msg) => {
    console.log('[SERVER] Chat received:', msg)
    socket.broadcast.emit('chat', `Opponent: ${msg}`)
})


  socket.on('disconnect', () => {
    console.log('user disconnected:', socket.id)
    players = players.filter((p) => p.id !== socket.id)
  })
})

server.listen(3001, () => {
  console.log('listening on *:3001')
})
