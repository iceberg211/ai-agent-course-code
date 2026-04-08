export function truncateText(value: string, length = 80) {
  if (value.length <= length) return value
  return `${value.slice(0, length).trimEnd()}...`
}

export function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}
