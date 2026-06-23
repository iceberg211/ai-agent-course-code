import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@/style.css'
import App from '@/App.vue'
import { router } from '@/router'

// 全局 Fetch 拦截器：注入 Bearer Token 并统一处理 401 未登录
const originalFetch = window.fetch
window.fetch = async (input, init) => {
  const urlStr = typeof input === 'string' ? input : (input as Request).url
  const isAuthRoute = urlStr.includes('/auth/login') || urlStr.includes('/auth/register')

  if (!isAuthRoute) {
    const token = localStorage.getItem('jwt_token')
    if (token) {
      init = init || {}
      init.headers = init.headers || {}
      if (init.headers instanceof Headers) {
        init.headers.set('Authorization', `Bearer ${token}`)
      } else if (Array.isArray(init.headers)) {
        // 兜底支持数组形式的 header
        const hasAuth = init.headers.some(([k]) => k.toLowerCase() === 'authorization')
        if (!hasAuth) {
          init.headers.push(['Authorization', `Bearer ${token}`])
        }
      } else {
        (init.headers as any)['Authorization'] = `Bearer ${token}`
      }
    }
  }

  const response = await originalFetch(input, init)

  if (response.status === 401 && !isAuthRoute) {
    localStorage.removeItem('jwt_token')
    localStorage.removeItem('user_info')
    window.location.href = '/login'
  }

  return response
}

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
