<template>
  <div class="flex flex-col gap-6 text-left">
    <div>
      <h3 class="m-0 text-sm font-extrabold text-text-main">知识可见性与安全范围 (ACL)</h3>
      <p class="m-0 text-[11px] text-text-muted mt-1">配置该知识库的安全隔离策略，决定哪些用户或部门可以在搜索和数字人对话中检索到此库中的段落。</p>
    </div>

    <form class="flex flex-col gap-5 max-w-xl" @submit.prevent="savePermissions">
      <!-- 权限级别 -->
      <div class="flex flex-col gap-2">
        <label class="text-xs font-bold text-text-secondary">公开隔离级别</label>
        <div class="grid grid-cols-3 gap-3">
          <label 
            v-for="level in [
              { key: 'private', label: '私有 Private', desc: '仅创建人可见' },
              { key: 'internal', label: '部门共享 Internal', desc: '指定部门共享检索' },
              { key: 'public', label: '企业公开 Public', desc: '全企业全员均可检索' }
            ]"
            :key="level.key"
            class="p-3 border rounded-xl flex flex-col gap-1 cursor-pointer transition-all text-left bg-slate-50/50 hover:border-primary/20"
            :class="form.visibility === level.key ? 'border-primary bg-primary/5' : 'border-slate-200'"
          >
            <input 
              v-model="form.visibility" 
              type="radio" 
              :value="level.key" 
              class="sr-only" 
            />
            <span class="text-xs font-bold text-text-secondary">{{ level.label }}</span>
            <span class="text-[9.5px] text-text-muted mt-0.5 leading-relaxed">{{ level.desc }}</span>
          </label>
        </div>
      </div>

      <!-- 共享部门名单 -->
      <div v-if="form.visibility === 'internal'" class="flex flex-col gap-2 transition-all">
        <label class="text-xs font-bold text-text-secondary">授权检索的可见部门列表</label>
        <div class="flex gap-2">
          <input
            v-model="newDept"
            type="text"
            class="flex-1 h-9 px-3 border border-slate-200 rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary transition-all"
            placeholder="输入可见部门名称，例如：研发部、HR 团队"
          />
          <button class="px-4 h-9 bg-slate-100 hover:bg-slate-200 text-text-secondary border-none rounded-lg text-xs font-bold cursor-pointer" type="button" @click="addDept">
            添加
          </button>
        </div>
        
        <div class="flex gap-1.5 flex-wrap mt-2">
          <span 
            v-for="dept in form.visibilityDepartments" 
            :key="dept" 
            class="bg-slate-100 text-text-secondary text-xs px-2.5 py-1 rounded-md flex items-center gap-1.5"
          >
            <span>{{ dept }}</span>
            <button class="border-none bg-transparent p-0 text-text-muted hover:text-error cursor-pointer text-[10px]" type="button" @click="removeDept(dept)">×</button>
          </span>
          <span v-if="!form.visibilityDepartments.length" class="text-xs text-text-muted">暂无绑定部门（默认为您的所在部门）。</span>
        </div>
      </div>

      <div class="pt-3 border-t border-slate-150">
        <button class="h-9 px-6 bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white border-none rounded-lg text-xs font-bold cursor-pointer hover:brightness-104 shadow-btn" type="submit" :disabled="saving">
          {{ saving ? '正在保存…' : '保存安全隔离设置' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'

const props = defineProps<{ kb: any }>()
const kbApi = useKnowledgeBase()

const saving = ref(false)
const newDept = ref('')

const form = ref({
  visibility: 'private',
  visibilityDepartments: [] as string[]
})

watch(() => props.kb, (val) => {
  if (val) {
    form.value.visibility = val.visibility || 'private'
    form.value.visibilityDepartments = Array.isArray(val.visibilityDepartments) ? [...val.visibilityDepartments] : []
  }
}, { immediate: true })

function addDept() {
  const val = newDept.value.trim()
  if (!val) return
  if (!form.value.visibilityDepartments.includes(val)) {
    form.value.visibilityDepartments.push(val)
  }
  newDept.value = ''
}

function removeDept(dept: string) {
  form.value.visibilityDepartments = form.value.visibilityDepartments.filter(d => d !== dept)
}

async function savePermissions() {
  saving.value = true
  try {
    const updated = await kbApi.update(props.kb.id, {
      visibility: form.value.visibility,
      visibilityDepartments: form.value.visibilityDepartments
    })
    if (updated) {
      alert('安全隔离设置已成功更新！')
    }
  } catch (err) {
    alert('保存设置失败：' + String(err))
  } finally {
    saving.value = false
  }
}
</script>
