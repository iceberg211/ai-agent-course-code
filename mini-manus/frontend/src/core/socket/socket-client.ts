import { io, type Socket } from 'socket.io-client'

const socketUrl = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3000'

let taskSocket: Socket | null = null

export function getTaskSocket() {
  if (!taskSocket) {
    taskSocket = io(socketUrl, {
      autoConnect: false,
      transports: ['websocket'],
    })
  }

  return taskSocket
}
