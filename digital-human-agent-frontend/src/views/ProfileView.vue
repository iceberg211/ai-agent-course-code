<template>
  <main class="page">
    <header class="page-head">
      <div>
        <p class="eyebrow">个人中心</p>
        <h1>当前使用身份与权限</h1>
      </div>
    </header>

    <section class="profile-grid">
      <article class="panel user-card">
        <div class="avatar">我</div>
        <div>
          <h2>本地演示用户</h2>
          <p>当前版本沿用 clientId / ownerId 隔离会话，暂未接入完整登录体系。</p>
        </div>
      </article>

      <article class="panel">
        <h2>可用模块</h2>
        <ul class="permission-list">
          <li>首页大盘：查看知识资产统计</li>
          <li>文档管理：查看文档状态与重试索引</li>
          <li>智能搜索：基于知识库查找资料</li>
          <li>AI 问答：发起 RAG 问答与数字人播报</li>
          <li>知识库：维护知识库、文档和检索参数</li>
        </ul>
      </article>

      <article class="panel">
        <h2>近期会话</h2>
        <ul v-if="conversations.length" class="conversation-list">
          <li v-for="item in conversations" :key="item.id">
            <strong>{{ item.lastMessage?.content || '新会话' }}</strong>
            <span>{{ formatDate(item.updatedAt) }}</span>
          </li>
        </ul>
        <p v-else class="empty">暂无会话记录</p>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useProductizedKnowledge } from '@/hooks/useProductizedKnowledge'
import type { ConversationSummary } from '@/types'

const api = useProductizedKnowledge()
const conversations = ref<ConversationSummary[]>([])

onMounted(async () => {
  const res = await api.listConversations({ pageSize: 6 })
  conversations.value = res.items
})

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '-'
}
</script>

<style scoped>
.page {
  height: 100%;
  overflow: auto;
  padding: 28px 24px;
  background: var(--page-bg-accent);
}
.eyebrow {
  margin: 0;
  font-size: 11px;
  font-weight: 800;
  color: var(--primary);
}
h1 {
  margin: 2px 0 0;
  font-size: 24px;
}
.profile-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  margin-top: 22px;
}
.panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 18px;
}
.user-card {
  display: flex;
  align-items: center;
  gap: 16px;
}
.avatar {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--primary-gradient);
  color: #fff;
  font-size: 22px;
  font-weight: 800;
  flex-shrink: 0;
}
h2 {
  margin: 0 0 8px;
  font-size: 17px;
}
p,
li,
.empty {
  color: var(--text-secondary);
}
.permission-list,
.conversation-list {
  display: grid;
  gap: 9px;
  padding-left: 18px;
}
.conversation-list {
  list-style: none;
  padding-left: 0;
}
.conversation-list li {
  display: grid;
  gap: 3px;
  padding: 10px;
  border: 1px solid var(--border-muted);
  border-radius: 8px;
}
.conversation-list strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conversation-list span,
.empty {
  color: var(--text-muted);
  font-size: 12px;
}
@media (max-width: 860px) {
  .profile-grid {
    grid-template-columns: 1fr;
  }
}
</style>
