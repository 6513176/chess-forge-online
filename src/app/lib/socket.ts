import { io } from 'socket.io-client'

// ✅ สร้าง socket ตัวเดียวในทั้งระบบ
export const socket = io('http://localhost:3001', {
  forceNew: false,
  autoConnect: true,
  reconnection: true,
})
