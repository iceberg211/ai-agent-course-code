<template>
  <div class="login-container">
    <!-- 保留科技感发光球，但改为与亮色契合的淡粉紫和淡青蓝 -->
    <div class="glow-orb orb-1"></div>
    <div class="glow-orb orb-2"></div>
    <div class="glow-orb orb-3"></div>

    <!-- 登录注册卡片：高通透亮色磨砂玻璃 -->
    <div class="login-card">
      <div class="card-header">
        <h1 class="logo-text">Digital Human Agent</h1>
        <p class="subtitle-text">
          {{ isLogin ? '探索下一代多模态 RAG 对话智能体' : '开启您的智能代理之旅' }}
        </p>
      </div>

      <!-- Tab 切换 -->
      <div class="tab-wrapper">
        <button
          class="tab-btn"
          :class="{ active: isLogin }"
          @click="switchTab(true)"
        >
          登录账户
        </button>
        <button
          class="tab-btn"
          :class="{ active: !isLogin }"
          @click="switchTab(false)"
        >
          快速注册
        </button>
        <!-- 滚动滑块背景 -->
        <div
          class="tab-slider"
          :style="{ transform: `translateX(${isLogin ? '0%' : '100%'})` }"
        ></div>
      </div>

      <!-- 表单区域 -->
      <form
        class="form-body"
        @submit.prevent="handleSubmit"
      >
        <div class="input-group">
          <label for="username">用户名</label>
          <div class="input-wrapper">
            <span class="icon">
              <!-- Lucide User Icon -->
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            </span>
            <input
              id="username"
              v-model="form.username"
              type="text"
              placeholder="请输入您的用户名"
              autocomplete="username"
              required
            />
          </div>
        </div>

        <div class="input-group">
          <label for="password">密码</label>
          <div class="input-wrapper">
            <span class="icon">
              <!-- Lucide Lock Icon -->
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            </span>
            <input
              id="password"
              v-model="form.password"
              type="password"
              placeholder="请输入您的密码"
              autocomplete="current-password"
              required
            />
          </div>
        </div>

        <div
          v-if="!isLogin"
          class="input-group"
        >
          <label for="confirmPassword">确认密码</label>
          <div class="input-wrapper">
            <span class="icon">
              <!-- Lucide Check Icon -->
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </span>
            <input
              id="confirmPassword"
              v-model="form.confirmPassword"
              type="password"
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
            class="error-alert"
          >
            <span class="alert-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            </span>
            <span class="alert-text">{{ errorMsg }}</span>
          </div>
        </Transition>

        <!-- 按钮 -->
        <button
          type="submit"
          class="submit-btn"
          :disabled="loading"
        >
          <span
            v-if="loading"
            class="spinner"
          ></span>
          <span v-else>{{ isLogin ? '开启智能对话' : '立即注册账户' }}</span>
        </button>
      </form>
    </div>

    <!-- 自定义轻量级 Toast 弹出器 -->
    <Transition name="toast-slide">
      <div
        v-if="toastMsg"
        class="toast-popup"
        :class="toastType"
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
.login-container {
  position: relative;
  width: 100%;
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  /* 移除了原本深色的背景颜色，直接承接 body 既有的网格渐变，保证视觉一体性 */
  background: transparent;
  overflow: hidden;
}

/* 契合系统主色彩的浮动发光球，透明度稍弱以防喧宾夺主 */
.glow-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.12;
  pointer-events: none;
}

