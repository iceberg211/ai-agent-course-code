export class ApiError extends Error {
  status: number
  body: unknown

  constructor(message: string, status: number, body: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError }

function resolveAuthToken(): string | null {
  return localStorage.getItem('jwt_token')
}

function clearAuthAndRedirect() {
  localStorage.removeItem('jwt_token')
  localStorage.removeItem('user_info')
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    const redirect = encodeURIComponent(window.location.pathname + window.location.search)
    window.location.href = `/login?redirect=${redirect}`
  }
}

async function parseErrorBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') || ''
  try {
    if (contentType.includes('application/json')) {
      return await res.json()
    }
    const text = await res.text()
    return text || null
  } catch {
    return null
  }
}

function messageFromBody(body: unknown, fallback: string): string {
  if (!body) return fallback
  if (typeof body === 'string' && body.trim()) return body
  if (typeof body === 'object') {
    const record = body as Record<string, unknown>
    const candidates = [record.message, record.error, record.msg]
    for (const item of candidates) {
      if (typeof item === 'string' && item.trim()) return item
    }
  }
  return fallback
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = resolveAuthToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const res = await fetch(input, {
    ...init,
    headers,
  })

  if (res.status === 401 && !input.includes('/api/auth/login')) {
    clearAuthAndRedirect()
  }

  return res
}

export async function apiJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T | null> {
  const result = await apiJsonResult<T>(input, init)
  return result.ok ? result.data : null
}

export async function apiJsonResult<T>(
  input: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const res = await apiFetch(input, init)
    if (!res.ok) {
      const body = await parseErrorBody(res)
      return {
        ok: false,
        error: new ApiError(
          messageFromBody(body, `请求失败 (${res.status})`),
          res.status,
          body,
        ),
      }
    }

    if (res.status === 204) {
      return { ok: true, data: null as T }
    }

    const data = (await res.json()) as T
    return { ok: true, data }
  } catch (error) {
    console.error(`[apiJson] ${input}`, error)
    const message =
      error instanceof Error ? error.message : '网络异常，请检查后端服务是否可用'
    return {
      ok: false,
      error: new ApiError(message, 0, error),
    }
  }
}

export async function apiJsonOrThrow<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const result = await apiJsonResult<T>(input, init)
  if (result.ok === false) throw result.error
  return result.data
}
