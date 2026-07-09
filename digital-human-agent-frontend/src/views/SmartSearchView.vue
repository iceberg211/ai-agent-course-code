<template>
  <main class="p-6 h-full overflow-y-auto bg-transparent flex flex-col gap-5 w-full text-left box-border">
    <PageHeader
      eyebrow="智能使用"
      title="智能搜索"
      description="查找证据、查看多路召回、RRF 融合、Rerank 排序和权限过滤过程。"
    />

    <!-- 搜索与筛选中心 -->
    <section class="p-5 bg-white/65 backdrop-blur-md border border-white/50 rounded-xl shadow-btn flex flex-col gap-4" aria-label="搜索栏">
      <div class="grid grid-cols-[1fr_auto] gap-3">
        <label class="relative flex items-center w-full">
          <SearchIcon :size="18" class="absolute left-3.5 text-text-muted" />
          <input
            v-model="query"
            type="text"
            class="w-full h-11 pl-10.5 pr-4 border border-border-main rounded-lg text-[14.5px] text-text-main outline-none bg-white focus:border-primary transition-all"
            placeholder="输入您想查找的业务问题或资料关键字进行混合召回测试…"
            :disabled="kbApi.searching.value"
            @keydown.enter="runSearch"
          />
        </label>
        <button
          class="inline-flex items-center gap-2 px-6 bg-gradient-to-br from-blue-500 to-blue-700 text-white border-none rounded-lg text-sm font-bold cursor-pointer hover:brightness-104 disabled:opacity-60 disabled:cursor-not-allowed"
          type="button"
          :disabled="kbApi.searching.value || !query.trim()"
          @click="runSearch"
        >
          <SlidersHorizontalIcon :size="14" class="animate-spin" v-if="kbApi.searching.value" />
          <span>{{ kbApi.searching.value ? '语义重排检索中…' : '进行混合搜索' }}</span>
        </button>
      </div>

      <div class="flex justify-between items-end gap-4 flex-wrap">
        <div class="flex gap-4">
          <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
            <span>知识库范围</span>
            <select v-model="selectedKbId" class="h-9.5 px-2.5 border border-border-main rounded-lg bg-white text-[13.5px] outline-none focus:border-primary transition-all" @change="onKbChanged">
              <option value="">全部知识库</option>
              <option v-for="kb in kbs" :key="kb.id" :value="kb.id">
                {{ kb.name }}
              </option>
            </select>
          </label>

          <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
            <span>文件类型</span>
            <select v-model="fileType" class="h-9.5 px-2.5 border border-border-main rounded-lg bg-white text-[13.5px] outline-none focus:border-primary transition-all">
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

        <!-- 高级检索参数折叠 -->
        <div>
          <button class="inline-flex items-center gap-1.5 bg-transparent border border-border-main rounded-lg p-2 px-3.5 text-xs font-bold cursor-pointer hover:bg-slate-50 transition-colors" type="button" @click="advancedOpen = !advancedOpen">
            <SlidersHorizontalIcon :size="13" />
            <span>高级参数设置</span>
            <ChevronDownIcon :size="12" class="transition-transform duration-200" :class="{ 'rotate-180': advancedOpen }" />
          </button>
        </div>
      </div>

      <!-- 折叠的高级配置 -->
      <Transition name="slide-fade">
        <div v-if="advancedOpen" class="bg-slate-50 border border-slate-200/60 rounded-lg p-4 flex flex-col gap-3.5">
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
            <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
              <span>相似度最低阈值：<strong class="text-text-main">{{ threshold.toFixed(2) }}</strong></span>
              <input v-model.number="threshold" type="range" min="0" max="1" step="0.05" />
            </label>

            <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
              <span>初筛候选 TopK (RRF前)</span>
              <input v-model.number="stage1TopK" type="number" min="1" max="50" class="h-8 border border-border-main rounded-md px-2.5 bg-white text-xs outline-none focus:border-primary transition-all" />
            </label>

            <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
              <span>最终输出限制 TopK</span>
              <input v-model.number="finalTopK" type="number" min="1" max="20" class="h-8 border border-border-main rounded-md px-2.5 bg-white text-xs outline-none focus:border-primary transition-all" />
            </label>

            <div class="flex flex-col gap-2">
              <label class="flex items-center gap-2 text-xs font-bold text-text-secondary cursor-pointer">
                <input v-model="rerank" type="checkbox" />
                <span>启用 LlmReranker 重排</span>
              </label>
              <label class="flex items-center gap-2 text-xs font-bold text-text-secondary cursor-pointer">
                <input v-model="useGraph" type="checkbox" />
                <span>启用 Neo4j 一跳关联</span>
              </label>
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
            <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
              <span>标签</span>
              <input v-model="tags" type="text" placeholder="多个标签用逗号分隔" class="h-8 border border-border-main rounded-md px-2.5 bg-white text-xs outline-none focus:border-primary transition-all" />
            </label>
            <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
              <span>部门</span>
              <input v-model="department" type="text" placeholder="例如 财务部" class="h-8 border border-border-main rounded-md px-2.5 bg-white text-xs outline-none focus:border-primary transition-all" />
            </label>
            <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
              <span>业务分类</span>
              <input v-model="businessCategory" type="text" placeholder="例如 制度流程" class="h-8 border border-border-main rounded-md px-2.5 bg-white text-xs outline-none focus:border-primary transition-all" />
            </label>
            <label class="flex flex-col gap-1.5 text-xs text-text-secondary">
              <span>可见范围</span>
              <select v-model="visibility" class="h-8 border border-border-main rounded-md px-2.5 bg-white text-xs outline-none focus:border-primary transition-all">
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

    <!-- 结果展示面板 -->
    <section class="flex-1 bg-white border border-border-main rounded-xl overflow-hidden min-h-[600px]">
      <div v-if="kbApi.searching.value" class="flex flex-col items-center justify-center p-16 text-center text-text-muted gap-3 h-full">
        <div class="w-7 h-7 border-3 border-blue-500/20 border-t-primary rounded-full animate-spin"></div>
        <p>正在进行向量计算、全文融合、一跳图谱邻域搜索与语义重排过滤…</p>
      </div>

      <div v-else-if="!searched" class="flex flex-col items-center justify-center p-16 text-center text-text-muted gap-3 h-full">
        <SearchIcon :size="32" class="text-slate-500/20" />
        <p>在上方选择测试知识库并提问，右侧将呈现完整的合流 Trace 与权限过滤统计。</p>
      </div>

      <div v-else-if="results.length === 0" class="flex flex-col items-center justify-center p-16 text-center text-text-muted gap-3 h-full">
        <AlertCircleIcon :size="32" class="text-red-500/40" />
        <p>未检索到满足条件的可用分片，或所持账户在 ACL 过滤器中无访问权限。</p>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-[280px_1fr_300px] h-[600px] text-left">
        <!-- 1. 左侧列表：匹配片段清单 -->
        <div class="border-r border-slate-200/50 flex flex-col overflow-hidden text-left">
          <header class="p-3.5 border-b border-slate-200/50 flex justify-between items-center text-[11.5px] font-bold text-text-muted">
            <span>找到 {{ results.length }} 条匹配片段</span>
            <span class="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold" :class="rerank ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-700'">{{ rerank ? 'Rerank 已重排' : 'RRF 原始输出' }}</span>
          </header>

          <ul class="list-none p-0 m-0 flex-1 overflow-y-auto">
            <li
              v-for="(c, idx) in results"
              :key="c.id"
              class="p-3.5 border-b border-slate-200/40 cursor-pointer flex gap-2.5 hover:bg-slate-50/50"
              :class="activeChunk?.id === c.id ? '!bg-primary-bg !text-primary' : ''"
              @click="activeChunk = c"
            >
              <span class="bg-slate-100 w-5 h-5 rounded-full inline-flex items-center justify-center text-[11px] font-bold text-text-secondary shrink-0" :class="activeChunk?.id === c.id ? '!bg-primary !text-white' : ''">{{ idx + 1 }}</span>
              <div class="flex-1 flex flex-col gap-1 min-w-0">
                <strong class="text-[13px] font-bold text-text-main line-clamp-1" :title="c.source">{{ c.source }}</strong>
                <span class="text-[11px] text-text-muted">
                  第 {{ (c.chunkIndex ?? c.chunk_index) + 1 }} 段 · 分数 {{ formatScore(c) }}
                </span>
                <!-- 渠道 Badge -->
                <div class="flex gap-1 mt-0.5 flex-wrap">
                  <span v-for="src in c.retrieval_sources" :key="src" class="text-[9px] p-0.25 px-1 rounded-[3px] font-bold" :class="channelBadgeClass(src)">
                    {{ channelLabel(src) }}
                  </span>
                </div>
              </div>
            </li>
          </ul>
        </div>

        <!-- 2. 中间大栏：切片详细文本与操作 -->
        <article class="p-5 flex flex-col overflow-y-auto text-left">
          <div v-if="activeChunk" class="flex flex-col h-full">
            <header class="border-b border-slate-200/50 pb-3.5 flex justify-between items-start gap-4">
              <div>
                <span class="text-[11px] font-bold text-text-muted uppercase tracking-wider">当前选中切片内容</span>
                <h4 class="text-sm font-bold text-text-main m-0 mt-1">{{ activeChunk.source }}</h4>
                <p class="text-xs text-text-secondary m-0 mt-1">
                  索引位置: 第 {{ (activeChunk.chunkIndex ?? activeChunk.chunk_index) + 1 }} 段 ·
                  向量相似度: {{ activeChunk.similarity?.toFixed(4) ?? '-' }}
                  <template v-if="activeChunk.rerank_score != null">
                    · 重排分值: {{ activeChunk.rerank_score.toFixed(4) }}
                  </template>
                </p>
              </div>

              <div class="flex gap-2">
                <button class="p-1.5 px-3 border border-border-main bg-white rounded-md text-xs font-bold text-text-secondary cursor-pointer inline-flex items-center gap-1 hover:bg-slate-50" type="button" @click="inspectContext(activeChunk)">
                  <EyeIcon :size="14" />
                  <span>完整上下文</span>
                </button>
                <button class="p-1.5 px-3 bg-primary text-white border-none rounded-md text-xs font-bold cursor-pointer inline-flex items-center gap-1 hover:brightness-104 shadow-btn" type="button" @click="startChatWithChunk(activeChunk)">
                  <MessageSquareIcon :size="13" />
                  <span>去对话验证</span>
                </button>
                <button class="p-1.5 px-3 border border-border-main bg-white rounded-md text-xs font-bold text-text-secondary cursor-pointer inline-flex items-center gap-1 hover:bg-slate-50 hover:text-primary" type="button" @click="createEvalFromChunk(activeChunk)">
                  <CheckSquareIcon :size="13" />
                  <span>转评估用例</span>
                </button>
              </div>
            </header>

            <div class="flex-1 mt-3.5 text-left">
              <pre class="text-[13.5px] leading-relaxed whitespace-pre-wrap text-text-secondary font-mono" v-html="highlightContent(activeChunk.content, query)"></pre>
            </div>
          </div>

          <div v-else class="flex items-center justify-center h-full text-text-muted text-xs">
            <p>在左侧选择特定片段，查看具体段落和操作</p>
          </div>
        </article>

        <!-- 3. 右侧：混合检索 Trace 与权限过滤统计 -->
        <aside class="border-l border-slate-200/50 bg-slate-50 flex flex-col overflow-hidden text-left">
          <header class="p-3.5 bg-white border-b border-slate-200/50 font-bold text-primary text-xs flex items-center gap-1.5">
            <ShieldIcon :size="14" />
            <span>检索链路 Trace</span>
          </header>

          <div class="p-4 flex flex-col gap-4 overflow-y-auto flex-1" v-if="searchResult">
            <div class="grid grid-cols-2 gap-2">
              <div v-for="item in traceSummary" :key="item.label" class="bg-white border border-slate-200/60 rounded-lg p-2.5">
                <span class="block text-[10px] font-bold text-text-muted">{{ item.label }}</span>
                <strong class="block mt-1 text-base font-black text-text-main">{{ item.value }}</strong>
              </div>
            </div>

            <div class="bg-white border border-slate-200/60 rounded-lg p-3">
              <h5 class="m-0 mb-2 text-xs font-bold text-text-main">Query Rewrite</h5>
              <div class="text-[11.5px] text-text-secondary flex flex-col gap-1.5">
                <div class="flex flex-col gap-0.5"><strong>原始提问:</strong> <span>{{ searchResult.query }}</span></div>
                <div class="bg-blue-50 border-l-3 border-primary p-1 px-2 rounded-r-md flex flex-col gap-1" v-if="rewriteQueries.length">
                  <strong>检索用语:</strong>
                  <span v-for="item in rewriteQueries" :key="item" class="leading-relaxed">{{ item }}</span>
                </div>
                <p v-else class="m-0 text-[11px] text-text-muted">后端未返回改写结果，将使用原始问题检索。</p>
              </div>
            </div>

            <div class="bg-white border border-slate-200/60 rounded-lg p-3">
              <h5 class="m-0 mb-2 text-xs font-bold text-text-main">多路召回</h5>
              <div class="text-[11.5px] text-text-secondary flex flex-col gap-1.5">
                <div class="flex flex-col gap-1.5">
                  <div v-for="row in channelRows" :key="row.key" class="flex justify-between items-center gap-2">
                    <span class="min-w-0">
                      {{ row.label }}
                      <em class="not-italic text-[10px] text-text-muted">({{ row.backend }})</em>
                    </span>
                    <strong class="font-bold" :class="row.skipped ? 'text-text-muted' : 'text-text-main'">
                      {{ row.resultCount }} chunks
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            <div class="bg-white border border-slate-200/60 rounded-lg p-3">
              <h5 class="m-0 mb-2 text-xs font-bold text-text-main">RRF 融合 Top</h5>
              <div v-if="rrfTopRows.length" class="flex flex-col gap-1.5 text-[11.5px] text-text-secondary">
                <div v-for="row in rrfTopRows" :key="row.key" class="grid grid-cols-[24px_1fr_auto] items-center gap-2">
                  <span class="w-5 h-5 rounded bg-slate-100 inline-flex items-center justify-center font-bold text-[10px] text-text-muted">{{ row.rank }}</span>
                  <span class="overflow-hidden text-ellipsis whitespace-nowrap" :title="row.source">{{ row.source }}</span>
                  <strong class="font-mono text-text-main">{{ row.score }}</strong>
                </div>
              </div>
              <p v-else class="m-0 text-[11px] text-text-muted">未返回 RRF 明细，当前仅展示最终候选结果。</p>
            </div>

            <div class="bg-white border border-slate-200/60 rounded-lg p-3" v-if="rerankTraceRows.length > 0">
              <h5 class="m-0 mb-2 text-xs font-bold text-text-main">Rerank 位次对照</h5>
              <div class="text-[11.5px] text-text-secondary flex flex-col gap-1.5 font-mono">
                <div class="flex flex-col gap-1">
                  <div class="grid grid-cols-[2fr_1fr_1fr] gap-1.5 font-bold text-text-muted border-b border-slate-200/60 pb-1">
                    <span>片段标题</span>
                    <span>初筛</span>
                    <span>重排</span>
                  </div>
                  <div v-for="row in rerankTraceRows.slice(0, 5)" :key="row.chunkId" class="grid grid-cols-[2fr_1fr_1fr] gap-1.5 py-1">
                    <span class="overflow-hidden text-ellipsis whitespace-nowrap" :title="row.source">{{ row.source.slice(0, 10) }}...</span>
                    <span>#{{ row.beforeRank }}</span>
                    <span class="text-success font-bold">#{{ row.afterRank }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="degradedChannels.length > 0" class="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <h5 class="m-0 mb-2 text-xs font-bold text-amber-900">降级与回退</h5>
              <ul class="list-none p-0 m-0 flex flex-col gap-2">
                <li v-for="item in degradedChannels" :key="`${item.channel}-${item.reason}`" class="text-[11px] text-amber-900 leading-relaxed">
                  <strong>{{ channelLabel(item.channel) }}</strong>
                  <span v-if="item.backend" class="text-amber-700"> / {{ item.backend }}</span>
                  <span>：{{ item.reason }}</span>
                </li>
              </ul>
            </div>

            <div class="bg-red-50/50 border rounded-lg p-3 border-red-500/28">
              <h5 class="m-0 mb-2 text-xs font-bold text-text-main">权限过滤</h5>
              <div class="text-[11.5px] text-text-secondary flex flex-col gap-1.5">
                <div class="flex flex-col gap-0.5">
                  <strong>过滤策略:</strong>
                  <span class="text-success font-bold">{{ permissionFilter.strategy }}</span>
                </div>
                <div class="flex flex-col gap-0.5">
                  <strong>过滤数量:</strong>
                  <strong class="text-error font-bold">{{ aclFilteredCount }} 个废弃/未授权片段</strong>
                </div>
                <p class="text-[10px] text-text-muted m-0 mt-1 leading-relaxed">{{ permissionFilter.description }}</p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>

    <!-- 全局上下文抽屉 -->
    <Teleport to="body">
      <div v-if="contextOpen" class="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[1000] flex justify-end" @click.self="contextOpen = false">
        <aside class="w-[580px] max-w-full bg-white h-full flex flex-col shadow-[-8px_0_32px_rgba(15,23,42,0.12)]">
          <header class="p-6 border-b border-border-main flex justify-between items-center text-left bg-slate-50/50">
            <div>
              <h3 class="m-0 text-sm font-bold text-text-main">原文档上下文</h3>
              <p class="m-0 text-xs text-text-muted mt-1 overflow-hidden text-ellipsis whitespace-nowrap max-w-[450px]" :title="activeDocName">{{ activeDocName }}</p>
            </div>
            <button class="bg-transparent border-none text-text-muted cursor-pointer" type="button" @click="contextOpen = false">
              <XIcon :size="16" />
            </button>
          </header>

          <div class="drawer-body p-6 flex-1 overflow-y-auto">
            <div v-if="loadingContext" class="flex flex-col items-center justify-center p-16 text-center text-text-muted gap-3 h-full">
              <div class="w-7 h-7 border-3 border-blue-500/20 border-t-primary rounded-full animate-spin"></div>
              <p>加载上下文环境中…</p>
            </div>
            <div v-else class="flex flex-col gap-4">
              <div class="flex gap-4 bg-slate-100 p-3 rounded-lg">
                <label class="flex flex-col gap-1 text-[11px] text-text-secondary text-left font-bold">
                  <span>往前加载段数</span>
                  <input v-model.number="beforeChunks" type="number" min="0" max="5" class="h-7.5 w-20 px-2 border border-border-main rounded bg-white text-xs text-text-main outline-none focus:border-primary" @change="loadContext" />
                </label>
                <label class="flex flex-col gap-1 text-[11px] text-text-secondary text-left font-bold">
                  <span>往后加载段数</span>
                  <input v-model.number="afterChunks" type="number" min="0" max="5" class="h-7.5 w-20 px-2 border border-border-main rounded bg-white text-xs text-text-main outline-none focus:border-primary" @change="loadContext" />
                </label>
              </div>

              <ul class="list-none p-0 m-0 flex flex-col gap-3">
                <li
                  v-for="item in contextItems"
                  :key="item.id"
                  class="border border-border-main rounded-lg p-3.5 bg-slate-50/50 text-left"
                  :class="item.id === activeChunk?.id ? '!border-blue-600/40 !bg-blue-50/50' : ''"
                >
                  <header class="flex justify-between mb-2 text-[11px] font-bold">
                    <span class="text-text-muted">§ {{ item.chunkIndex + 1 }}</span>
                    <span v-if="item.id === activeChunk?.id" class="bg-primary text-white text-[9.5px] px-1 py-0.25 rounded-[3px] font-bold">当前匹配段</span>
                  </header>
                  <pre class="text-xs leading-relaxed whitespace-pre-wrap text-text-secondary font-mono">{{ item.content }}</pre>
                </li>
              </ul>
            </div>
          </div>
        </aside>
      </div>
    </Teleport>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircleIcon,
  ChevronDownIcon,
  EyeIcon,
  MessageSquareIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
  ShieldIcon,
  CheckSquareIcon,
} from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import PageHeader from '@/components/common/PageHeader.vue'
import type { KnowledgeBase, KnowledgeSearchChunk, KnowledgeSearchResult } from '@/types'

