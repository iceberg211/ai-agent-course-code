import { io, type Socket } from 'socket.io-client'

const socketUrl = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3000'
const wsAuthToken = import.meta.env.VITE_WS_AUTH_TOKEN

let taskSocket: Socket | null = null
let socketConsumerCount = 0

export function getTaskSocket() {
  if (!taskSocket) {
    taskSocket = io(socketUrl, {
      autoConnect: false,
      transports: ['websocket'],
      auth: wsAuthToken ? { token: wsAuthToken } : undefined,
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
