<template>
  <div class="relative w-full h-screen flex justify-center items-center bg-transparent overflow-hidden">
    <!-- 发光球动画 -->
    <div class="absolute rounded-full blur-[120px] opacity-12 pointer-events-none w-[450px] h-[450px] bg-gradient-to-r from-indigo-400 to-purple-400 -top-[5%] left-[5%] animate-[floatOrb_22s_ease-in-out_infinite_alternate]"></div>
    <div class="absolute rounded-full blur-[120px] opacity-12 pointer-events-none w-[500px] h-[500px] bg-gradient-to-r from-blue-400 to-sky-400 -bottom-[10%] right-[5%] animate-[floatOrb_26s_ease-in-out_infinite_alternate-reverse]"></div>
    <div class="absolute rounded-full blur-[120px] opacity-12 pointer-events-none w-[350px] h-[350px] bg-gradient-to-r from-indigo-400 to-blue-400 top-[35%] left-[45%] animate-[floatOrb_18s_ease-in-out_infinite_alternate]"></div>

    <!-- 登录注册卡片：高通透亮色磨砂玻璃 -->
    <div class="relative w-[420px] p-11 pb-9 bg-white/45 backdrop-blur-[20px] border border-white/70 rounded-xl shadow-[0_10px_30px_-10px_rgba(0,0,0,0.04),0_20px_40px_-15px_rgba(59,130,246,0.08),inset_0_1px_0_0_rgba(255,255,255,0.6)] z-10 transition-all duration-300 hover:border-white/95 hover:shadow-[0_12px_35px_-10px_rgba(0,0,0,0.06),0_25px_45px_-12px_rgba(59,130,246,0.12)]">
      <div class="text-center mb-8">
        <h1 class="text-[26px] font-bold tracking-tight mb-2 bg-gradient-to-br from-text-main to-primary bg-clip-text text-transparent">RAG Agent</h1>
        <p class="text-xs text-text-muted leading-relaxed">
          {{ isLogin ? '探索下一代多模态 RAG 对话智能体' : '开启您的智能代理之旅' }}
        </p>
      </div>

      <!-- Tab 切换 -->
      <div class="relative flex bg-blue-300/8 border border-blue-300/15 p-[3px] rounded-md mb-7">
        <button
          class="relative flex-1 bg-transparent border-none text-text-muted text-[13.5px] font-medium py-2 cursor-pointer z-10 transition-colors duration-300"
          :class="{ 'text-primary font-semibold': isLogin }"
          @click="switchTab(true)"
        >
          登录账户
        </button>
        <button
          class="relative flex-1 bg-transparent border-none text-text-muted text-[13.5px] font-medium py-2 cursor-pointer z-10 transition-colors duration-300"
          :class="{ 'text-primary font-semibold': !isLogin }"
          @click="switchTab(false)"
        >
          快速注册
        </button>
        <!-- 滚动滑块背景 -->
        <div
          class="absolute top-[3px] bottom-[3px] left-[3px] w-[calc(50%-3px)] bg-white rounded-[10px] z-[1] shadow-[0_2px_8px_rgba(59,130,246,0.1)] transition-transform duration-300 border border-white/80"
          :style="{ transform: `translateX(${isLogin ? '0%' : '100%'})` }"
        ></div>
      </div>

      <!-- 表单区域 -->
      <form class="flex flex-col gap-[18px]" @submit.prevent="handleSubmit">
        <div class="flex flex-col gap-1.5 text-left">
          <label for="username" class="text-[12.5px] font-medium text-text-secondary">用户名</label>
          <div class="relative flex items-center">
            <span class="absolute left-[14px] text-text-muted flex items-center justify-center transition-colors duration-300 pointer-events-none">
              <!-- Lucide User Icon -->
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            </span>
            <input
              id="username"
              v-model="form.username"
              type="text"
              class="w-full bg-white border border-border-main rounded-md py-[11px] px-[14px] pl-10 text-text-main text-[13.5px] outline-none transition-all placeholder-slate-400 focus:border-primary focus:ring-3 focus:ring-border-focus"
              placeholder="请输入您的用户名"
              autocomplete="username"
              required
            />
          </div>
        </div>

        <div class="flex flex-col gap-1.5 text-left">
          <label for="password" class="text-[12.5px] font-medium text-text-secondary">密码</label>
          <div class="relative flex items-center">
            <span class="absolute left-[14px] text-text-muted flex items-center justify-center transition-colors duration-300 pointer-events-none">
              <!-- Lucide Lock Icon -->
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            </span>
            <input
              id="password"
              v-model="form.password"
              type="password"
              class="w-full bg-white border border-border-main rounded-md py-[11px] px-[14px] pl-10 text-text-main text-[13.5px] outline-none transition-all placeholder-slate-400 focus:border-primary focus:ring-3 focus:ring-border-focus"
              placeholder="请输入您的密码"
              autocomplete="current-password"
              required
            />
          </div>
        </div>

        <div v-if="!isLogin" class="flex flex-col gap-1.5 text-left">
          <label for="confirmPassword" class="text-[12.5px] font-medium text-text-secondary">确认密码</label>
          <div class="relative flex items-center">
            <span class="absolute left-[14px] text-text-muted flex items-center justify-center transition-colors duration-300 pointer-events-none">
              <!-- Lucide Check Icon -->
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </span>
            <input
              id="confirmPassword"
              v-model="form.confirmPassword"
              type="password"
              class="w-full bg-white border border-border-main rounded-md py-[11px] px-[14px] pl-10 text-text-main text-[13.5px] outline-none transition-all placeholder-slate-400 focus:border-primary focus:ring-3 focus:ring-border-focus"
              placeholder="请再次确认您的密码"
              autocomplete="new-password"
              required
            />
          </div>
        </div>

        <!-- 错误提示组件（淡入淡出动画） -->
        <Transition name="fade-alert">
          <div
            v-if="errorMsg"
            class="flex items-center gap-2 bg-red-500/8 border border-red-500/15 p-2 px-3 rounded-md text-error text-[12.5px] leading-relaxed text-left"
          >
            <span class="flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            </span>
            <span>{{ errorMsg }}</span>
          </div>
        </Transition>

        <!-- 按钮 -->
        <button
          type="submit"
          class="relative bg-[linear-gradient(135deg,#4f46e5_0%,#3b82f6_50%,#06b6d4_100%)] bg-[length:200%_200%] animate-[moveGradient_8s_ease_infinite] border-none rounded-md py-[13px] text-white text-[14.5px] font-semibold cursor-pointer flex justify-center items-center shadow-[0_6px_20px_rgba(59,130,246,0.25)] transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_10px_25px_rgba(59,130,246,0.35)] active:translate-y-[1px] disabled:opacity-65 disabled:pointer-events-none disabled:-translate-y-0 disabled:shadow-none mt-2"
          :disabled="loading"
        >
          <span v-if="loading" class="w-4 h-4 border-2 border-white/35 border-t-white rounded-full animate-spin"></span>
          <span v-else>{{ isLogin ? '开启智能对话' : '立即注册账户' }}</span>
        </button>
      </form>
    </div>

    <!-- 自定义轻量级 Toast 弹出器 -->
    <Transition name="toast-slide">
      <div
        v-if="toastMsg"
        class="fixed top-6 left-1/2 -translate-x-1/2 py-2.5 px-5 rounded-md text-[13.5px] font-medium shadow-[0_8px_24px_rgba(0,0,0,0.08)] z-[999] backdrop-blur-[8px]"
        :class="toastType === 'success' ? 'bg-emerald-500/10 border border-emerald-500/25 text-success' : 'bg-red-500/10 border border-red-500/25 text-error'"
      >
        {{ toastMsg }}
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const isLogin = ref(true)
const loading = ref(false)
const errorMsg = ref('')

