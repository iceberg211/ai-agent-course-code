function toDate(value: string | Date | null | undefined) {
  if (!value) return null
  return value instanceof Date ? value : new Date(value)
}

export function formatDateTime(value: string | Date | null | undefined) {
  const date = toDate(value)
  if (!date) return '未记录'

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatRelativeTime(value: string | Date | null | undefined) {
  const date = toDate(value)
  if (!date) return '刚刚'

  const diffMs = date.getTime() - Date.now()
  const diffMinutes = Math.round(diffMs / 60_000)
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, 'minute')
  }

  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour')
  }

  const diffDays = Math.round(diffHours / 24)
  return formatter.format(diffDays, 'day')
}

export function formatDuration(
  startedAt: string | Date | null | undefined,
  completedAt: string | Date | null | undefined,
) {
  const start = toDate(startedAt)
  const end = toDate(completedAt)

  if (!start) return '未开始'

  const diffMs = (end ?? new Date()).getTime() - start.getTime()
  const totalSeconds = Math.max(1, Math.round(diffMs / 1_000))

  if (totalSeconds < 60) {
    return `${totalSeconds} 秒`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes < 60) {
    return `${minutes} 分 ${seconds} 秒`
  }

  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return `${hours} 小时 ${remainMinutes} 分`
}
