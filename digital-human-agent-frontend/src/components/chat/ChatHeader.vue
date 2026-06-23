<template>
  <header ref="headerEl" class="chat-header">
    <!-- 左侧：侧栏折叠按钮 + 角色选择器 -->
    <div class="header-left">
      <!-- 折叠历史侧栏按钮 -->
      <button
        class="icon-action-btn"
        :class="{ active: sidebarOpen }"
        :title="sidebarOpen ? '隐藏历史侧栏' : '展开历史侧栏'"
        :aria-label="sidebarOpen ? '隐藏历史侧栏' : '展开历史侧栏'"
        @click="$emit('toggle-sidebar')"
      >
        <PanelLeftIcon :size="16" aria-hidden="true" />
      </button>

      <!-- 角色选择下拉触发器 (ChatGPT / Claude 风格) -->
      <div class="persona-switcher">
        <button
          class="persona-trigger"
          type="button"
          aria-haspopup="listbox"
          :aria-expanded="isPopoverOpen"
          @click="togglePopover"
        >
          <div v-if="selectedPersona" class="trigger-avatar">
            {{ selectedPersona.name[0] }}
          </div>
          <div v-else class="trigger-avatar trigger-avatar--empty">
            <BotIcon :size="13" />
          </div>

          <div class="trigger-info">
            <span class="trigger-name">
              {{ selectedPersona?.name ?? '选择知识助手' }}
            </span>
            <span v-if="knowledgeSummaryCompact" class="trigger-sub">
              {{ knowledgeSummaryCompact }}
            </span>
          </div>
          <ChevronDownIcon
            :size="13"
            class="trigger-chevron"
            :class="{ open: isPopoverOpen }"
            aria-hidden="true"
          />
        </button>

        <!-- 角色下拉浮层 -->
        <Transition name="fade-popover">
          <div v-if="isPopoverOpen" class="persona-popover" role="listbox">
            <header class="popover-head">
              <span>知识助手</span>
            </header>

            <div v-if="personaStore.loading" class="popover-loading">
              <span>加载中…</span>
            </div>
            <div v-else-if="personaStore.personas.length === 0" class="popover-empty">
              <span>暂无角色，请先新建</span>
            </div>
            <ul v-else class="popover-list">
              <li
                v-for="p in personaStore.personas"
                :key="p.id"
                class="popover-item"
                :class="{ 'popover-item--active': p.id === personaStore.selectedId }"
                role="option"
                :aria-selected="p.id === personaStore.selectedId"
                @click="selectPersona(p.id)"
              >
                <div class="popover-item__avatar">{{ p.name[0] }}</div>
                <div class="popover-item__info">
                  <strong>{{ p.name }}</strong>
                  <p v-if="p.description" :title="p.description">{{ p.description }}</p>
                </div>
                <button
                  class="popover-item__delete"
                  type="button"
                  aria-label="删除角色"
                  title="删除该知识助手"
                  @click.stop="$emit('delete-persona', p.id)"
                >
                  <Trash2Icon :size="12" />
                </button>
              </li>
            </ul>

            <button class="popover-add-btn" type="button" @click="createPersona">
              <PlusIcon :size="13" />
              <span>新建知识助手</span>
            </button>
          </div>
        </Transition>
      </div>

      <!-- 知识范围 Pill（补充提示） -->
      <span
        v-if="selectedPersona && knowledgeSummaryCompact"
        class="summary-pill"
        :class="summaryClass"
        :title="knowledgeSummary"
      >
        <BookOpenIcon :size="11" aria-hidden="true" />
        <span>{{ knowledgeSummaryCompact }}</span>
      </span>
    </div>

    <!-- 右侧功能按钮组 -->
    <div class="header-actions">
      <button
        class="header-btn"
        :class="knowledgeButtonClass"
        @click="$emit('toggle-knowledge-drawer')"
        :aria-pressed="knowledgeDrawerOpen"
        aria-label="知识范围"
      >
        <BookOpenIcon :size="14" aria-hidden="true" />
        <span>{{ knowledgeButtonLabel }}</span>
      </button>
      <button
        v-if="selectedPersona"
        class="header-btn header-btn--feature"
        :class="{ active: mode === 'digital-human' }"
        :aria-pressed="mode === 'digital-human'"
        :title="mode === 'digital-human' ? '关闭数字人播报，回到标准问答' : '开启数字人播报'"
        @click="$emit('change-mode', mode === 'digital-human' ? 'voice' : 'digital-human')"
      >
        <BotIcon :size="14" aria-hidden="true" />
        <span>{{ mode === 'digital-human' ? '退出数字人' : '数字人模式' }}</span>
      </button>
      <button
        v-if="selectedPersona"
        class="header-btn header-btn--ghost"
        @click="$emit('new-conversation')"
        aria-label="新建对话"
        title="新建对话"
      >
        <PlusSquareIcon :size="14" aria-hidden="true" />
        <span>新对话</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import {
  BookOpenIcon,
  BotIcon,
  ChevronDownIcon,
  PanelLeftIcon,
  PlusIcon,
  PlusSquareIcon,
  Trash2Icon,
} from 'lucide-vue-next'
import { usePersonaStore } from '@/stores/persona'