const toastMsg = ref('')
const toastType = ref<'success' | 'error'>('success')

const form = reactive({
  username: '',
  password: '',
  confirmPassword: '',
})

function switchTab(val: boolean) {
  isLogin.value = val
  errorMsg.value = ''
  form.username = ''
  form.password = ''
  form.confirmPassword = ''
}

function showToast(msg: string, type: 'success' | 'error' = 'success') {
  toastMsg.value = msg
  toastType.value = type
  setTimeout(() => {
    toastMsg.value = ''
  }, 3000)
}

async function handleSubmit() {
  const username = form.username.trim()
  const password = form.password.trim()

  if (!username || !password) {
    errorMsg.value = '用户名与密码不能为空'
    return
  }

  errorMsg.value = ''
  loading.value = true

  if (isLogin.value) {
    const success = await authStore.login(username, password)
    loading.value = false

    if (success) {
      showToast('登录成功，欢迎回来！', 'success')
      setTimeout(() => {
        router.push('/dashboard')
      }, 800)
    } else {
      errorMsg.value = '用户名或密码错误，请稍后重试'
    }
  } else {
    const confirm = form.confirmPassword.trim()
    if (password !== confirm) {
      errorMsg.value = '两次输入的密码不一致'
      loading.value = false
      return
    }

    if (password.length < 6) {
      errorMsg.value = '密码长度至少为 6 位'
      loading.value = false
      return
    }

    const result = await authStore.register(username, password)
    loading.value = false

    if (result.ok) {
      showToast('注册成功！正在为您自动登录', 'success')
      loading.value = true
      const success = await authStore.login(username, password)
      loading.value = false
      if (success) {
        setTimeout(() => {
          router.push('/dashboard')
        }, 1000)
      } else {
        switchTab(true)
      }
    } else {
      errorMsg.value = result.message || '注册失败，请更换用户名'
    }
  }
}
</script>

<style scoped>
@keyframes floatOrb {
  0% { transform: translate(0, 0) scale(1); }
  100% { transform: translate(60px, 40px) scale(1.05); }
}

@keyframes moveGradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

.input-wrapper:focus-within .icon {
  color: var(--color-primary) !important;
}

/* Transitions */
.fade-alert-enter-active,
.fade-alert-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.fade-alert-enter-from,
.fade-alert-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}

.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.toast-slide-enter-from,
.toast-slide-leave-to {
  opacity: 0;
  transform: translate(-50%, -15px);
}
</style>
