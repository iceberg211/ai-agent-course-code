<template>
  <article
    class="kb-card"
    @click="$emit('open', kb.id)"
    role="button"
    tabindex="0"
    @keydown.enter="$emit('open', kb.id)"
  >
    <div class="kb-card__head">
      <BookOpenIcon :size="18" color="var(--primary)" aria-hidden="true" />
      <h3 class="kb-card__name">{{ kb.name }}</h3>
    </div>
    <p v-if="kb.description" class="kb-card__desc">{{ kb.description }}</p>
    <footer class="kb-card__footer">
      <span class="kb-card__meta">{{
        modeLabel(kb.retrievalConfig.retrievalMode)
      }}</span>
      <span class="kb-card__meta"
        >threshold {{ kb.retrievalConfig.threshold }}</span
      >
      <span class="kb-card__meta"
        >vector {{ kb.retrievalConfig.vectorTopK }}</span
      >
      <span class="kb-card__meta"
        >final {{ kb.retrievalConfig.finalTopK }}</span
      >
      <span v-if="kb.retrievalConfig.rerank" class="kb-card__tag">rerank</span>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { BookOpenIcon } from 'lucide-vue-next'
import type { KnowledgeBase } from '../../types'

defineProps<{ kb: KnowledgeBase }>()
defineEmits<{ (e: 'open', kbId: string): void }>()

function modeLabel(mode: KnowledgeBase['retrievalConfig']['retrievalMode']) {
  const labels = {
    vector: '向量',
    keyword: '关键词',
    hybrid: '混合',
  }
  return labels[mode] ?? labels.vector
}
</script>

<style scoped>
.kb-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  cursor: pointer;
  transition:
    border-color 150ms,
    transform 150ms,
    box-shadow 150ms;
}
.kb-card:hover {
  border-color: var(--primary);
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(124, 58, 237, 0.08);
}
.kb-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.kb-card__name {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.kb-card__desc {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.kb-card__footer {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-muted);
}
.kb-card__meta {
  font-variant-numeric: tabular-nums;
}
.kb-card__tag {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--primary-bg);
  color: var(--primary);
  font-weight: 600;
}
</style>
