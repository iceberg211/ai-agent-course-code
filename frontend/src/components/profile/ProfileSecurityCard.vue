<template>
  <section class="bg-red-500/5 border border-red-200 rounded-xl p-6 flex flex-col gap-5">
    <div class="text-left">
      <h4 class="text-[14.5px] font-bold text-red-600 m-0">敏感数据与账户安全</h4>
      <p class="text-xs text-text-muted mt-1 m-0">清空本地配置或安全退出当前系统。</p>
    </div>
    <div class="flex flex-col gap-5">
      <div class="flex flex-col items-start gap-2">
        <button
          class="inline-flex items-center gap-1.5 px-4 py-2.5 bg-red-600 text-white border-none rounded-lg text-xs font-bold cursor-pointer"
          type="button"
          @click="$emit('reset-cache')"
        >
          <Trash2Icon :size="14" />
          清除浏览器本地缓存
        </button>
        <p class="text-xs text-text-muted m-0 leading-relaxed">重置浏览器中临时保存的 RAG 检索草稿和本地配置参数。</p>
      </div>
      <div class="flex flex-col items-start gap-2 border-t border-red-500/10 pt-5">
        <button
          class="inline-flex items-center gap-1.5 px-4 py-2.5 bg-amber-600 text-white border-none rounded-lg text-xs font-bold cursor-pointer"
          type="button"
          @click="$emit('logout')"
        >
          <LogOutIcon :size="14" />
          安全退出登录
        </button>
        <p class="text-xs text-text-muted m-0 leading-relaxed">退出并清空当前用户的访问状态，返回登录页。</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { LogOutIcon, Trash2Icon } from 'lucide-vue-next'

defineEmits<{
  (e: 'reset-cache'): void
  (e: 'logout'): void
}>()
</script>
