export async function apiFetch(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  const token = localStorage.getItem('jwt_token')
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(input, {
    ...init,
    headers,
  })
}

export async function apiJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T | null> {
  try {
    const res = await apiFetch(input, init)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch (error) {
    console.error(`[apiJson] ${input}`, error)
    return null
  }
}