const router = useRouter()
const route = useRoute()
const kbApi = useKnowledgeBase()

const query = ref('')
const kbs = ref<KnowledgeBase[]>([])
const selectedKbId = ref('')
const fileType = ref('')

const searched = ref(false)
const advancedOpen = ref(false)

// 高级参数状态
const threshold = ref(0.2)
const stage1TopK = ref(15)
const finalTopK = ref(5)
const rerank = ref(true)
const useGraph = ref(true)
const tags = ref('')
const department = ref('')
const businessCategory = ref('')
const visibility = ref('')

const results = ref<KnowledgeSearchChunk[]>([])
const activeChunk = ref<KnowledgeSearchChunk | null>(null)
const searchResult = ref<KnowledgeSearchResult | null>(null)

// 衍生统计项
const channelCounts = computed(() => {
  const stageChannels = searchResult.value?.stageTrace?.channels
  if (stageChannels) {
    return {
      vector: stageChannels.vector?.resultCount ?? 0,
      keyword: stageChannels.keyword?.resultCount ?? 0,
      graph: stageChannels.graph?.resultCount ?? 0,
    }
  }
  const counts = { vector: 0, keyword: 0, graph: 0 }
  const stage1List = searchResult.value?.stage1 ?? []
  for (const c of stage1List) {
    if (c.retrieval_sources?.includes('vector')) counts.vector++
    if (c.retrieval_sources?.includes('keyword')) counts.keyword++
    if (c.retrieval_sources?.includes('graph')) counts.graph++
  }
  return counts
})

