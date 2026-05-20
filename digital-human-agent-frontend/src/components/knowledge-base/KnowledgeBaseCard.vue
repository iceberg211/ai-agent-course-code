<template>
  <button class="kb-card" type="button" @click="$emit('open', kb.id)">
    <div class="kb-card__head">
      <BookOpenIcon :size="18" color="var(--primary)" aria-hidden="true" />
      <h3 class="kb-card__name">{{ kb.name }}</h3>
    </div>
    <p v-if="kb.description" class="kb-card__desc">{{ kb.description }}</p>
    <footer class="kb-card__footer">
      <span class="kb-card__meta">threshold {{ kb.retrievalConfig.threshold }}</span>
      <span class="kb-card__meta">topK {{ kb.retrievalConfig.finalTopK }}</span>
      <span v-if="kb.retrievalConfig.rerank" class="kb-card__tag">rerank</span>
    </footer>
  </button>
</template>

<script setup lang="ts">
import { BookOpenIcon } from 'lucide-vue-next'
import type { KnowledgeBase } from '@/types'

defineProps<{ kb: KnowledgeBase }>()
defineEmits<{ (e: 'open', kbId: string): void }>()
</script>

<style scoped>
.kb-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  padding: 20px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: var(--radius-lg);
  background: var(--surface);
  cursor: pointer;
  text-align: left;
  font: inherit;
  appearance: none;
  transition: all 0.25s var(--ease-out);
}
.kb-card:hover {
  border-color: var(--primary-light);
  transform: translateY(-2px);
  box-shadow: 
    0 14px 30px rgba(59, 130, 246, 0.08),
    0 4px 12px rgba(59, 130, 246, 0.04);
}
.kb-card:focus-visible {
  border-color: var(--primary);
  box-shadow:
    0 0 0 3px rgba(37, 99, 235, 0.12),
    0 14px 30px rgba(59, 130, 246, 0.08);
}
.kb-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.kb-card__name {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}
.kb-card__desc {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.kb-card__footer {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
}
.kb-card__meta { 
  font-variant-numeric: tabular-nums; 
  background: var(--surface-soft);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(226, 232, 240, 0.5);
}
.kb-card__tag {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: rgba(59, 130, 246, 0.08);
  color: var(--primary);
  font-weight: 700;
  border: 1px solid rgba(59, 130, 246, 0.12);
}
</style>