const props = defineProps({
  sidebarOpen: { type: Boolean, default: true },
  knowledgeDrawerOpen: { type: Boolean, default: false },
  mode: { type: String, default: 'voice' },
  knowledgeSummary: { type: String, default: '' },
  knowledgeSummaryCompact: { type: String, default: '' },
  knowledgeSummaryTone: { type: String, default: 'default' },
})

const emit = defineEmits([
  'toggle-sidebar',
  'toggle-knowledge-drawer',
  'change-mode',
  'new-conversation',
  'select-persona',
  'delete-persona',
  'create-persona',
])

const personaStore = usePersonaStore()
const selectedPersona = computed(() => personaStore.selectedPersona)

// ── Popover 状态 ──────────────────────────────────────────────────────────
const isPopoverOpen = ref(false)
const headerEl = ref<HTMLElement | null>(null)

function togglePopover() {
  isPopoverOpen.value = !isPopoverOpen.value
}

function handleGlobalClick(e: MouseEvent) {
  if (headerEl.value && !headerEl.value.contains(e.target as Node)) {
    isPopoverOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', handleGlobalClick))
onUnmounted(() => document.removeEventListener('click', handleGlobalClick))

// ── 角色操作 ──────────────────────────────────────────────────────────────
function selectPersona(id: string) {
  emit('select-persona', id)
  isPopoverOpen.value = false
}

function createPersona() {
  emit('create-persona')
  isPopoverOpen.value = false
}

// ── 知识库按钮样式 ────────────────────────────────────────────────────────
const knowledgeButtonLabel = computed(() => {
  if (!selectedPersona.value) return '知识范围'
  if (props.knowledgeSummaryTone === 'warning') return '先挂载知识库'
  return '知识范围'
})

const knowledgeButtonClass = computed(() => ({
  active: props.knowledgeDrawerOpen,
  'header-btn--primary': props.knowledgeSummaryTone === 'active' || props.knowledgeDrawerOpen,
  'header-btn--warning': props.knowledgeSummaryTone === 'warning' && !props.knowledgeDrawerOpen,
}))

const summaryClass = computed(() => ({
  'summary-pill--warning': props.knowledgeSummaryTone === 'warning',
  'summary-pill--active': props.knowledgeSummaryTone === 'active',
}))
</script>

<style scoped>
/* ── Header 根容器 ───────────────────────────────────────────────────────── */
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  flex-shrink: 0;
  min-height: 52px;
  position: relative;
}

/* ── 左侧区域 ────────────────────────────────────────────────────────────── */
.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

/* 折叠侧栏图标按钮 */
.icon-action-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.icon-action-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
  border-color: var(--border);
}

.icon-action-btn.active {
  color: var(--primary);
}

/* ── 角色选择器 ──────────────────────────────────────────────────────────── */
.persona-switcher {
  position: relative;
  flex-shrink: 0;
}

.persona-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px 5px 6px;
  border-radius: 10px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  max-width: 260px;
}

.persona-trigger:hover {
  background: #ffffff;
  border-color: rgba(59, 130, 246, 0.35);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.08);
}

.trigger-avatar {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: linear-gradient(135deg, #60a5fa, #2563eb);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.trigger-avatar--empty {
  background: linear-gradient(135deg, #94a3b8, #64748b);
}

.trigger-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0px;
}

.trigger-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}