const channelRows = computed(() => {
  const channels = searchResult.value?.stageTrace?.channels
  if (channels) {
    return Object.entries(channels).map(([key, trace]) => ({
      key,
      label: channelLabel(key),
      backend: trace.backend || 'disabled',
      resultCount: trace.resultCount ?? 0,
      skipped: trace.skipped || trace.backend === 'disabled',
    }))
  }
  return [
    { key: 'vector', label: '向量召回', backend: 'unknown', resultCount: channelCounts.value.vector, skipped: false },
    { key: 'keyword', label: '全文召回', backend: 'unknown', resultCount: channelCounts.value.keyword, skipped: false },
    { key: 'graph', label: '图谱召回', backend: 'unknown', resultCount: channelCounts.value.graph, skipped: false },
  ]
})

const rrfFusionCount = computed(() => searchResult.value?.stageTrace?.rrfFusion?.length ?? 0)

const degradedChannels = computed(() => searchResult.value?.degradedChannels ?? [])

const traceSummary = computed(() => [
  { label: '改写问题', value: rewriteQueries.value.length || 0 },
  { label: '召回通道', value: channelRows.value.filter((row) => !row.skipped).length },
  { label: 'RRF 候选', value: rrfFusionCount.value || results.value.length },
  { label: '权限过滤', value: aclFilteredCount.value },
])

