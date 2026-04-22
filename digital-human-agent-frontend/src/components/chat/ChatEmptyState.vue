<template>
  <section class="chat-empty" :class="`chat-empty--${tone}`" aria-label="问答引导">
    <div class="chat-empty__icon" aria-hidden="true">
      <component :is="iconComponent" :size="26" />
    </div>

    <div class="chat-empty__copy">
      <p class="chat-empty__eyebrow">{{ eyebrow }}</p>
      <h2>{{ title }}</h2>
      <p class="chat-empty__desc">{{ description }}</p>

      <ul v-if="steps.length" class="chat-empty__steps" role="list">
        <li v-for="(step, index) in steps" :key="`${index}-${step}`" class="chat-empty__step">
          <span class="chat-empty__step-index">{{ index + 1 }}</span>
          <span>{{ step }}</span>
        </li>
      </ul>

      <div v-if="capabilities.length" class="chat-empty__caps" aria-label="可用能力">
        <span
          v-for="capability in capabilities"
          :key="capability"
          class="chat-empty__cap"
        >
          {{ capability }}
        </span>
      </div>
    </div>

    <div
      v-if="primaryActionLabel || secondaryActionLabel"
      class="chat-empty__actions"
    >
      <button
        v-if="primaryActionLabel"
        class="chat-empty__btn chat-empty__btn--primary"
        type="button"
        @click="$emit('primary-action')"
      >
        {{ primaryActionLabel }}
      </button>
      <button
        v-if="secondaryActionLabel"
        class="chat-empty__btn"
        type="button"
        @click="$emit('secondary-action')"
      >
        {{ secondaryActionLabel }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  BotIcon,
  BookOpenTextIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  eyebrow: string
  title: string
  description: string
  tone?: 'default' | 'warning' | 'success'
  steps?: string[]
  capabilities?: string[]
  primaryActionLabel?: string
  secondaryActionLabel?: string
}>(), {
  tone: 'default',
  steps: () => [],
  capabilities: () => [],
  primaryActionLabel: '',
  secondaryActionLabel: '',
})

defineEmits<{
  (e: 'primary-action'): void
  (e: 'secondary-action'): void
}>()

const iconComponent = computed(() => {
  if (props.tone === 'warning') return TriangleAlertIcon
  if (props.tone === 'success') return SparklesIcon
  if (props.steps.length > 0) return BookOpenTextIcon
  return BotIcon
})
</script>

<style scoped>
.chat-empty {
  flex: 1;
  min-height: 0;
  margin: 12px 16px 0;
  padding: 22px 24px;
  border-radius: 22px;
  border: 1px solid var(--border);
  background:
    radial-gradient(circle at top right, rgba(191, 219, 254, 0.22), transparent 28%),
    linear-gradient(180deg, #ffffff, #f7fbff);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 18px;
  box-shadow: var(--shadow-xs);
}

.chat-empty--warning {
  border-color: rgba(245, 158, 11, 0.22);
  background:
    radial-gradient(circle at top right, rgba(251, 191, 36, 0.18), transparent 30%),
    linear-gradient(180deg, #fffef8, #fffaf0);
}

.chat-empty--success {
  border-color: rgba(59, 130, 246, 0.22);
  background:
    radial-gradient(circle at top right, rgba(96, 165, 250, 0.22), transparent 32%),
    linear-gradient(180deg, #ffffff, #f4faff);
}

.chat-empty__icon {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--primary);
  background: rgba(239, 246, 255, 0.92);
  border: 1px solid rgba(191, 219, 254, 0.9);
  box-shadow: 0 10px 24px rgba(37, 99, 235, 0.08);
}

.chat-empty--warning .chat-empty__icon {
  color: #d97706;
  background: rgba(255, 247, 237, 0.96);
  border-color: rgba(253, 186, 116, 0.92);
  box-shadow: 0 10px 24px rgba(217, 119, 6, 0.08);
}

.chat-empty__copy {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 720px;
}

.chat-empty__eyebrow {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.chat-empty__copy h2 {
  margin: 0;
  font-size: clamp(24px, 3.3vw, 30px);
  line-height: 1.2;
  letter-spacing: -0.03em;
  color: var(--text);
}

.chat-empty__desc {
  margin: 0;
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-secondary);
}

.chat-empty__steps {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  padding: 0;
  margin: 6px 0 0;
}

.chat-empty__step {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(248, 250, 252, 0.92);
  border: 1px solid rgba(226, 232, 240, 0.86);
  color: var(--text-secondary);
  font-size: 13px;
}

.chat-empty__step-index {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--primary-bg);
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
}

.chat-empty__caps {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chat-empty__cap {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(239, 246, 255, 0.9);
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
}

.chat-empty__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.chat-empty__btn {
  min-height: 40px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease;
}

.chat-empty__btn:hover {
  background: var(--primary-bg);
  color: var(--primary);
  border-color: var(--primary-muted);
}

.chat-empty__btn--primary {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
  box-shadow: var(--shadow-btn);
}

.chat-empty__btn--primary:hover {
  background: var(--primary-hover);
  color: #fff;
  border-color: var(--primary-hover);
}

@media (max-width: 720px) {
  .chat-empty {
    margin: 10px 12px 0;
    padding: 18px;
  }

  .chat-empty__copy h2 {
    font-size: 22px;
  }

  .chat-empty__steps {
    grid-template-columns: 1fr;
  }

  .chat-empty__actions {
    flex-direction: column;
  }

  .chat-empty__btn {
    width: 100%;
  }
}
</style>
