import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useSessionStore } from '@/stores/session'

export interface UserInfo {
  id: string
  username: string
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('jwt_token') || '')
  const user = ref<UserInfo | null>(null)

  // 初始化时解析本地保存的用户信息
  try {
    const savedUser = localStorage.getItem('user_info')
    if (savedUser) {
      user.value = JSON.parse(savedUser)
    }
  } catch (e) {
    console.error('Failed to parse user_info from localStorage', e)
  }

  function setToken(accessToken: string, userInfo: UserInfo) {
    token.value = accessToken
    user.value = userInfo
    localStorage.setItem('jwt_token', accessToken)
    localStorage.setItem('user_info', JSON.stringify(userInfo))
  }

  async function login(username: string, passwordPlain: string): Promise<boolean> {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password: passwordPlain }),
      })

      if (!res.ok) {
        return false
      }

      const data = await res.json()
      if (data && data.accessToken && data.user) {
        setToken(data.accessToken, data.user)
        return true
      }
      return false
    } catch (e) {
      console.error('Login error', e)
      return false
    }
  }

  async function register(username: string, passwordPlain: string): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password: passwordPlain }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        return {
          ok: false,
          message: errorData.message || '注册失败，用户名可能已存在',
        }
      }

      return { ok: true }
    } catch (e) {
      console.error('Register error', e)
      return { ok: false, message: '网络错误，请稍后再试' }
    }
  }

  function logout() {
    token.value = ''
    user.value = null
    localStorage.removeItem('jwt_token')
    localStorage.removeItem('user_info')
    
    // 清空 sessionStore 中的对话历史，避免切换用户时数据缓存
    try {
      const sessionStore = useSessionStore()
      sessionStore.reset()
    } catch (e) {
      // 避免引用错误
    }
  }

  return { token, user, login, register, logout }
})