const rewriteQueries = computed(() => {
  const trace = searchResult.value?.stageTrace as
    | {
        queryRewrite?: { rewrittenQuery?: string; queries?: string[]; retrievalQueries?: string[] }
        retrievalQueries?: string[]
      }
    | undefined
  const candidates = [
    searchResult.value?.retrievalQuery,
    trace?.queryRewrite?.rewrittenQuery,
    ...(trace?.queryRewrite?.queries ?? []),
    ...(trace?.queryRewrite?.retrievalQueries ?? []),
    ...(trace?.retrievalQueries ?? []),
  ]
  return Array.from(new Set(candidates.filter((item): item is string => Boolean(item?.trim()))))
})

const rrfTopRows = computed(() => {
  const chunkMap = new Map<string, KnowledgeSearchChunk>()
  for (const chunk of [
    ...(searchResult.value?.hybridChunks ?? []),
    ...(searchResult.value?.rerankedChunks ?? []),
    ...(searchResult.value?.stage1 ?? []),
    ...(searchResult.value?.stage2 ?? []),
    ...results.value,
  ]) {
    chunkMap.set(chunk.id, chunk)
  }

  return (searchResult.value?.stageTrace?.rrfFusion ?? []).slice(0, 5).map((item, index) => {
    const record = item as { chunkId?: string; id?: string; score?: number; rrfScore?: number }
    const chunkId = record.chunkId ?? record.id ?? String(index)
    const chunk = chunkMap.get(chunkId)
    const score = record.rrfScore ?? record.score
    return {
      key: `${chunkId}-${index}`,
      rank: index + 1,
      source: chunk?.source ?? chunkId,
      score: typeof score === 'number' ? score.toFixed(4) : '-',
    }
  })
})

