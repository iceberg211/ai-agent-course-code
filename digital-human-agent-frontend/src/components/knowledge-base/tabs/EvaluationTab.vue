<template>
  <div class="flex flex-col gap-5 text-left">
    <header class="flex justify-between items-center border-b border-slate-200 pb-3">
      <div>
        <h3 class="m-0 text-sm font-extrabold text-text-main">回归黄金测试集</h3>
        <p class="m-0 text-[11px] text-text-muted mt-1">保存核心业务问题的真值答案（Ground Truth），一键自动化测试生成质量与召回率。</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="px-3 h-8.5 border border-slate-200 hover:border-primary-muted hover:text-primary rounded-lg text-xs font-semibold cursor-pointer transition-all bg-white" type="button" @click="createOpen = true">
          添加用例
        </button>
        <button class="px-4.5 h-8.5 bg-gradient-to-br from-blue-500 to-blue-700 text-white border-none rounded-lg text-xs font-bold cursor-pointer hover:brightness-104 flex items-center gap-1.5" type="button" :disabled="running" @click="runBatch">
          <PlayIcon :size="13" :class="{ 'animate-spin': running }" />
          <span>{{ running ? '批量运行中…' : '执行批量评测' }}</span>
        </button>
      </div>
    </header>

    <div v-if="loading" class="text-center py-8 text-text-muted text-xs">加载用例中…</div>
    <div v-else-if="!cases.length" class="py-12 border border-dashed border-slate-200 rounded-xl text-center text-text-muted text-xs">
      当前知识库尚未录入任何黄金测试用例，请在右上方点击“添加用例”开始。
    </div>
    <div v-else class="flex flex-col gap-3">
      <div v-for="item in cases" :key="item.id" class="p-4 border border-slate-200/60 rounded-xl bg-slate-50/30 flex flex-col gap-2.5">
        <div class="flex justify-between items-start gap-3">
          <div class="flex flex-col gap-1 min-w-0">
            <h4 class="m-0 text-xs font-bold text-text-secondary leading-relaxed">问题：{{ item.question }}</h4>
            <span v-if="item.expectedAnswer" class="text-[11px] text-text-muted">真值标准：{{ item.expectedAnswer }}</span>
          </div>
          <span 
            class="px-2 py-0.5 rounded-[6px] text-[9.5px] font-extrabold shrink-0 capitalize"
            :class="badgeClassOf(item)"
          >
            {{ statusLabelOf(item) }}
          </span>
        </div>

        <!-- 评测对比详情 -->
        <div v-if="item.lastRunStatus === 'completed'" class="p-3 bg-white border border-slate-100 rounded-lg text-[11px] flex flex-col gap-2">
          <div class="flex justify-between items-center border-b border-slate-100 pb-1.5">
            <span class="text-text-muted">评测生成回答:</span>
            <span class="text-text-muted text-[10px]">召回耗时: <strong class="text-text-main">{{ item.retrievalLatencyMs ?? '-' }}ms</strong></span>
          </div>
          <p class="m-0 leading-relaxed text-text-secondary whitespace-pre-wrap">{{ item.lastGeneratedAnswer }}</p>
          <div v-if="item.evaluationResult" class="flex gap-4 items-center bg-slate-50/50 p-2 rounded border border-slate-100 text-[10.5px] mt-1">
            <span>是否通过: <strong :class="item.evaluationResult.isPassed ? 'text-emerald-600' : 'text-red-500'">{{ item.evaluationResult.isPassed ? '已通过' : '失败' }}</strong></span>
            <span>语义匹配分: <strong class="text-text-main">{{ item.evaluationResult.semanticScore?.toFixed(2) ?? '-' }}</strong></span>
            <span v-if="item.evaluationResult.reason" class="text-text-muted overflow-hidden text-ellipsis whitespace-nowrap">原因: {{ item.evaluationResult.reason }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 添加用例弹窗 -->
    <div v-if="createOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div class="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-card border border-slate-100 text-left">
        <header class="flex justify-between items-center p-4.5 px-6 border-b border-slate-200">
          <h3 class="m-0 text-xs font-bold text-text-main">新增黄金回归用例</h3>
          <button class="w-6 h-6 border-none bg-transparent rounded-full flex items-center justify-center cursor-pointer text-text-muted hover:bg-slate-100" type="button" @click="createOpen = false">
            <XIcon :size="15" />
          </button>
        </header>
        <form class="p-5 flex flex-col gap-4 text-left" @submit.prevent="submitCreate">
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-text-secondary">黄金测试提问 <span class="text-error">*</span></label>
            <textarea v-model="form.question" class="w-full p-2.5 border border-slate-200 rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary transition-all" rows="3" placeholder="典型提问问题…" required></textarea>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-text-secondary">标准黄金答案 / 真值参考</label>
            <textarea v-model="form.expectedAnswer" class="w-full p-2.5 border border-slate-200 rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary transition-all" rows="4" placeholder="大模型评测的基准真值答案…"></textarea>
          </div>
          <footer class="flex justify-end gap-3 pt-3 border-t border-slate-150">
            <button class="h-8.5 px-4 border border-slate-200 bg-white rounded-lg text-xs font-semibold text-text-secondary cursor-pointer hover:bg-slate-50" type="button" @click="createOpen = false">取消</button>
            <button class="h-8.5 px-5 bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white border-none rounded-lg text-xs font-bold cursor-pointer hover:brightness-104 shadow-btn" type="submit">添加</button>
          </footer>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { PlayIcon, XIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'

const props = defineProps<{ kbId: string }>()

const kbApi = useKnowledgeBase()
const cases = ref<any[]>([])
const loading = ref(false)
const running = ref(false)
const createOpen = ref(false)

const form = ref({
  question: '',
  expectedAnswer: ''
})

async function load() {
  loading.value = true
  try {
    cases.value = await kbApi.listEvalCases(props.kbId)
  } finally {
    loading.value = false
  }
}

async function runBatch() {
  running.value = true
  try {
    cases.value = await kbApi.runEvalBatch(props.kbId)
    alert('该知识库批量评测完成！')
  } catch (err) {
    alert('评测失败：' + String(err))
  } finally {
    running.value = false
  }
}

async function submitCreate() {
  if (!form.value.question.trim()) return
  try {
    const res = await kbApi.createEvalCase(props.kbId, {
      question: form.value.question.trim(),
      expectedAnswer: form.value.expectedAnswer.trim()
    })
    if (res) {
      createOpen.value = false
      form.value = { question: '', expectedAnswer: '' }
      await load()
    }
  } catch (err) {
    alert('添加黄金测试用例失败：' + String(err))
  }
}

function statusLabelOf(item: any): string {
  const map: Record<string, string> = {
    pending: '待运行',
    running: '计算中',
    completed: '已完成',
    failed: '异常中断',
  }
  return map[item.lastRunStatus] ?? item.lastRunStatus
}

function badgeClassOf(item: any): string {
  const status = item.lastRunStatus || 'pending'
  if (status === 'completed') {
    return item.evaluationResult?.isPassed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
  }
  if (status === 'running') return 'bg-amber-50 text-amber-700'
  return 'bg-slate-100 text-slate-700'
}

onMounted(load)
</script>
