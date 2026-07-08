<template>
  <main class="p-6 h-full overflow-y-auto bg-transparent text-left flex flex-col gap-6 w-full box-border">
    <header class="mb-1">
      <div>
        <h2 class="text-xl font-extrabold text-text-main tracking-tight m-0">系统管理 & 权限矩阵</h2>
        <p class="text-xs text-text-muted mt-1">配置基于角色的访问控制 (RBAC) 与文档级 ACL 白名单</p>
      </div>
    </header>

    <!-- 功能标签页 -->
    <div class="flex gap-2 border-b border-border-main mb-1">
      <button 
        v-for="tab in tabs" 
        :key="tab.key" 
        class="relative p-2.5 px-4 text-[13.5px] font-bold text-text-secondary border-none bg-transparent cursor-pointer" 
        :class="activeTab === tab.key ? 'text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-primary' : 'hover:text-primary'"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Tab 1: 角色管理 -->
    <section v-if="activeTab === 'roles'" class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-5 shadow-[0_4px_20px_rgba(15,23,42,0.015)] flex flex-col gap-4">
      <div class="flex justify-between items-center">
        <h3 class="text-sm font-bold text-text-main m-0">系统内置角色</h3>
        <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary-bg text-primary">{{ permissions.length }} 项权限</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div v-for="r in rolesList" :key="r.id" class="border border-border-main rounded-lg p-4 flex flex-col gap-2 bg-white/40">
          <header class="flex justify-between items-center">
            <h4 class="text-sm font-bold text-text-secondary m-0">{{ r.name }}</h4>
            <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold" :class="r.code === 'admin' ? 'bg-red-50 text-red-700' : 'bg-primary-bg text-primary'">{{ r.code }}</span>
          </header>
          <p class="text-xs text-text-muted leading-relaxed">{{ r.description }}</p>
          <div class="flex flex-col">
            <h5 class="m-0 mb-1.5 text-[10px] text-text-muted">关联权限码:</h5>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="p in r.permissionCodes" :key="p" class="bg-slate-100 text-slate-700 p-0.5 px-2 rounded-sm text-[10px] font-mono font-semibold">{{ p }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Tab 2: 部门管理 -->
    <section v-if="activeTab === 'departments'" class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-5 shadow-[0_4px_20px_rgba(15,23,42,0.015)] flex flex-col gap-4">
      <div class="flex justify-between items-center">
        <h3 class="text-sm font-bold text-text-main m-0">企业部门架构</h3>
        <button class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-border-main rounded-lg text-xs font-bold text-text-secondary cursor-pointer hover:bg-slate-50 hover:text-primary hover:border-primary-muted transition-all" @click="addDept">
          <PlusIcon :size="13" /> 新增部门
        </button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-left">
          <thead>
            <tr>
              <th scope="col" class="p-3.5 px-3 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">部门ID</th>
              <th scope="col" class="p-3.5 px-3 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">部门名称</th>
              <th scope="col" class="p-3.5 px-3 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">数据可见层级</th>
              <th scope="col" class="p-3.5 px-3 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">管理员角色</th>
              <th scope="col" class="p-3.5 px-3 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="dept in departments" :key="dept.id">
              <td class="p-3.5 px-3 border-b border-slate-200/40 text-xs text-text-secondary"><strong>{{ dept.code }}</strong></td>
              <td class="p-3.5 px-3 border-b border-slate-200/40 text-xs text-text-secondary">{{ dept.name }}</td>
              <td class="p-3.5 px-3 border-b border-slate-200/40 text-xs text-text-secondary">
                <span class="inline-block px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-[4px] text-[10.5px] font-bold">{{ dept.parentId ? '子部门' : '一级部门' }}</span>
              </td>
              <td class="p-3.5 px-3 border-b border-slate-200/40 text-xs text-text-secondary">{{ dept.parentId || '-' }}</td>
              <td class="p-3.5 px-3 border-b border-slate-200/40 text-xs text-text-secondary text-right">
                <div class="flex justify-end gap-1.5">
                  <button class="w-7 h-7 rounded-md border border-border-main bg-white text-text-muted flex items-center justify-center cursor-pointer transition-all hover:border-red-500/30 hover:text-error hover:bg-red-50/50" title="删除" @click="removeDept(dept.id)">
                    <Trash2Icon :size="13" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Tab 3: 用户授权分配 -->
    <section v-if="activeTab === 'users'" class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-5 shadow-[0_4px_20px_rgba(15,23,42,0.015)] flex flex-col gap-4">
      <div class="flex justify-between items-center">
        <h3 class="text-sm font-bold text-text-main m-0">用户角色分配</h3>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-left">
          <thead>
            <tr>
              <th scope="col" class="p-3.5 px-3 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">用户 ID</th>
              <th scope="col" class="p-3.5 px-3 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">用户名</th>
              <th scope="col" class="p-3.5 px-3 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">当前所属角色</th>
              <th scope="col" class="p-3.5 px-3 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">所属部门</th>
              <th scope="col" class="p-3.5 px-3 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary text-right">分配操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td class="p-3.5 px-3 border-b border-slate-200/40 text-xs text-text-secondary"><strong>{{ u.id }}</strong></td>
              <td class="p-3.5 px-3 border-b border-slate-200/40 text-xs text-text-secondary">{{ u.username }}</td>
              <td class="p-3.5 px-3 border-b border-slate-200/40 text-xs text-text-secondary">
                <select v-model="u.selectedRole" class="h-8 px-2 border border-border-main rounded-md text-[11px] bg-white text-text-main outline-none focus:border-primary">
                  <option value="">未分配</option>
                  <option v-for="role in rolesList" :key="role.id" :value="role.code">
                    {{ role.name }} ({{ role.code }})
                  </option>
                </select>
              </td>
              <td class="p-3.5 px-3 border-b border-slate-200/40 text-xs text-text-secondary">
                <select v-model="u.selectedDepartment" class="h-8 px-2 border border-border-main rounded-md text-[11px] bg-white text-text-main outline-none focus:border-primary">
                  <option value="">未分配</option>
                  <option v-for="dept in departments" :key="dept.id" :value="dept.code">
                    {{ dept.name }} ({{ dept.code }})
                  </option>
                </select>
              </td>
              <td class="p-3.5 px-3 border-b border-slate-200/40 text-xs text-text-secondary text-right">
                <div class="flex justify-end">
                  <button class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-border-main rounded-lg text-xs font-bold text-text-secondary cursor-pointer hover:bg-slate-50 hover:text-primary hover:border-primary-muted transition-all" @click="saveUserAuth(u)">保存授权</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { PlusIcon, Trash2Icon } from 'lucide-vue-next'
import { useRbac } from '@/hooks/useRbac'
import type { RbacDepartmentItem, RbacPermissionItem, RbacRoleItem, RbacUserItem } from '@/types'

const activeTab = ref('roles')
const tabs = [
  { key: 'roles', label: '角色与权限矩阵' },
  { key: 'departments', label: '部门架构管理' },
  { key: 'users', label: '用户角色分配' },
]

interface EditableUser extends RbacUserItem {
  selectedRole: string
  selectedDepartment: string
}

const rbacApi = useRbac()
const rolesList = ref<RbacRoleItem[]>([])
const permissions = ref<RbacPermissionItem[]>([])
const departments = ref<RbacDepartmentItem[]>([])
const users = ref<EditableUser[]>([])

onMounted(loadAll)

async function loadAll() {
  const [roles, perms, depts, userResult] = await Promise.all([
    rbacApi.listRoles(),
    rbacApi.listPermissions(),
    rbacApi.listDepartments(),
    rbacApi.listUsers({ page: 1, pageSize: 50 }),
  ])
  rolesList.value = roles
  permissions.value = perms
  departments.value = depts
  users.value = userResult.items.map((user) => ({
    ...user,
    selectedRole: user.roleCodes[0] ?? user.role ?? '',
    selectedDepartment: user.department ?? '',
  }))
}

async function addDept() {
  const code = window.prompt('请输入部门编码，例如 R&D')
  if (!code?.trim()) return
  const name = window.prompt('请输入部门名称')
  if (!name?.trim()) return
  const created = await rbacApi.createDepartment({ code: code.trim(), name: name.trim() })
  if (created) departments.value.push(created)
}

async function removeDept(id: string) {
  if (!confirm('确定删除这个部门吗？')) return
  const ok = await rbacApi.deleteDepartment(id)
  if (ok) departments.value = departments.value.filter((dept) => dept.id !== id)
}

async function saveUserAuth(u: EditableUser) {
  const roleCodes = u.selectedRole ? [u.selectedRole] : []
  const [rolesOk, deptOk] = await Promise.all([
    rbacApi.assignUserRoles(u.id, roleCodes),
    rbacApi.updateUserDepartment(u.id, u.selectedDepartment || null),
  ])
  if (!rolesOk || !deptOk) {
    alert('授权保存失败，请检查后端权限配置。')
    return
  }
  await loadAll()
}
</script>

<style scoped>
/* 系统管理已完全使用 Tailwind CSS 改造，无须 scoped style */
</style>