const rerankTraceRows = computed(() => {
  const chunks = new Map<string, KnowledgeSearchChunk>()
  for (const chunk of [
    ...(searchResult.value?.hybridChunks ?? []),
    ...(searchResult.value?.rerankedChunks ?? []),
    ...(searchResult.value?.stage1 ?? []),
    ...(searchResult.value?.stage2 ?? []),
  ]) {
    chunks.set(chunk.id, chunk)
  }
  return (searchResult.value?.stageTrace?.rerank ?? []).map((item) => ({
    ...item,
    source: chunks.get(item.chunkId)?.source ?? item.chunkId,
  }))
})

const aclFilteredCount = computed(() => {
  const stageFilter = searchResult.value?.stageTrace?.permissionFilter
  if (stageFilter) return stageFilter.filtered
  if (typeof searchResult.value?.permissionFilteredCount === 'number') {
    return searchResult.value.permissionFilteredCount
  }
  const stage1Count = searchResult.value?.stage1?.length ?? 0
  const stage2Count = searchResult.value?.stage2?.length ?? 0
  // 如果初筛到的比重排后通过过滤返回的还要多得多，并且超出了合理的截断，则计入过滤
  if (stage1Count > stage2Count) {
    return Math.max(0, stage1Count - stage2Count - 2)
  }
  return 0
})

