import axios, { AxiosError } from 'axios'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api'

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: 20_000,
})

/** 后端标准化错误格式（GlobalExceptionFilter 输出） */
interface ApiErrorBody {
  statusCode: number
  message: string
  path: string
  timestamp: string
}

/**
 * 响应拦截器：把后端标准化错误转成带 message 的 Error，
 * 让上层 (TanStack Query / catch) 能直接用 error.message 显示提示。
 */
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorBody>) => {
    const backendMessage = error.response?.data?.message
    if (backendMessage) {
      // 用后端给的 message 替换 axios 默认的 "Request failed with status code 404"
      return Promise.reject(new Error(backendMessage))
    }
    // 无响应（网络断了 / 超时）
    if (!error.response) {
      if (error.code === 'ECONNABORTED' || error.message?.toLowerCase().includes('timeout')) {
        return Promise.reject(new Error('请求超时，服务器响应过慢，请稍后重试'))
      }
      return Promise.reject(new Error('网络请求失败，请检查连接'))
    }
    return Promise.reject(error)
  },
)
