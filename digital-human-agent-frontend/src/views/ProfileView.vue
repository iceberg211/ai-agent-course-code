<template>
  <main class="profile">
    <header class="page-head">
      <div>
        <h2>个人中心</h2>
        <p class="subtitle">管理您的个人访问凭证、修改密码与系统配置</p>
      </div>
    </header>

    <div class="profile-layout">
      <!-- 个人名片 -->
      <section class="profile-card" aria-label="个人信息">
        <div class="profile-card__avatar">
          <span>{{ initial }}</span>
        </div>
        <div class="profile-card__info">
          <h3>{{ username }}</h3>
          <p class="role-badge">企业知识管理员</p>
          <span class="meta-desc">所属系统角色：RAG & 数字人代理管理员</span>
        </div>
      </section>

      <!-- 系统设置组：凭证显示 -->
      <section class="settings-block">
        <div class="block-title">
          <h4>数据访问凭证</h4>
          <p>这些凭证用于在后端物理隔离您的私有知识库与聊天记录。</p>
        </div>

        <div class="field-row">
          <div class="field-item">
            <span class="label">当前访问用户标识 (Owner ID)</span>
            <div class="input-display">
              <code>{{ ownerId }}</code>
              <button class="btn-copy" type="button" @click="copyId">复制</button>
            </div>
          </div>
        </div>

        <div class="field-row">
          <div class="field-item">
            <span class="label">数据隔离级别</span>
            <div class="input-display readonly-select">
              <strong>租户独立隔离 (Client Isolation)</strong>
            </div>
          </div>
        </div>
      </section>

      <!-- 修改密码模块 -->
      <section class="settings-block">
        <div class="block-title">
          <h4>修改账户密码</h4>
          <p>定期修改密码有利于保障您的账户及知识数据安全。</p>
        </div>

        <form class="password-form" @submit.prevent="handleChangePassword">
          <div class="form-field">
            <label for="oldPassword">当前旧密码</label>
            <input
              id="oldPassword"
              v-model="passwordForm.oldPassword"
              type="password"
              placeholder="请输入旧密码"
              required
            />
          </div>

          <div class="form-field">
            <label for="newPassword">新密码</label>
            <input
              id="newPassword"
              v-model="passwordForm.newPassword"
              type="password"
              placeholder="请输入新密码（至少 6 位）"
              required
            />
          </div>

          <div class="form-field">
            <label for="confirmPassword">确认新密码</label>
            <input
              id="confirmPassword"
              v-model="passwordForm.confirmPassword"
              type="password"
              placeholder="请再次输入新密码"
              required
            />
          </div>

          <!-- 报错提示区 -->
          <Transition name="fade-alert">
            <div v-if="errorMsg" class="error-text-alert">
              {{ errorMsg }}
            </div>
          </Transition>

          <button class="btn-primary" type="submit" :disabled="loading">
            <KeyRoundIcon :size="14" />
            {{ loading ? '正在提交...' : '确认修改密码' }}
          </button>
        </form>
      </section>

      <!-- 危险与管理区域：包含清除缓存与退出登录 -->
      <section class="settings-block danger-zone">
        <div class="block-title">
          <h4>敏感数据与账户安全</h4>
          <p>清空本地配置或安全退出当前系统。</p>
        </div>

        <div class="action-grid">
          <div class="action-item">
            <button class="btn-danger" type="button" @click="resetLocalCache">
              <Trash2Icon :size="14" />
              清除浏览器本地缓存
            </button>
            <p class="action-desc">重置浏览器中临时保存的 RAG 检索草稿和数字人本地配置参数。</p>
          </div>

          <div class="action-item border-top">
            <button class="btn-warning" type="button" @click="handleLogout">
              <LogOutIcon :size="14" />
              安全退出登录
            </button>
            <p class="action-desc">退出并清空当前用户的访问状态，返回至系统登录页。</p>
          </div>
        </div>
      </section>
    </div>

    <!-- 弹窗 Toast -->
    <Transition name="toast-slide">
      <div v-if="toastMsg" class="toast-popup">
        {{ toastMsg }}
      </div>
    </Transition>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Trash2Icon, LogOutIcon, KeyRoundIcon } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const loading = ref(false)
const errorMsg = ref('')
const toastMsg = ref('')

const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const initial = computed(() => {
  const name = authStore.user?.username || '管'
  return name.slice(0, 1).toUpperCase()
})

const username = computed(() => authStore.user?.username || '企业管理员')
const ownerId = computed(() => authStore.user?.id || '无凭证')

function showToast(msg: string) {
  toastMsg.value = msg
  setTimeout(() => {
    toastMsg.value = ''
  }, 2500)
}

function copyId() {
  if (!ownerId.value || ownerId.value === '无凭证') return
  navigator.clipboard.writeText(ownerId.value)
  showToast('用户凭证已成功复制到剪贴板。')
}