const permissionFilter = computed(() => {
  const filter = searchResult.value?.stageTrace?.permissionFilter as
    | { strategy?: string; reason?: string; visibleScopes?: string[]; filtered?: number }
    | undefined
  const scopes = filter?.visibleScopes?.length ? `可见范围：${filter.visibleScopes.join('、')}` : '按用户、部门、可见范围与当前版本过滤。'
  return {
    strategy: filter?.strategy ?? 'ACL Filter',
    description: filter?.reason ?? scopes,
  }
})

function channelLabel(channel: string): string {
  const labels: Record<string, string> = {
    vector: '向量召回',
    keyword: '全文召回',
    graph: '图谱召回',
    memory: '记忆召回',
    multimodal: '多模态召回',
    queryRewrite: '问题改写',
    rerank: '语义重排',
    permission: '权限过滤',
  }
  return labels[channel] ?? channel
}

function channelBadgeClass(channel: string): string {
  const classes: Record<string, string> = {
    vector: 'bg-blue-100 text-blue-800',
    keyword: 'bg-emerald-100 text-emerald-800',
    graph: 'bg-purple-100 text-purple-800',
    memory: 'bg-amber-100 text-amber-800',
    multimodal: 'bg-cyan-100 text-cyan-800',
  }
  return classes[channel] ?? 'bg-slate-100 text-slate-700'
}

