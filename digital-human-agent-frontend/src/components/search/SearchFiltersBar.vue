<template>
  <section class="p-5 bg-white/65 backdrop-blur-md border border-white/50 rounded-xl shadow-btn flex flex-col gap-4" aria-label="搜索栏">
    <div class="grid grid-cols-[1fr_auto] gap-3">
      <label class="relative flex items-center w-full">
        <SearchIcon :size="18" class="absolute left-3.5 text-text-muted" />
        <input
          :value="query"
          type="text"
          class="w-full h-11 pl-10.5 pr-4 border border-border-main rounded-lg text-[14.5px] text-text-main outline-none bg-white focus:border-primary transition-all"
          placeholder="输入您想查找的业务问题或资料关键字进行混合召回测试…"
          :disabled="searching"
          @input="onQueryInput"
          @keydown.enter="$emit('search')"
        />
      </label>
      <button
        class="inline-flex items-center gap-2 px-6 bg-gradient-to-br from-blue-500 to-blue-700 text-white border-none rounded-lg text-sm font-bold cursor-pointer hover:brightness-104 disabled:opacity-60 disabled:cursor-not-allowed"
        type="button"
        :disabled="searching || !query.trim()"
        @click="$emit('search')"
      >
        <SlidersHorizontalIcon v-if="searching" :size="14" class="animate-spin" />
        <span>{{ searching ? '语义重排检索中…' : '进行混合搜索' }}</span>
      </button>
    </div>

    <div class="flex justify-between items-end gap-4 flex-wrap">
      <div class="flex gap-4 flex-wrap">
        <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
          <span>知识库范围</span>
          <select
            :value="selectedKbId"
            class="h-9.5 px-2.5 border border-border-main rounded-lg bg-white text-[13.5px] outline-none focus:border-primary transition-all"
            @change="onKbChange"
          >
            <option value="">全部知识库</option>
            <option v-for="kb in kbs" :key="kb.id" :value="kb.id">{{ kb.name }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
          <span>文件类型</span>
          <select
            :value="fileType"
            class="h-9.5 px-2.5 border border-border-main rounded-lg bg-white text-[13.5px] outline-none focus:border-primary transition-all"
            @change="emit('update:fileType', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">全部类型</option>
            <option value="pdf">PDF</option>
            <option value="docx">Word</option>
            <option value="xlsx">Excel</option>
            <option value="pptx">PPT</option>
            <option value="image">图片</option>
            <option value="audio">音频</option>
            <option value="video">视频</option>
          </select>
        </label>
      </div>
      <button
        class="inline-flex items-center gap-1.5 bg-transparent border border-border-main rounded-lg p-2 px-3.5 text-xs font-bold cursor-pointer hover:bg-slate-50 transition-colors"
        type="button"
        @click="advancedOpen = !advancedOpen"
      >
        <SlidersHorizontalIcon :size="13" />
        <span>高级参数设置</span>
        <ChevronDownIcon :size="12" class="transition-transform duration-200" :class="{ 'rotate-180': advancedOpen }" />
      </button>
    </div>

    <Transition name="slide-fade">
      <div v-if="advancedOpen" class="bg-slate-50 border border-slate-200/60 rounded-lg p-4 flex flex-col gap-3.5">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
          <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
            <span>相似度最低阈值：<strong class="text-text-main">{{ threshold.toFixed(2) }}</strong></span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              :value="threshold"
              @input="emit('update:threshold', Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
            <span>初筛候选 TopK (RRF前)</span>
            <input
              type="number"
              min="1"
              max="50"
              class="h-8 border border-border-main rounded-md px-2.5 bg-white text-xs outline-none focus:border-primary"
              :value="stage1TopK"
              @input="emit('update:stage1TopK', Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
            <span>最终输出限制 TopK</span>
            <input
              type="number"
              min="1"
              max="20"
              class="h-8 border border-border-main rounded-md px-2.5 bg-white text-xs outline-none focus:border-primary"
              :value="finalTopK"
              @input="emit('update:finalTopK', Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <div class="flex flex-col gap-2">
            <label class="flex items-center gap-2 text-xs font-bold text-text-secondary cursor-pointer">
              <input type="checkbox" :checked="rerank" @change="emit('update:rerank', ($event.target as HTMLInputElement).checked)" />
              <span>启用 LlmReranker 重排</span>
            </label>
            <label class="flex items-center gap-2 text-xs font-bold text-text-secondary cursor-pointer">
              <input type="checkbox" :checked="useGraph" @change="emit('update:useGraph', ($event.target as HTMLInputElement).checked)" />
              <span>启用 Neo4j 一跳关联</span>
            </label>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
          <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
            <span>标签</span>
            <input
              type="text"
              placeholder="多个标签用逗号分隔"
              class="h-8 border border-border-main rounded-md px-2.5 bg-white text-xs outline-none focus:border-primary"
              :value="tags"
              @input="emit('update:tags', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
            <span>部门</span>
            <input
              type="text"
              placeholder="例如 财务部"
              class="h-8 border border-border-main rounded-md px-2.5 bg-white text-xs outline-none focus:border-primary"
              :value="department"
              @input="emit('update:department', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
            <span>业务分类</span>
            <input
              type="text"
              placeholder="例如 制度流程"
              class="h-8 border border-border-main rounded-md px-2.5 bg-white text-xs outline-none focus:border-primary"
              :value="businessCategory"
              @input="emit('update:businessCategory', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
            <span>可见范围</span>
            <select
              class="h-8 border border-border-main rounded-md px-2.5 bg-white text-xs outline-none focus:border-primary"
              :value="visibility"
              @change="emit('update:visibility', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">全部范围</option>
              <option value="company">全公司</option>
              <option value="department">本部门</option>
              <option value="private">仅作者</option>
            </select>
          </label>
        </div>
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDownIcon, SearchIcon, SlidersHorizontalIcon } from 'lucide-vue-next'
import type { KnowledgeBase } from '@/types'

defineProps<{
  query: string
  searching: boolean
  kbs: KnowledgeBase[]
  selectedKbId: string
  fileType: string
  threshold: number
  stage1TopK: number
  finalTopK: number
  rerank: boolean
  useGraph: boolean
  tags: string
  department: string
  businessCategory: string
  visibility: string
}>()

const emit = defineEmits<{
  (e: 'update:query', value: string): void
  (e: 'update:selectedKbId', value: string): void
  (e: 'update:fileType', value: string): void
  (e: 'update:threshold', value: number): void
  (e: 'update:stage1TopK', value: number): void
  (e: 'update:finalTopK', value: number): void
  (e: 'update:rerank', value: boolean): void
  (e: 'update:useGraph', value: boolean): void
  (e: 'update:tags', value: string): void
  (e: 'update:department', value: string): void
  (e: 'update:businessCategory', value: string): void
  (e: 'update:visibility', value: string): void
  (e: 'search'): void
  (e: 'kb-changed'): void
}>()

const advancedOpen = ref(false)

function onQueryInput(event: Event) {
  emit('update:query', (event.target as HTMLInputElement).value)
}

function onKbChange(event: Event) {
  emit('update:selectedKbId', (event.target as HTMLSelectElement).value)
  emit('kb-changed')
}
</script>

<style scoped>
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease;
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
