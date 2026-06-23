<template>
  <main class="profile">
    <header class="page-head">
      <div>
        <h2>个人中心</h2>
        <p class="subtitle">管理您的个人访问凭证与系统配置</p>
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
          <span class="meta-desc">所属部门：技术研发部 / 前端工程组</span>
        </div>
      </section>

      <!-- 系统设置组 -->
      <section class="settings-block">
        <div class="block-title">
          <h4>数据访问凭证</h4>
          <p>这些凭证用于在后端隔离您的私有知识库与聊天记录。</p>
        </div>

        <div class="field-row">
          <div class="field-item">
            <span class="label">当前访问用户标识 (Owner ID)</span>
            <div class="input-display">
              <code>{{ ownerId || '无凭证' }}</code>
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

      <!-- 危险区域 -->
      <section class="settings-block danger-zone">
        <div class="block-title">
          <h4>敏感数据管理</h4>
          <p>清空本地配置或历史调试缓存。此操作不影响云端已建档数据。</p>
        </div>

        <div class="action-row">
          <button class="btn-danger" type="button" @click="resetLocalCache">
            <Trash2Icon :size="14" />
            清除浏览器本地缓存
          </button>
          <p class="action-desc">将重置浏览器中临时保存的 RAG 检索草稿和数字人本地配置参数。</p>
        </div>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Trash2Icon } from 'lucide-vue-next'

const ownerId = ref('')
const username = ref('管理员')
const initial = ref('管')

onMounted(() => {
  ownerId.value = localStorage.getItem('__client_owner_id') || 'owner-default-admin'
})

function copyId() {
  if (!ownerId.value) return
  navigator.clipboard.writeText(ownerId.value)
  alert('用户标识已复制到剪贴板。')
}

function resetLocalCache() {
  if (!confirm('确定清空本地缓存吗？这会清除您本地保存的 RAG 检索草稿。')) return
  localStorage.removeItem('__draft_rag_search')
  localStorage.removeItem('vuex') // 或者是其他状态库缓存
  alert('本地临时缓存已成功清除。')
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

/* 危险区 */
.danger-zone {
  border-color: #fecaca;
  background: #fffb/fb; /* 浅红底 */
}

.danger-zone h4 {
  color: var(--error, #dc2626);
}

.action-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.btn-danger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--error, #dc2626);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(220, 38, 38, 0.1);
  transition: all 0.2s ease;
}

.btn-danger:hover {
  filter: brightness(1.06);
  transform: translateY(-0.5px);
}

.action-desc {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.5;
}
</style>
