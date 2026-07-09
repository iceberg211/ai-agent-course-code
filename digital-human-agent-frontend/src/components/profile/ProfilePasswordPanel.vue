<template>
  <section class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-6 shadow-[0_4px_20px_rgba(15,23,42,0.02)] flex flex-col gap-5">
    <div>
      <h4 class="text-[14.5px] font-bold text-text-main m-0">修改账户密码</h4>
      <p class="text-xs text-text-muted mt-1 m-0">定期修改密码有利于保障账户及知识数据安全。</p>
    </div>
    <form class="flex flex-col gap-4" @submit.prevent="$emit('submit')">
      <label class="flex flex-col gap-1.5 text-left">
        <span class="text-xs font-bold text-text-secondary">当前旧密码</span>
        <input
          :value="oldPassword"
          type="password"
          class="w-full h-10 px-3 border border-border-main rounded-lg text-xs outline-none focus:border-primary"
          placeholder="请输入旧密码"
          required
          @input="$emit('update:oldPassword', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="flex flex-col gap-1.5 text-left">
        <span class="text-xs font-bold text-text-secondary">新密码</span>
        <input
          :value="newPassword"
          type="password"
          class="w-full h-10 px-3 border border-border-main rounded-lg text-xs outline-none focus:border-primary"
          placeholder="请输入新密码（至少 6 位）"
          required
          @input="$emit('update:newPassword', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="flex flex-col gap-1.5 text-left">
        <span class="text-xs font-bold text-text-secondary">确认新密码</span>
        <input
          :value="confirmPassword"
          type="password"
          class="w-full h-10 px-3 border border-border-main rounded-lg text-xs outline-none focus:border-primary"
          placeholder="请再次输入新密码"
          required
          @input="$emit('update:confirmPassword', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <p v-if="errorMsg" class="m-0 bg-red-500/8 border border-red-500/15 text-error p-2 px-3 rounded-lg text-xs">
        {{ errorMsg }}
      </p>
      <button
        class="inline-flex items-center justify-center gap-1.5 h-10 px-4 self-start bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white border-none rounded-lg text-xs font-bold cursor-pointer disabled:opacity-60"
        type="submit"
        :disabled="loading"
      >
        <KeyRoundIcon :size="14" />
        <span>{{ loading ? '正在提交...' : '确认修改密码' }}</span>
      </button>
    </form>
  </section>
</template>

<script setup lang="ts">
import { KeyRoundIcon } from 'lucide-vue-next'

defineProps<{
  oldPassword: string
  newPassword: string
  confirmPassword: string
  loading: boolean
  errorMsg: string
}>()

defineEmits<{
  (e: 'update:oldPassword', value: string): void
  (e: 'update:newPassword', value: string): void
  (e: 'update:confirmPassword', value: string): void
  (e: 'submit'): void
}>()
</script>