function resetLocalCache() {
  if (!confirm('确定清空本地缓存吗？这会清除您本地保存的 RAG 检索草稿。')) return
  localStorage.removeItem('__draft_rag_search')
  localStorage.removeItem('vuex')
  showToast('本地临时缓存已成功清除。')
}

async function handleChangePassword() {
  const oldPwd = passwordForm.oldPassword.trim()
  const newPwd = passwordForm.newPassword.trim()
  const confirmPwd = passwordForm.confirmPassword.trim()

  if (newPwd.length < 6) {
    errorMsg.value = '新密码长度至少为 6 位'
    return
  }

  if (newPwd !== confirmPwd) {
    errorMsg.value = '两次输入的新密码不一致'
    return
  }

  errorMsg.value = ''
  loading.value = true

  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        oldPassword: oldPwd,
        newPassword: newPwd,
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      errorMsg.value = data.message || '修改失败，请检查旧密码是否正确'
      return
    }

    showToast('密码修改成功！请使用新密码重新登录')
    setTimeout(() => {
      authStore.logout()
      router.push('/login')
    }, 1800)
  } catch (e) {
    errorMsg.value = '网络错误，请稍后再试'
  } finally {
    loading.value = false
  }
}

function handleLogout() {
  if (!confirm('确定退出当前登录吗？')) return
  authStore.logout()
  router.push('/login')
}
</script>

<style scoped>
.profile {
  padding: 32px 24px;
  height: 100%;
  overflow-y: auto;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-head h2 {
  margin: 0 0 4px;
  font-size: 24px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.02em;
}

.subtitle {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.profile-layout {
  max-width: 680px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.profile-card {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 24px;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg, 12px);
  box-shadow: 
    0 4px 20px rgba(15, 23, 42, 0.02),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

.profile-card__avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--tech-gradient, linear-gradient(135deg, #60a5fa, #2563eb));
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 24px;
  font-weight: 800;
  box-shadow: 0 8px 24px rgba(37, 99, 235, 0.15);
}

.profile-card__info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-card__info h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
}

.role-badge {
  display: inline-block;
  align-self: flex-start;
  padding: 2px 8px;
  background: var(--primary-bg, #eff6ff);
  color: var(--primary, #2563eb);
  font-size: 10.5px;
  font-weight: 700;
  border-radius: 6px;
  margin: 2px 0;
}

.meta-desc {
  font-size: 12px;
  color: var(--text-muted);
}

.settings-block {
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg, 12px);
  padding: 24px;
  box-shadow: 
    0 4px 20px rgba(15, 23, 42, 0.02),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.block-title h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 750;
  color: var(--text);
}

.block-title p {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.5;
}

.field-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-item .label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.input-display {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f8fafc;
}

.input-display code {
  font-family: monospace;
  font-size: 12.5px;
  color: var(--text);
}

.btn-copy {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--text-secondary);
  cursor: pointer;
}

.btn-copy:hover {
  background: #ffffff;
  color: var(--primary);
  border-color: var(--primary-muted);
}

.readonly-select {
  background: #f8fafc;
  font-size: 13px;
  color: var(--text-secondary);
}

.readonly-select strong {
  font-weight: 600;
}

/* 修改密码表单 */
.password-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
}

.form-field input {
  height: 42px;
  padding: 0 12px;
  background: #ffffff;
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  font-size: 13px;
  color: var(--text);
  transition: all 0.2s var(--ease-out);
}

.form-field input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--border-focus);
}

.error-text-alert {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.15);
  color: var(--error);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 42px;
  background: var(--tech-gradient);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);
  transition: all 0.2s ease;
}

.btn-primary:hover {
  filter: brightness(1.04);
  transform: translateY(-0.5px);
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.3);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

/* 危险区与登出 */
.danger-zone {
  border-color: #fecaca;
  background: rgba(254, 242, 242, 0.5); /* 极淡红底 */
}

.danger-zone h4 {
  color: var(--error, #dc2626);
}

.action-grid {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.action-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.border-top {
  border-top: 1px solid rgba(239, 68, 68, 0.1);
  padding-top: 20px;
}

.btn-danger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  background: var(--error, #dc2626);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(220, 38, 38, 0.1);
  transition: all 0.2s ease;
}

.btn-danger:hover {
  filter: brightness(1.08);
}

.btn-warning {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  background: var(--warning, #d97706);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(217, 119, 6, 0.1);
  transition: all 0.2s ease;
}

.btn-warning:hover {
  filter: brightness(1.08);
}

.action-desc {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.5;
}

/* Toast */
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
  background: rgba(15, 23, 42, 0.85);
  color: #ffffff;
  backdrop-filter: blur(8px);
  z-index: 999;
}

/* 动画过渡类 */
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