async function loadKbs() {
  const res = await kbApi.listAll()
  kbs.value = res
  const routeKbId = typeof route.query.knowledgeBaseId === 'string' ? route.query.knowledgeBaseId : ''
  const routeQuery = typeof route.query.q === 'string' ? route.query.q : ''
  if (routeQuery) query.value = routeQuery
  if (res.length > 0) {
    selectedKbId.value = res.some((kb) => kb.id === routeKbId) ? routeKbId : ''
    onKbChanged()
    if (routeQuery) void runSearch()
  }
}

onMounted(loadKbs)

function onKbChanged() {
  searched.value = false
  results.value = []
  activeChunk.value = null
  const currentKb = kbs.value.find((k) => k.id === selectedKbId.value)
  if (currentKb) {
    threshold.value = currentKb.retrievalConfig?.threshold ?? 0.2
    stage1TopK.value = currentKb.retrievalConfig?.stage1TopK ?? 15
    finalTopK.value = currentKb.retrievalConfig?.finalTopK ?? 5
    rerank.value = currentKb.retrievalConfig?.rerank ?? true
  }
}

async function runSearch() {
  const q = query.value.trim()
  if (!q) return
  activeChunk.value = null
  results.value = []
  searched.value = false
  
  const res = await kbApi.searchAcrossKnowledgeBases(q, {
    knowledgeBaseIds: selectedKbId.value ? [selectedKbId.value] : [],
    fileType: fileType.value,
    threshold: threshold.value,
    rerank: rerank.value,
    stage1TopK: stage1TopK.value,
    finalTopK: finalTopK.value,
    useGraph: useGraph.value,
    tags: tags.value,
    department: department.value,
    businessCategory: businessCategory.value,
    visibility: visibility.value,
  })

  searchResult.value = res
  searched.value = true
  if (res) {
    results.value = res.rerankedChunks ?? res.stage2 ?? res.hybridChunks ?? res.stage1 ?? []
    if (results.value.length > 0) {
      activeChunk.value = results.value[0]
    }
  }
}

