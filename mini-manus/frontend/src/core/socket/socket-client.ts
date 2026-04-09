import { io, type Socket } from 'socket.io-client'

const socketUrl = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3000'

let taskSocket: Socket | null = null
let socketConsumerCount = 0

export function getTaskSocket() {
  if (!taskSocket) {
    taskSocket = io(socketUrl, {
      autoConnect: false,
      transports: ['websocket'],
    })
  }

  return taskSocket
}

export function acquireTaskSocket() {
  const socket = getTaskSocket()
  socketConsumerCount += 1
  if (!socket.connected) {
    socket.connect()
  }
  return socket
}

export function releaseTaskSocket() {
  socketConsumerCount = Math.max(0, socketConsumerCount - 1)
  if (socketConsumerCount === 0) {
    taskSocket?.disconnect()
  }
}