.trigger-sub {
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trigger-chevron {
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.trigger-chevron.open {
  transform: rotate(180deg);
}

/* ── Popover 浮层 ────────────────────────────────────────────────────────── */
.persona-popover {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 200;
  min-width: 240px;
  max-width: 300px;
  border-radius: 14px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow:
    0 20px 48px rgba(15, 23, 42, 0.14),
    0 4px 16px rgba(15, 23, 42, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
}

.popover-head {
  padding: 6px 8px 2px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  text-transform: uppercase;
}

.popover-loading,
.popover-empty {
  padding: 16px 10px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

.popover-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.popover-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s ease;
  border: 1px solid transparent;
}

.popover-item:hover {
  background: rgba(59, 130, 246, 0.05);
  border-color: rgba(59, 130, 246, 0.1);
}

.popover-item--active {
  background: var(--primary-bg) !important;
  border-color: rgba(191, 219, 254, 0.7) !important;
}

.popover-item__avatar {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: linear-gradient(135deg, #93c5fd, #3b82f6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
}

.popover-item__info {
  flex: 1;
  min-width: 0;
}

.popover-item__info strong {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.popover-item__info p {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
}

.popover-item__delete {
  opacity: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: #fff;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.popover-item:hover .popover-item__delete {
  opacity: 1;
}

.popover-item__delete:hover {
  background: #fef2f2;
  color: var(--error);
  border-color: rgba(239, 68, 68, 0.25);
}

.popover-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  font-family: inherit;
}

.popover-add-btn:hover {
  border-style: solid;
  border-color: var(--primary-muted);
  background: var(--primary-bg);
  color: var(--primary);
}

/* ── 知识 Pill ────────────────────────────────────────────────────────────── */
.summary-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
  max-width: min(28vw, 220px);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.summary-pill span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-pill--active {
  background: var(--primary-bg);
  border-color: rgba(191, 219, 254, 0.9);
  color: var(--primary);
}

.summary-pill--warning {
  background: #fff7ed;
  border-color: rgba(251, 191, 36, 0.34);
  color: #b45309;
}

/* ── 右侧按钮组 ──────────────────────────────────────────────────────────── */
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.header-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 20px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.7);
  color: var(--text-secondary);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s var(--ease-out), box-shadow 0.15s ease;
  font-family: inherit;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  outline: none;
  white-space: nowrap;
}

.header-btn:hover {
  background: #ffffff;
  border-color: rgba(59, 130, 246, 0.4);
  color: var(--primary);
  transform: translateY(-0.5px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.06);
}

.header-btn:active {
  transform: scale(0.97);
}

.header-btn.active {
  background: var(--primary-bg) !important;
  border-color: var(--primary) !important;
  color: var(--primary) !important;
}

.header-btn--primary {
  background: var(--primary-bg);
  border-color: var(--primary-muted);
  color: var(--primary);
}

.header-btn--warning {
  background: #fff7ed;
  border-color: rgba(251, 191, 36, 0.42);
  color: #b45309;
}

.header-btn--warning:hover {
  background: #ffedd5;
  border-color: #f59e0b;
  color: #9a3412;
  transform: translateY(-0.5px);
}

.header-btn--feature {
  color: var(--text-muted);
  border-style: dashed;
}

.header-btn--feature.active {
  border-style: solid !important;
}

.header-btn--ghost {
  color: var(--text-muted);
}

/* ── Popover 过渡动画 ─────────────────────────────────────────────────────── */
.fade-popover-enter-active,
.fade-popover-leave-active {
  transition: opacity 150ms ease, transform 150ms var(--ease-spring);
}

.fade-popover-enter-from,
.fade-popover-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.97);
}

/* ── 响应式 ──────────────────────────────────────────────────────────────── */
@media (max-width: 960px) {
  .chat-header {
    padding: 0 12px;
  }

  .trigger-name {
    max-width: 100px;
  }

  .summary-pill {
    display: none;
  }

  .header-btn {
    padding: 5px 10px;
    font-size: 11px;
  }
}

@media (max-width: 680px) {
  .header-btn span {
    display: none;
  }

  .header-btn {
    padding: 6px 8px;
  }

  .trigger-sub {
    display: none;
  }
}
</style>
