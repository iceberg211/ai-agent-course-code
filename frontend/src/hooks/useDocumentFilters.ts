import { reactive, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { useKnowledgeBase } from '@/hooks/useKnowledgeBase'

export function useDocumentFilters(
  refreshListCallback: () => void | Promise<void>
) {
  const route = useRoute()

  // 筛选条件响应式状态
  const query = reactive({
    q: '',
    knowledgeBaseId: '',
    fileType: '',
    status: '',
    graphStatus: '',
    processingStage: '',
    tags: '',
    department: '',
    businessCategory: '',
    visibility: '' as '' | 'private' | 'department' | 'company',
    page: 1,
    pageSize: 15,
  })

  // 异步防抖搜索句柄
  let searchTimeout: ReturnType<typeof setTimeout>
  
  function onSearchInput() {
    clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => {
      query.page = 1
      void refreshListCallback()
    }, 350)
  }

  function resetFilters() {
    query.q = ''
    query.knowledgeBaseId = ''
    query.fileType = ''
    query.status = ''
    query.graphStatus = ''
    query.processingStage = ''
    query.tags = ''
    query.department = ''
    query.businessCategory = ''
    query.visibility = ''
    query.page = 1
    void refreshListCallback()
  }

  function applyRouteQuery() {
    const routeQuery = route.query
    query.q = typeof routeQuery.q === 'string' ? routeQuery.q : query.q
    query.knowledgeBaseId = typeof routeQuery.knowledgeBaseId === 'string' ? routeQuery.knowledgeBaseId : query.knowledgeBaseId
    query.fileType = typeof routeQuery.fileType === 'string' ? routeQuery.fileType : query.fileType
    query.status = typeof routeQuery.status === 'string' ? routeQuery.status : query.status
    query.graphStatus = typeof routeQuery.graphStatus === 'string' ? routeQuery.graphStatus : query.graphStatus
    query.processingStage = typeof routeQuery.processingStage === 'string' ? routeQuery.processingStage : query.processingStage
    query.tags = typeof routeQuery.tags === 'string' ? routeQuery.tags : query.tags
    query.department = typeof routeQuery.department === 'string' ? routeQuery.department : query.department
    query.businessCategory = typeof routeQuery.businessCategory === 'string' ? routeQuery.businessCategory : query.businessCategory
    if (routeQuery.visibility === 'private' || routeQuery.visibility === 'department' || routeQuery.visibility === 'company') {
      query.visibility = routeQuery.visibility
    }
  }

  return {
    query,
    onSearchInput,
    resetFilters,
    applyRouteQuery,
  }
}