function findStage1Rank(id: string): string {
  const idx = searchResult.value?.stage1?.findIndex((c) => c.id === id) ?? -1
  return idx === -1 ? '未召回' : String(idx + 1)
}

function formatScore(c: KnowledgeSearchChunk): string {
  if (c.rerank_score != null) return `重排 ${c.rerank_score.toFixed(3)}`
  return `相似 ${c.similarity.toFixed(3)}`
}

// 上下文抽屉控制
const contextOpen = ref(false)
const activeDocName = ref('')
const loadingContext = ref(false)
const beforeChunks = ref(1)
const afterChunks = ref(1)
const contextItems = ref<Array<{ id: string; chunkIndex: number; content: string }>>([])

async function inspectContext(chunk: KnowledgeSearchChunk) {
  activeDocName.value = chunk.source
  contextOpen.value = true
  await loadContext()
}

async function loadContext() {
  const chunk = activeChunk.value
  if (!chunk) return
  const docId = chunk.documentId || chunk.document_id
  const kbId = chunk.knowledgeBaseId || chunk.knowledge_base_id || selectedKbId.value
  if (!docId || !kbId) return
  
  loadingContext.value = true
  try {
    const res = await kbApi.getChunkContext(
      kbId,
      docId,
      chunk.id,
      beforeChunks.value,
      afterChunks.value,
    )
    if (res) {
      contextItems.value = res.items
    }
  } finally {
    loadingContext.value = false
  }
}

watch(contextOpen, (open) => {
  if (!open) {
    contextItems.value = []
  }
})

function startChatWithChunk(chunk: KnowledgeSearchChunk) {
  const kbId = chunk.knowledgeBaseId || chunk.knowledge_base_id || selectedKbId.value
  const payload = {
    query: query.value,
    kbId,
    chunkId: chunk.id,
    content: chunk.content,
    source: chunk.source,
  }
  localStorage.setItem('__draft_rag_search', JSON.stringify(payload))
  
  router.push({
    path: '/chat',
    query: {
      knowledgeBaseId: kbId,
      useSearchDraft: '1',
    },
  })
}

function createEvalFromChunk(chunk: KnowledgeSearchChunk) {
  router.push({
    path: '/evaluation',
    query: {
      knowledgeBaseId: chunk.knowledgeBaseId || chunk.knowledge_base_id || selectedKbId.value,
      addQuestion: query.value,
      expectedAnswer: chunk.content.slice(0, 1200),
    },
  })
}

function highlightContent(content: string, q: string) {
  if (!content) return ''
  if (!q || !q.trim()) {
    return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  
  const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const escapedQuery = q.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').trim()
  if (!escapedQuery) return escaped
  
  try {
    const regex = new RegExp(`(${escapedQuery})`, 'gi')
    return escaped.replace(regex, '<mark class="bg-amber-100/90 text-amber-950 font-semibold rounded-[2px] px-0.5">$1</mark>')
  } catch (e) {
    return escaped
  }
}
</script>

<style scoped>
/* 智能检索调试台已完全使用 Tailwind CSS 原子类改造，无须 scoped style */
</style>