.orb-1 {
  width: 450px;
  height: 450px;
  background: radial-gradient(circle, #818cf8 0%, #c084fc 100%);
  top: -5%;
  left: 5%;
  animation: floatOrb 22s ease-in-out infinite alternate;
}

.orb-2 {
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, #60a5fa 0%, #38bdf8 100%);
  bottom: -10%;
  right: 5%;
  animation: floatOrb 26s ease-in-out infinite alternate-reverse;
}

.orb-3 {
  width: 350px;
  height: 350px;
  background: radial-gradient(circle, #818cf8 0%, #60a5fa 100%);
  top: 35%;
  left: 45%;
  animation: floatOrb 18s ease-in-out infinite alternate;
}

@keyframes floatOrb {
  0% {
    transform: translate(0, 0) scale(1);
  }
  100% {
    transform: translate(60px, 40px) scale(1.05);
  }
}

/* 亮色科技感磨砂玻璃卡片 */
.login-card {
  position: relative;
  width: 420px;
  padding: 44px 36px;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: var(--radius-xl);
  box-shadow: 
    0 10px 30px -10px rgba(0, 0, 0, 0.04),
    0 20px 40px -15px rgba(59, 130, 246, 0.08),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.6);
  z-index: 10;
  transition: transform 0.3s var(--ease-out), border-color 0.3s var(--ease-out), box-shadow 0.3s var(--ease-out);
}

.login-card:hover {
  border-color: rgba(255, 255, 255, 0.95);
  box-shadow: 
    0 12px 35px -10px rgba(0, 0, 0, 0.06),
    0 25px 45px -12px rgba(59, 130, 246, 0.12);
}

.card-header {
  text-align: center;
  margin-bottom: 32px;
}

.logo-text {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: var(--text);
  margin: 0 0 8px 0;
  background: linear-gradient(135deg, var(--text) 40%, var(--primary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.subtitle-text {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.5;
}

/* Tab 切换：契合亮色设计 */
.tab-wrapper {
  position: relative;
  display: flex;
  background: rgba(147, 197, 253, 0.08);
  border: 1px solid rgba(147, 197, 253, 0.15);
  padding: 3px;
  border-radius: var(--radius-md);
  margin-bottom: 28px;
}

.tab-btn {
  position: relative;
  flex: 1;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 13.5px;
  font-weight: 500;
  padding: 8px 0;
  cursor: pointer;
  z-index: 2;
  transition: color 0.3s var(--ease-out);
}

.tab-btn.active {
  color: var(--primary);
  font-weight: 600;
}

.tab-slider {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc(50% - 3px);
  background: #ffffff;
  border-radius: calc(var(--radius-md) - 2px);
  z-index: 1;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
  transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1);
  border: 1px solid rgba(255, 255, 255, 0.8);
}

/* 表单主体 */
.form-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-group label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-secondary);
}

.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.input-wrapper input {
  width: 100%;
  background: #ffffff;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 11px 14px 11px 40px;
  color: var(--text);
  font-size: 13.5px;
  outline: none;
  transition: border-color 0.3s var(--ease-out), box-shadow 0.3s var(--ease-out);
}

.input-wrapper input::placeholder {
  color: #a0aec0;
}

.input-wrapper input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--border-focus);
}

.input-wrapper .icon {
  position: absolute;
  left: 14px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.3s var(--ease-out);
}

.input-wrapper input:focus + .icon {
  color: var(--primary);
}

/* 错误警告框：柔和淡红色磨砂 */
.error-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.15);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  color: var(--error);
  font-size: 12.5px;
  line-height: 1.4;
}

.error-alert svg {
  flex-shrink: 0;
}

/* 提交按钮：采用系统内置的高科技渐变色 */
.submit-btn {
  position: relative;
  background: var(--tech-gradient);
  background-size: 200% 200%;
  animation: moveGradient 8s ease infinite;
  border: none;
  border-radius: var(--radius-md);
  padding: 13px;
  color: #ffffff;
  font-size: 14.5px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  justify-content: center;
  align-items: center;
  box-shadow: 0 6px 20px rgba(59, 130, 246, 0.25);
  transition: transform 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out), opacity 0.2s var(--ease-out);
  margin-top: 8px;
}

@keyframes moveGradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

.submit-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 25px rgba(59, 130, 246, 0.35);
}

.submit-btn:active {
  transform: translateY(1px);
}

.submit-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Toast 弹出框样式：高通透毛玻璃 */
.toast-popup {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: var(--radius-md);
  font-size: 13.5px;
  font-weight: 500;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  z-index: 999;
}

.toast-popup.success {
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.25);
  color: var(--success);
  backdrop-filter: blur(8px);
}

.toast-popup.error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: var(--error);
  backdrop-filter: blur(8px);
}

/* 动画 */
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
