import { ref, onUnmounted } from 'vue'

/**
 * 轻量级 Toast 通知 Hook。
 *
 * 使用方式：
 * ```ts
 * const { toastMsg, showToast } = useToast()
 * showToast('操作成功')
 * showToast('⚠ 出错了', 5000) // 自定义显示时长
 * ```
 */
export function useToast(defaultDurationMs = 3500) {
  const toastMsg = ref('')
  let timer: ReturnType<typeof setTimeout> | null = null

  function showToast(msg: string, durationMs = defaultDurationMs) {
    toastMsg.value = msg
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      toastMsg.value = ''
      timer = null
    }, durationMs)
  }

  function clearToast() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    toastMsg.value = ''
  }

  onUnmounted(() => {
    if (timer) clearTimeout(timer)
  })

  return { toastMsg, showToast, clearToast }
}
