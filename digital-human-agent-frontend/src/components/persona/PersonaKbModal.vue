<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal" role="dialog" aria-label="管理知识库挂载">
      <header class="modal__head">
        <h3>知识库挂载 · {{ personaName }}</h3>
        <button class="close-btn" @click="$emit('close')" aria-label="关闭">
          <XIcon :size="16" />
        </button>
      </header>

      <section class="section">
        <h4 class="section__title">
          <LinkIcon :size="13" />
          已挂载
          <span class="badge">{{ mounted.length }}</span>
        </h4>

        <div v-if="loadingMounted" class="muted">加载中…</div>
        <div v-else-if="mounted.length === 0" class="empty">尚未挂载任何知识库</div>
        <ul v-else class="kb-list" role="list">
          <li v-for="kb in mounted" :key="kb.id" class="kb-item">
            <BookOpenIcon :size="14" class="kb-item__icon" />
            <span class="kb-item__name">{{ kb.name }}</span>
            <span v-if="kb.description" class="kb-item__desc">{{ kb.description }}</span>
            <button
              class="btn-detach"
              :disabled="actingKbId === kb.id"
              @click="detach(kb.id)"
              :aria-label="`解除挂载 ${kb.name}`"
            >
              {{ actingKbId === kb.id ? '…' : '解除' }}
            </button>
          </li>
        </ul>
      </section>

      <section class="section">
        <h4 class="section__title">
          <PlusCircleIcon :size="13" />
          可挂载（全局知识库）
        </h4>

        <div v-if="loadingAll" class="muted">加载中…</div>
        <div v-else-if="attachable.length === 0" class="empty">
          {{ allKbs.length === 0 ? '还没有知识库，去知识库工作区新建' : '所有知识库已全部挂载' }}
        </div>
        <ul v-else class="kb-list" role="list">
          <li v-for="kb in attachable" :key="kb.id" class="kb-item">
            <BookOpenIcon :size="14" class="kb-item__icon" />
            <span class="kb-item__name">{{ kb.name }}</span>
            <span v-if="kb.description" class="kb-item__desc">{{ kb.description }}</span>
            <button
              class="btn-attach"
              :disabled="actingKbId === kb.id"
              @click="attach(kb.id)"
              :aria-label="`挂载 ${kb.name}`"
            >
              {{ actingKbId === kb.id ? '…' : '挂载' }}
            </button>
          </li>
        </ul>
      </section>

      <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BookOpenIcon, LinkIcon, PlusCircleIcon, XIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '../../hooks/useKnowledgeBase'
import type { KnowledgeBase } from '../../types'

const props = defineProps<{
  personaId: string
  personaName: string
}>()

defineEmits<{ (e: 'close'): void }>()

const hook = useKnowledgeBase()

const mounted = ref<KnowledgeBase[]>([])
const allKbs = ref<KnowledgeBase[]>([])
const loadingMounted = ref(false)
const loadingAll = ref(false)
const actingKbId = ref<string | null>(null)
const errorMsg = ref('')

const mountedIds = computed(() => new Set(mounted.value.map((kb) => kb.id)))

const attachable = computed(() =>
  allKbs.value.filter((kb) => !mountedIds.value.has(kb.id)),
)

async function refresh() {
  loadingMounted.value = true
  loadingAll.value = true
  errorMsg.value = ''
  try {
    const [mountedList, allList] = await Promise.all([
      hook.listKbsForPersona(props.personaId),
      hook.listAll(),
    ])
    mounted.value = mountedList
    allKbs.value = allList
  } finally {
    loadingMounted.value = false
    loadingAll.value = false
  }
}

onMounted(refresh)

async function attach(kbId: string) {
  actingKbId.value = kbId
  errorMsg.value = ''
  try {
    const ok = await hook.attachToPersona(props.personaId, kbId)
    if (!ok) {
      errorMsg.value = '挂载失败，请稍后重试'
      return
    }
    await refresh()
  } finally {
    actingKbId.value = null
  }
}

async function detach(kbId: string) {
  actingKbId.value = kbId
  errorMsg.value = ''
  try {
    const ok = await hook.detachFromPersona(props.personaId, kbId)
    if (!ok) {
      errorMsg.value = '解除挂载失败，请稍后重试'
      return
    }
    await refresh()
  } finally {
    actingKbId.value = null
  }
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal {
  width: min(560px, 94vw);
  max-height: 80vh;
  background: var(--surface);
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.24);
  overflow-y: auto;
}

.modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal__head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.close-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 150ms, color 150ms;
}
.close-btn:hover {
  background: var(--primary-bg);
  color: var(--text);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section__title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.badge {
  padding: 1px 7px;
  border-radius: 10px;
  background: var(--primary-bg);
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
}

.muted,
.empty {
  font-size: 12px;
  color: var(--text-muted);
  padding: 8px 0;
}

.kb-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.kb-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fafafa;
}

.kb-item__icon {
  color: var(--primary);
  flex-shrink: 0;
}

.kb-item__name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kb-item__desc {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  grid-column: 2;
  margin-top: -4px;
}

.btn-attach,
.btn-detach {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  grid-column: 3;
  white-space: nowrap;
}

.btn-attach {
  background: var(--primary-bg);
  color: var(--primary);
  border-color: var(--primary-muted);
}
.btn-attach:hover:not(:disabled) {
  background: var(--primary);
  color: #fff;
}

.btn-detach {
  background: transparent;
  color: var(--text-muted);
  border-color: var(--border);
}
.btn-detach:hover:not(:disabled) {
  background: #fef2f2;
  color: var(--error);
  border-color: var(--error);
}

.btn-attach:disabled,
.btn-detach:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--error);
}
</style>
