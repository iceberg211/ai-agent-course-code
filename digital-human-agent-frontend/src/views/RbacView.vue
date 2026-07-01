<template>
  <main class="rbac-view">
    <header class="page-head">
      <div>
        <h2>系统管理 & 权限矩阵</h2>
        <p class="subtitle">配置基于角色的访问控制 (RBAC) 与文档级 ACL 白名单</p>
      </div>
    </header>

    <!-- 功能标签页 -->
    <div class="rbac-tabs">
      <button 
        v-for="tab in tabs" 
        :key="tab.key" 
        class="tab-btn" 
        :class="{ 'tab-btn--active': activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Tab 1: 角色管理 -->
    <section v-if="activeTab === 'roles'" class="rbac-section">
      <div class="section-head">
        <h3>系统内置角色</h3>
        <span class="badge badge--primary">{{ permissions.length }} 项权限</span>
      </div>
      <div class="role-grid">
        <div v-for="r in rolesList" :key="r.id" class="role-card">
          <header class="role-card-header">
            <h4>{{ r.name }}</h4>
            <span class="badge" :class="r.code === 'admin' ? 'badge--danger' : 'badge--primary'">{{ r.code }}</span>
          </header>
          <p class="desc">{{ r.description }}</p>
          <div class="perms-list">
            <h5>关联权限码:</h5>
            <div class="tags">
              <span v-for="p in r.permissionCodes" :key="p" class="tag">{{ p }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Tab 2: 部门管理 -->
    <section v-if="activeTab === 'departments'" class="rbac-section">
      <div class="section-head">
        <h3>企业部门架构</h3>
        <button class="btn-secondary btn-sm" @click="addDept">
          <PlusIcon :size="13" /> 新增部门
        </button>
      </div>
      <div class="table-container">
        <table class="rbac-table">
          <thead>
            <tr>
              <th scope="col">部门ID</th>
              <th scope="col">部门名称</th>
              <th scope="col">数据可见层级</th>
              <th scope="col">管理员角色</th>
              <th scope="col" class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="dept in departments" :key="dept.id">
              <td><strong>{{ dept.code }}</strong></td>
              <td>{{ dept.name }}</td>
              <td>
                <span class="status-pill status-pill--passed">{{ dept.parentId ? '子部门' : '一级部门' }}</span>
              </td>
              <td>{{ dept.parentId || '-' }}</td>
              <td class="text-right cell-actions">
                <button class="action-btn action-btn--danger" title="删除" @click="removeDept(dept.id)">
                  <Trash2Icon :size="13" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Tab 3: 用户授权分配 -->
    <section v-if="activeTab === 'users'" class="rbac-section">
      <div class="section-head">
        <h3>用户角色分配</h3>
      </div>
      <div class="table-container">
        <table class="rbac-table">
          <thead>
            <tr>
              <th scope="col">用户 ID</th>
              <th scope="col">用户名</th>
              <th scope="col">当前所属角色</th>
              <th scope="col">所属部门</th>
              <th scope="col" class="text-right">分配操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td><strong>{{ u.id }}</strong></td>
              <td>{{ u.username }}</td>
              <td>
                <select v-model="u.selectedRole" class="select-sm">
                  <option value="">未分配</option>
                  <option v-for="role in rolesList" :key="role.id" :value="role.code">
                    {{ role.name }} ({{ role.code }})
                  </option>
                </select>
              </td>
              <td>
                <select v-model="u.selectedDepartment" class="select-sm">
                  <option value="">未分配</option>
                  <option v-for="dept in departments" :key="dept.id" :value="dept.code">
                    {{ dept.name }} ({{ dept.code }})
                  </option>
                </select>
              </td>
              <td class="text-right cell-actions">
                <button class="btn-secondary btn-sm" @click="saveUserAuth(u)">保存授权</button>
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
.rbac-view {
  padding: 24px;
  height: 100%;
  overflow-y: auto;
  background: var(--bg-surface);
}

.page-head {
  margin-bottom: 24px;
}

.rbac-tabs {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 24px;
}

.tab-btn {
  padding: 10px 16px;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text-secondary);
  border: none;
  background: transparent;
  cursor: pointer;
  position: relative;
}

.tab-btn--active {
  color: var(--primary);
}

.tab-btn--active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--primary);
}

.rbac-section {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.role-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.role-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.role-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.role-card-header h4 {
  margin: 0;
  font-weight: 800;
}

.role-card .desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.perms-list h5 {
  margin: 0 0 6px 0;
  font-size: 11px;
  color: var(--text-muted);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  background: var(--surface-soft);
  color: var(--text-secondary);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  font-weight: 600;
}

.table-container {
  overflow-x: auto;
}

.rbac-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.rbac-table th {
  padding: 12px;
  border-bottom: 2px solid var(--border-muted);
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}

.rbac-table td {
  padding: 12px;
  border-bottom: 1px solid var(--border-muted);
  font-size: 13px;
  vertical-align: middle;
}

.select-sm {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  background: #fff;
}

.status-pill--passed {
  background: rgba(16, 185, 129, 0.1);
  color: var(--success);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}

.cell-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}
</style>
