<template>
  <main class="document-list">
    <header class="page-head">
      <div>
        <h2>文档管理</h2>
        <p class="subtitle">统一查看和控制所有知识库中的文档解析、多模态资产与数据安全隔离</p>
      </div>
      <button v-if="canUploadDocuments" class="btn-primary" type="button" @click="openUploadModal(null)">
        <PlusIcon :size="15" />
        上传文档 & 新建任务
      </button>
    </header>

    <!-- 联合筛选区 -->
    <section class="filters-panel" aria-label="筛选面板">
      <div class="filters-grid">
        <label class="filter-field search-box">
          <span>搜索文档</span>
          <input
            v-model="query.q"
            type="text"
            placeholder="输入文件名模糊搜索…"
            @input="onSearchInput"
          />
        </label>

        <label class="filter-field">
          <span>所属知识库</span>
          <select v-model="query.knowledgeBaseId" @change="refreshList">
            <option value="">全部知识库</option>
            <option v-for="kb in kbs" :key="kb.id" :value="kb.id">
              {{ kb.name }}
            </option>
          </select>
        </label>

        <label class="filter-field">
          <span>文件类型</span>
          <select v-model="query.fileType" @change="refreshList">
            <option value="">全部类型</option>
            <option value="pdf">PDF</option>
            <option value="md">Markdown (.md)</option>
            <option value="txt">文本 (.txt)</option>
            <option value="video">视频文件</option>
            <option value="audio">音频文件</option>
          </select>
        </label>

        <label class="filter-field">
          <span>解析状态</span>
          <select v-model="query.status" @change="refreshList">
            <option value="">全部状态</option>
            <option value="pending">排队中</option>
            <option value="processing">处理中</option>
            <option value="completed">就绪</option>
            <option value="failed">失败</option>
          </select>
        </label>

        <label class="filter-field">
          <span>图谱同步</span>
          <select v-model="query.graphStatus" @change="refreshList">
            <option value="">全部状态</option>
            <option value="pending">排队中</option>
            <option value="indexed">已同步</option>
            <option value="failed">同步失败</option>
            <option value="skipped">已跳过</option>
          </select>
        </label>

        <label class="filter-field">
          <span>处理阶段</span>
          <select v-model="query.processingStage" @change="refreshList">
            <option value="">全部阶段</option>
            <option value="uploaded">已上传</option>
            <option value="parsing">解析中</option>
            <option value="chunking">分片中</option>
            <option value="embedding">向量写入中</option>
            <option value="keyword_indexing">关键词索引中</option>
            <option value="graph_indexing">图谱同步中</option>
            <option value="completed">完成</option>
            <option value="failed">失败</option>
          </select>
        </label>

        <label class="filter-field">
          <span>可见范围</span>
          <select v-model="query.visibility" @change="refreshList">
            <option value="">全部范围</option>
            <option value="company">全公司</option>
            <option value="department">本部门</option>
            <option value="private">仅作者</option>
          </select>
        </label>

        <label class="filter-field">
          <span>部门</span>
          <input v-model="query.department" type="text" placeholder="输入部门" @input="onSearchInput" />
        </label>

        <label class="filter-field">
          <span>业务分类</span>
          <input v-model="query.businessCategory" type="text" placeholder="输入分类" @input="onSearchInput" />
        </label>

        <label class="filter-field">
          <span>标签</span>
          <input v-model="query.tags" type="text" placeholder="多个标签用逗号分隔" @input="onSearchInput" />
        </label>
      </div>

      <div class="filters-actions">
        <button class="btn-reset" type="button" @click="resetFilters">
          重置筛选
        </button>
      </div>
    </section>

    <!-- 列表展示区 -->
    <section class="list-section">
      <div v-if="kbApi.documentsLoading.value && items.length === 0" class="state-placeholder">
        <div class="spinner"></div>
        <p>正在拉取文档清单…</p>
      </div>

      <div v-else-if="items.length === 0" class="state-placeholder">
        <FileTextIcon :size="28" class="placeholder-icon" />
        <p>没有找到符合筛选条件的文档</p>
        <button v-if="canUploadDocuments" class="btn-ghost" type="button" @click="openUploadModal(null)">上传第一个文档</button>
      </div>

      <div v-else class="table-container">
        <table class="doc-table">
          <thead>
            <tr>
              <th scope="col">文档名称</th>
              <th scope="col">所属知识库</th>
              <th scope="col">大小/类型</th>
              <th scope="col">版本与安全</th>
              <th scope="col">解析状态</th>
              <th scope="col">图谱状态</th>
              <th scope="col">切片/资产</th>
              <th scope="col" class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="doc in items" :key="doc.id">
              <td class="cell-filename">
                <div class="filename-wrapper" :title="doc.filename" @click="inspectDetail(doc)">
                  <FileTextIcon :size="15" class="doc-icon" />
                  <strong>{{ doc.filename }}</strong>
                </div>
              </td>
              <td>
                <span class="kb-badge" :title="doc.knowledge?.name || '未知'">
                  {{ doc.knowledge?.name || '未知' }}
                </span>
              </td>
              <td>
                <span class="meta-desc">
                  {{ formatSize(doc.fileSize ?? doc.file_size) }} · {{ formatType(doc.filename) }}
                </span>
              </td>
              <td>
                <div class="version-acl-stack">
                  <span class="version-label">v{{ doc.version ?? 1 }}</span>
                  <span class="visibility-badge" :class="'vis--' + (doc.visibility || 'company')">
                    {{ doc.visibility === 'private' ? '仅作者' : doc.visibility === 'department' ? '本部门' : '全公司' }}
                  </span>
                  <span v-if="doc.securityLevel" class="security-level-pill">Level {{ doc.securityLevel }}</span>
                </div>
              </td>
              <td>
                <span class="status-indicator-pill" :class="statusClassOf(doc.status)">
                  {{ statusLabelOf(doc.status) }}
                  <span v-if="doc.processingStage || doc.processing_stage" class="stage-sub">
                    ({{ stageLabelOf(doc.processingStage || doc.processing_stage) }})
                  </span>
                </span>
              </td>
              <td>
                <span class="status-indicator-pill" :class="graphStatusClassOf(doc.graphSyncStatus || doc.graph_sync_status)">
                  {{ graphStatusLabelOf(doc.graphSyncStatus || doc.graph_sync_status) }}
                </span>
              </td>
              <td>
                <div class="assets-chunks-counter">
                  <span class="chunks-num">{{ doc.chunkCount ?? doc.chunk_count ?? 0 }} 段</span>
                  <span v-if="doc.assetCount" class="assets-num">{{ doc.assetCount }} 资源</span>
                </div>
              </td>
              <td class="text-right cell-actions">
                <button
                  class="action-btn"
                  title="查看详情与多模态资产"
                  type="button"
                  @click="inspectDetail(doc)"
                >
                  <EyeIcon :size="14" />
                </button>
                
                <button
                  v-if="isFailed(doc) && canRetryDocuments"
                  class="action-btn"
                  :title="canRetrySync(doc) ? '重试图谱与索引同步' : '重新上传原文件'"
                  type="button"
                  :disabled="retryingId === doc.id"
                  @click="handleFailedDocAction(doc)"
                >
                  <RefreshCwIcon :size="14" :class="{ 'spin-icon': retryingId === doc.id }" />
                </button>

                <button
                  class="action-btn"
                  title="查看处理任务"
                  type="button"
                  @click="openLatestTask(doc)"
                >
                  <ListChecksIcon :size="14" />
                </button>

                <button
                  class="action-btn"
                  title="去问答验证"
                  type="button"
                  @click="goToChatValidation(doc)"
                >
                  <MessageSquareIcon :size="14" />
                </button>

                <button
                  v-if="canDeleteDocuments"
                  class="action-btn action-btn--danger"
                  title="删除文档"
                  type="button"
                  @click="deleteDoc(doc)"
                >
                  <Trash2Icon :size="14" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- 分页 -->
        <footer class="pagination">
          <span class="pagination__info">共 {{ total }} 条记录</span>
          <div class="pagination__controls">
            <button
              :disabled="query.page === 1"
              class="pagination-btn"
              type="button"
              @click="changePage(query.page - 1)"
            >
              上一页
            </button>
            <span class="pagination-page">第 {{ query.page }} / {{ maxPage }} 页</span>
            <button
              :disabled="query.page >= maxPage"
              class="pagination-btn"
              type="button"
              @click="changePage(query.page + 1)"
            >
              下一页
            </button>
          </div>
        </footer>
      </div>
    </section>

    <!-- 上传文档抽屉 (Upload Drawer) -->
    <Teleport to="body">
      <div v-if="uploadOpen" class="modal-backdrop" @click.self="uploadOpen = false">
        <div class="drawer drawer--right">
          <header class="drawer-head">
            <h3>文档上传中心</h3>
            <button class="drawer-close" type="button" @click="uploadOpen = false">
              <XIcon :size="16" />
            </button>
          </header>

          <form class="drawer-body upload-form" @submit.prevent="submitUpload">
            <div class="field">
              <label class="label">目标知识库 <span class="required">*</span></label>
              <select v-model="uploadTargetKbId" required>
                <option value="" disabled>请选择要导入的知识库</option>
                <option v-for="kb in kbs" :key="kb.id" :value="kb.id">
                  {{ kb.name }}
                </option>
              </select>
            </div>

            <div class="field">
              <label class="label">选择文件 <span class="required">*</span></label>
              <div class="file-picker">
                <input
                  ref="fileInput"
                  type="file"
                  multiple
                  accept=".txt,.md,.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.mp3,.mp4"
                  required
                  @change="onFileSelected"
                />
                <div class="file-picker__dropzone" @click="triggerFileInput">
                  <UploadCloudIcon :size="24" class="picker-icon" />
                  <span v-if="selectedFiles.length === 1">{{ selectedFiles[0].name }} ({{ formatSize(selectedFiles[0].size) }})</span>
                  <span v-else-if="selectedFiles.length > 1">已选择 {{ selectedFiles.length }} 个文件</span>
                  <span v-else>支持文本、Office、网页、音视频或图片文件</span>
                </div>
              </div>
            </div>

            <!-- 数据隔离治理属性 -->
            <div class="section-divider">安全与数据治理</div>

            <div class="field-row">
              <div class="field">
                <label class="label">可见范围</label>
                <select v-model="uploadMetadata.visibility">
                  <option value="company">全公司可见 (Company)</option>
                  <option value="department">本部门可见 (Department)</option>
                  <option value="private">仅创建者可见 (Private)</option>
                </select>
              </div>

              <div class="field">
                <label class="label">安全级别 (SecurityLevel)</label>
                <select v-model.number="uploadMetadata.securityLevel">
                  <option :value="0">公开 (Level 0)</option>
                  <option :value="1">内部敏感 (Level 1)</option>
                  <option :value="2">核心极密 (Level 2)</option>
                </select>
              </div>
            </div>

            <div class="field">
              <label class="label">所属部门</label>
              <input type="text" v-model="uploadMetadata.department" placeholder="示例: R&D, HR" />
            </div>

            <div class="field">
              <label class="label">标签 (用英文逗号分隔)</label>
              <input type="text" v-model="tagString" placeholder="示例: 财务, 会计准则, 2026" />
            </div>

            <div class="field">
              <label class="label">业务分类 (Category)</label>
              <input type="text" v-model="uploadMetadata.category" placeholder="示例: 业务规范, 合同文本" />
            </div>

            <p v-if="uploadError" class="field-error">{{ uploadError }}</p>

            <div v-if="uploadQueue.length" class="upload-queue">
              <article v-for="item in uploadQueue" :key="item.localId" class="upload-queue-item">
                <div>
                  <strong>{{ item.filename }}</strong>
                  <span>{{ item.stageLabel }} · {{ item.progress }}%</span>
                </div>
                <div class="upload-queue-item__tail">
                  <button
                    v-if="item.taskId"
                    class="btn-ghost btn-sm"
                    type="button"
                    @click="openTaskDetail(item.taskId)"
                  >
                    详情
                  </button>
                  <span class="status-indicator-pill" :class="statusClassOf(item.status)">
                    {{ statusLabelOf(item.status) }}
                  </span>
                </div>
              </article>
            </div>

            <footer class="drawer-foot">
              <button class="btn-cancel" type="button" @click="uploadOpen = false">取消</button>
              <button
                class="btn-submit"
                type="submit"
                :disabled="kbApi.uploading.value || !uploadTargetKbId || selectedFiles.length === 0"
              >
                {{ kbApi.uploading.value ? '后台解析并构建图谱中…' : '开始导入' }}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- 完整的文档详情抽屉 (Document Details Drawer) -->
    <Teleport to="body">
      <div v-if="detailOpen && activeDoc" class="drawer-backdrop" @click.self="detailOpen = false">
        <aside class="drawer drawer--large drawer--right">
          <header class="drawer-head">
            <div class="drawer-title-stack">
              <h3>文档详情面板</h3>
              <p class="drawer-subtitle" :title="activeDoc.filename">{{ activeDoc.filename }}</p>
            </div>
            <button class="drawer-close" type="button" @click="detailOpen = false">
              <XIcon :size="16" />
            </button>
          </header>

          <div class="drawer-tabs">
            <button 
              v-for="t in detailTabs" 
              :key="t.key" 
              class="tab-btn" 
              :class="{ 'tab-btn--active': activeDetailTab === t.key }"
              @click="switchDetailTab(t.key)"
            >
              {{ t.label }}
            </button>
          </div>

          <div class="drawer-body">
            <!-- Tab 1: 基础属性 & 安全治理 -->
            <div v-if="activeDetailTab === 'info'" class="detail-info-pane">
              <div class="info-grid">
                <div class="info-item"><span class="lbl">文档 ID</span><span class="val font-mono">{{ activeDoc.id }}</span></div>
                <div class="info-item"><span class="lbl">所处阶段</span><span class="val"><span class="status-indicator-pill" :class="statusClassOf(activeDoc.status)">{{ statusLabelOf(activeDoc.status) }} ({{ stageLabelOf(activeDoc.processingStage || activeDoc.processing_stage) }})</span></span></div>
                <div class="info-item"><span class="lbl">大小/类型</span><span class="val">{{ formatSize(activeDoc.fileSize ?? activeDoc.file_size) }} ({{ formatType(activeDoc.filename) }})</span></div>
                <div class="info-item"><span class="lbl">入库时间</span><span class="val">{{ formatDateTime(activeDoc.createdAt || activeDoc.created_at) }}</span></div>
              </div>

              <!-- 权限及治理动态更新 -->
              <div class="section-divider">动态安全治理控制</div>
              <form @submit.prevent="saveGovernance" class="gov-form">
                <div class="field">
                  <label class="label">数据可见性范围 (Visibility)</label>
                  <select v-model="govForm.visibility">
                    <option value="company">全公司可见 (Company)</option>
                    <option value="department">本部门可见 (Department)</option>
                    <option value="private">仅上传者可见 (Private)</option>
                  </select>
                </div>
                <div class="field-row">
                  <div class="field">
                    <label class="label">安全密级</label>
                    <select v-model.number="govForm.securityLevel">
                      <option :value="0">公开 (Level 0)</option>
                      <option :value="1">内部敏感 (Level 1)</option>
                      <option :value="2">核心机密 (Level 2)</option>
                    </select>
                  </div>
                  <div class="field">
                    <label class="label">归属部门</label>
                    <input type="text" v-model="govForm.department" />
                  </div>
                </div>
                <div class="field">
                  <label class="label">标签列表 (逗号分隔)</label>
                  <input type="text" v-model="govForm.tags" />
                </div>
                <div class="field">
                  <label class="label">业务分类 (Category)</label>
                  <input type="text" v-model="govForm.category" />
                </div>
                <button v-if="canUploadDocuments" type="submit" class="btn-primary" :disabled="govSaving">
                  {{ govSaving ? '保存中…' : '应用安全设置' }}
                </button>
              </form>
            </div>

            <!-- Tab 2: Markdown 预览 -->
            <div v-if="activeDetailTab === 'markdown'" class="detail-markdown-pane">
              <div v-if="markdownLoading" class="loader-box">
                <div class="spinner"></div>
                <p>读取 Markdown 格式化排版中…</p>
              </div>
              <div v-else-if="!docMarkdown" class="empty-box">
                <p>解析产物暂时为空</p>
              </div>
              <div v-else class="markdown-preview-box">
                <pre class="md-raw">{{ docMarkdown }}</pre>
              </div>
            </div>

            <!-- Tab 3: 多模态解析资产 -->
            <div v-if="activeDetailTab === 'assets'" class="detail-assets-pane">
              <div v-if="assetsLoading" class="loader-box">
                <div class="spinner"></div>
                <p>提取多模态资产切片中…</p>
              </div>
              <div v-else-if="docAssets.length === 0" class="empty-box">
                <p>该文档无音视频或图片等多模态资产</p>
              </div>
              <div v-else class="assets-grid">
                <div v-for="asset in docAssets" :key="asset.id" class="asset-detail-card">
                  <div class="header">
                    <span class="badge" :class="'badge--' + asset.assetType">{{ asset.assetType }}</span>
                    <span class="font-mono text-muted">ID: {{ asset.id.slice(0, 8) }}</span>
                  </div>
                  
                  <!-- 资源主体展示 -->
                  <div class="body">
                    <!-- 图片预览 -->
                    <div v-if="asset.assetType === 'image'" class="image-box">
                      <img :src="asset.storageUrl || asset.storage_key" class="asset-img" />
                    </div>
                    <!-- 视频帧与时间戳 -->
                    <div v-else-if="asset.assetType === 'video'" class="video-box">
                      <img :src="asset.imageUrl" class="asset-img" />
                      <div class="time-tag">时间: {{ formatTime(asset.startMs) }} - {{ formatTime(asset.endMs) }}</div>
                    </div>
                    <!-- 音频 -->
                    <div v-else-if="asset.assetType === 'audio'" class="audio-box">
                      <audio controls :src="asset.storageUrl" class="mini-audio-player"></audio>
                    </div>

                    <!-- OCR 文字与描述 -->
                    <div class="caption-text" v-if="asset.ocrText || asset.ocr_text || asset.caption">
                      <strong>识别描述/OCR:</strong>
                      <p>{{ asset.ocrText || asset.ocr_text || asset.caption }}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Tab 4: 知识图谱实体与 Chunks -->
            <div v-if="activeDetailTab === 'chunks'" class="detail-chunks-pane">
              <div v-if="chunksLoading" class="loader-box">
                <div class="spinner"></div>
                <p>查询实体关联切片中…</p>
              </div>
              <ul v-else-if="chunks.length === 0" class="empty-box">
                <p>该文档尚未拆分切片</p>
              </ul>
              <ul v-else class="chunk-card-list">
                <li v-for="c in chunks" :key="c.id" class="chunk-card" :class="{ 'chunk-card--disabled': !c.enabled }">
                  <header class="chunk-card__head">
                    <span class="chunk-idx">§ {{ c.chunkIndex + 1 }}</span>
                    <span class="chunk-char">{{ c.content.length }} 字</span>
                    <label v-if="canUploadDocuments" class="toggle-switch">
                      <input type="checkbox" :checked="c.enabled" @change="toggleChunk(c)" />
                      <span class="toggle-label">{{ c.enabled ? '已启用' : '已禁用' }}</span>
                    </label>
                  </header>
                  <pre class="chunk-card__body">{{ c.content }}</pre>
                </li>
              </ul>
            </div>

            <!-- Tab 5: 版本历史与更替 -->
            <div v-if="activeDetailTab === 'history'" class="detail-history-pane">
              <div class="history-upload-section">
                <h4>更替上传新版本 (v{{ (activeDoc.version ?? 1) + 1 }})</h4>
                <div class="field">
                  <input type="file" @change="onVersionFileSelected" accept=".txt,.md,.pdf,.docx,.xlsx,.pptx" />
                  <button v-if="canUploadDocuments" class="btn-primary" :disabled="!versionFile || versionUploading" @click="submitVersionUpload">
                    {{ versionUploading ? '上传新版本中…' : '上传此版本' }}
                  </button>
                </div>
              </div>

              <div class="section-divider">版本迭代历史</div>
              <div v-if="versionsLoading" class="loader-box"><div class="spinner"></div></div>
              <ul v-else class="version-list">
                <li v-for="ver in docVersions" :key="ver.id" class="version-item" :class="{ 'is-current': ver.isCurrentVersion || ver.is_current_version }">
                  <div class="v-header">
                    <strong>Version v{{ ver.version ?? 1 }}</strong>
                    <span class="current-badge" v-if="ver.isCurrentVersion || ver.is_current_version">当前版本</span>
                    <span class="archived-badge" v-if="ver.archivedAt || ver.archived_at">已归档</span>
                  </div>
                  <div class="v-meta font-mono">
                    ID: {{ ver.id }} · 创建时间: {{ formatDateTime(ver.createdAt || ver.created_at) }}
                  </div>
                  <div class="v-actions" v-if="!ver.isCurrentVersion && !ver.is_current_version && !ver.archivedAt && !ver.archived_at">
                    <button v-if="canSetCurrentVersion" class="btn-secondary btn-sm" @click="switchCurrentVersion(ver)">设为当前版本</button>
                    <button v-if="canArchiveDocuments" class="btn-ghost btn-sm" @click="archiveVer(ver)">归档</button>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </aside>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="taskDetailOpen" class="drawer-backdrop" @click.self="taskDetailOpen = false">
        <aside class="drawer drawer--right">
          <header class="drawer-head">
            <div class="drawer-title-stack">
              <h3>处理任务详情</h3>
              <p class="drawer-subtitle">{{ activeTask?.id || '正在加载任务信息' }}</p>
            </div>
            <button class="drawer-close" type="button" @click="taskDetailOpen = false">
              <XIcon :size="16" />
            </button>
          </header>

          <div class="drawer-body task-detail-body">
            <div v-if="taskDetailLoading" class="loader-box">
              <div class="spinner"></div>
              <p>正在读取处理步骤…</p>
            </div>
            <template v-else-if="activeTask">
              <div class="task-summary-grid">
                <div class="info-item"><span class="lbl">任务状态</span><span class="val">{{ statusLabelOf(activeTask.status) }}</span></div>
                <div class="info-item"><span class="lbl">当前阶段</span><span class="val">{{ stageLabelOf(activeTask.stage) }}</span></div>
                <div class="info-item"><span class="lbl">进度</span><span class="val">{{ activeTask.progress ?? 0 }}%</span></div>
                <div class="info-item"><span class="lbl">开始时间</span><span class="val">{{ formatDateTime(activeTask.startedAt || activeTask.started_at || activeTask.createdAt || activeTask.created_at) }}</span></div>
                <div class="info-item"><span class="lbl">结束时间</span><span class="val">{{ formatDateTime(activeTask.finishedAt || activeTask.finished_at) }}</span></div>
              </div>

              <div v-if="activeTask.error" class="task-error">
                {{ activeTask.error }}
              </div>

              <ol class="task-step-list">
                <li v-for="step in activeTask.steps ?? []" :key="step.step" class="task-step">
                  <div class="task-step__head">
                    <strong>{{ taskStepLabelOf(step.step) }}</strong>
                    <span class="status-indicator-pill" :class="statusClassOf(step.status)">{{ statusLabelOf(step.status) }}</span>
                  </div>
                  <div class="task-step__meta">
                    <span>开始：{{ formatDateTime(step.startedAt || step.started_at) }}</span>
                    <span>结束：{{ formatDateTime(step.finishedAt || step.finished_at) }}</span>
                  </div>
                  <p v-if="step.error" class="task-step__error">{{ step.error }}</p>
                </li>
              </ol>
            </template>
            <div v-else class="empty-box">
              <p>没有找到处理任务</p>
            </div>
          </div>
        </aside>
      </div>
    </Teleport>
  </main>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  EyeIcon,
  FileTextIcon,
  ListChecksIcon,
  MessageSquareIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadCloudIcon,
  XIcon,
} from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { usePermissions } from '@/hooks/usePermissions'
import type { DocumentTaskItem, KnowledgeBase, KnowledgeChunk, KnowledgeDocumentDetail } from '@/types'
import { KNOWLEDGE_DOCUMENT_STATUS_LABELS } from '@/common/constants'

const router = useRouter()
const route = useRoute()
const kbApi = useKnowledgeBase()
const kbStore = useKnowledgeBaseStore()
const permissionApi = usePermissions()

const items = ref<KnowledgeDocumentDetail[]>([])
const kbs = ref<KnowledgeBase[]>([])
const total = ref(0)
const retryingId = ref('')
const canUploadDocuments = computed(() => permissionApi.can('documents:upload'))
const canRetryDocuments = computed(() => permissionApi.can('documents:retry'))
const canDeleteDocuments = computed(() => permissionApi.can('documents:delete'))
const canArchiveDocuments = computed(() => permissionApi.can('documents:archive'))
const canSetCurrentVersion = computed(() => permissionApi.can('documents:version:set-current'))

// 筛选条件
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

const maxPage = computed(() => Math.max(1, Math.ceil(total.value / query.pageSize)))

// 异步防抖搜索
let searchTimeout: ReturnType<typeof setTimeout>
function onSearchInput() {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    query.page = 1
    refreshList()
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
  refreshList()
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

// 载入列表与基础数据
async function refreshList() {
  const res = await kbApi.listAllDocuments(query)
  items.value = res.items
  total.value = res.total
}

async function loadKbs() {
  const result = await kbApi.listAll()
  kbs.value = result
  kbStore.setList(result)
}

onMounted(() => {
  applyRouteQuery()
  void permissionApi.loadPermissions()
  loadKbs()
  refreshList()
})

function changePage(p: number) {
  if (p < 1 || p > maxPage.value) return
  query.page = p
  refreshList()
}

// 上传控制
const uploadOpen = ref(false)
const uploadTargetKbId = ref('')
const selectedFiles = ref<File[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const uploadError = ref('')
const tagString = ref('')

interface UploadQueueItem {
  localId: string
  filename: string
  taskId?: string
  status: string
  progress: number
  stageLabel: string
}
const uploadQueue = ref<UploadQueueItem[]>([])

const uploadMetadata = reactive({
  category: '',
  tags: [] as string[],
  department: '',
  visibility: 'private' as 'company' | 'department' | 'private',
  securityLevel: 0,
})

function openUploadModal(kbId: string | null) {
  uploadTargetKbId.value = kbId || ''
  selectedFiles.value = []
  uploadQueue.value = []
  uploadError.value = ''
  tagString.value = ''
  uploadMetadata.category = ''
  uploadMetadata.tags = []
  uploadMetadata.department = ''
  uploadMetadata.visibility = 'private'
  uploadMetadata.securityLevel = 0
  uploadOpen.value = true
}

function triggerFileInput() {
  fileInput.value?.click()
}

function onFileSelected(e: Event) {
  const target = e.target as HTMLInputElement
  selectedFiles.value = Array.from(target.files ?? [])
}

async function submitUpload() {
  if (!uploadTargetKbId.value || selectedFiles.value.length === 0) return
  uploadError.value = ''
  
  if (tagString.value.trim()) {
    uploadMetadata.tags = tagString.value.split(',').map((t) => t.trim()).filter(Boolean)
  }
  
  uploadQueue.value = selectedFiles.value.map((file, idx) => ({
    localId: `${Date.now()}-${idx}`,
    filename: file.name,
    status: 'pending',
    progress: 0,
    stageLabel: '等待上传',
  }))

  for (const [index, file] of selectedFiles.value.entries()) {
    const queueItem = uploadQueue.value[index]
    queueItem.status = 'running'
    queueItem.stageLabel = '上传中'
    try {
      const task = await kbApi.uploadDocumentTask(
        uploadTargetKbId.value,
        file,
        uploadMetadata,
        (percent) => {
          queueItem.progress = percent
        },
      )
      if (!task) {
        queueItem.status = 'failed'
        queueItem.stageLabel = '上传失败'
        uploadError.value = '部分文件上传失败，请查看队列状态。'
        continue
      }
      queueItem.taskId = task.id
      applyTaskToQueue(queueItem, task)
      void pollUploadTask(queueItem)
    } catch (err: any) {
      queueItem.status = 'failed'
      queueItem.stageLabel = '上传失败'
      uploadError.value = `上传失败：${err.message || '网络或权限错误'}`
    }
  }
  query.page = 1
  await refreshList()
}

function applyTaskToQueue(queueItem: UploadQueueItem, task: DocumentTaskItem) {
  queueItem.status = task.status
  queueItem.progress = task.progress ?? queueItem.progress
  queueItem.stageLabel = stageLabelOf(task.stage)
  if (task.error) queueItem.stageLabel = task.error
}

async function pollUploadTask(queueItem: UploadQueueItem) {
  if (!queueItem.taskId) return
  for (let i = 0; i < 30; i += 1) {
    if (queueItem.status === 'completed' || queueItem.status === 'failed') return
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const task = await kbApi.getDocumentTask(queueItem.taskId)
    if (task) {
      applyTaskToQueue(queueItem, task)
      if (task.status === 'completed') await refreshList()
    }
  }
}

const taskDetailOpen = ref(false)
const taskDetailLoading = ref(false)
const activeTask = ref<DocumentTaskItem | null>(null)

async function openTaskDetail(taskId: string) {
  taskDetailOpen.value = true
  taskDetailLoading.value = true
  try {
    activeTask.value = await kbApi.getDocumentTask(taskId)
  } finally {
    taskDetailLoading.value = false
  }
}

async function openLatestTask(doc: KnowledgeDocumentDetail) {
  taskDetailOpen.value = true
  taskDetailLoading.value = true
  activeTask.value = null
  try {
    const tasks = await kbApi.listDocumentTasks(doc.id)
    activeTask.value = tasks[0] ?? null
  } finally {
    taskDetailLoading.value = false
  }
}

// 删除控制
async function deleteDoc(doc: KnowledgeDocumentDetail) {
  const kbId = doc.knowledgeBaseId || doc.knowledge_base_id
  if (!kbId) return
  if (!confirm(`确定彻底删除文档「${doc.filename}」吗？对应的 Chunks 及图谱关系将一并物理删除。`)) return
  
  const ok = await kbApi.deleteDocument(kbId, doc.id)
  if (ok) {
    await refreshList()
  } else {
    alert('删除失败，请稍后重试。')
  }
}

function isFailed(doc: KnowledgeDocumentDetail): boolean {
  return doc.status === 'failed' || doc.graphSyncStatus === 'failed' || doc.graph_sync_status === 'failed'
}

function canRetrySync(doc: KnowledgeDocumentDetail): boolean {
  const count = doc.chunkCount ?? doc.chunk_count ?? 0
  return count > 0
}

async function handleFailedDocAction(doc: KnowledgeDocumentDetail) {
  const kbId = doc.knowledgeBaseId || doc.knowledge_base_id
  if (!kbId) return
  
  if (canRetrySync(doc)) {
    retryingId.value = doc.id
    try {
      const res = await kbApi.retryDocument(kbId, doc.id)
      if (res) {
        await refreshList()
      } else {
        alert('重试同步失败，请稍后尝试重新上传原始文件。')
      }
    } finally {
      retryingId.value = ''
    }
  } else {
    openUploadModal(kbId)
  }
}

function goToChatValidation(doc: KnowledgeDocumentDetail) {
  const kbId = doc.knowledgeBaseId || doc.knowledge_base_id
  router.push({
    path: '/chat',
    query: {
      knowledgeBaseId: kbId,
      openKnowledgeDrawer: '1',
    },
  })
}

// ==========================================
// 文档详情抽屉核心状态与方法
// ==========================================
const detailOpen = ref(false)
const activeDoc = ref<KnowledgeDocumentDetail | null>(null)
const activeDetailTab = ref('info')
const detailTabs = [
  { key: 'info', label: '基本信息与治理' },
  { key: 'markdown', label: 'Markdown 预览' },
  { key: 'assets', label: '多模态资产' },
  { key: 'chunks', label: '切片管理' },
  { key: 'history', label: '版本历史' },
]

const chunks = ref<KnowledgeChunk[]>([])
const chunksLoading = ref(false)
const docMarkdown = ref('')
const markdownLoading = ref(false)
const docAssets = ref<any[]>([])
const assetsLoading = ref(false)
const docVersions = ref<KnowledgeDocumentDetail[]>([])
const versionsLoading = ref(false)

// 安全治理表单
const govForm = reactive({
  visibility: 'company' as 'company' | 'department' | 'private',
  securityLevel: 0,
  department: '',
  tags: '',
  category: '',
})
const govSaving = ref(false)

async function inspectDetail(doc: KnowledgeDocumentDetail) {
  activeDoc.value = doc
  detailOpen.value = true
  activeDetailTab.value = 'info'
  
  // 初始化治理表单
  govForm.visibility = doc.visibility || 'company'
  govForm.securityLevel = doc.securityLevel ?? 0
  govForm.department = doc.department ?? ''
  govForm.tags = Array.isArray(doc.tags) ? doc.tags.join(',') : (doc.tags ?? '')
  govForm.category = doc.category ?? ''
}

async function switchDetailTab(key: string) {
  activeDetailTab.value = key
  const doc = activeDoc.value
  const kbId = doc?.knowledgeBaseId || doc?.knowledge_base_id
  if (!doc || !kbId) return

  if (key === 'chunks') {
    chunksLoading.value = true
    try {
      chunks.value = await kbApi.listChunks(kbId, doc.id)
    } finally {
      chunksLoading.value = false
    }
  } else if (key === 'markdown') {
    markdownLoading.value = true
    try {
      const res = await kbApi.getDocumentMarkdown(kbId, doc.id)
      docMarkdown.value = res?.markdown ?? ''
    } finally {
      markdownLoading.value = false
    }
  } else if (key === 'assets') {
    assetsLoading.value = true
    try {
      docAssets.value = await kbApi.listDocumentAssets(kbId, doc.id)
    } finally {
      assetsLoading.value = false
    }
  } else if (key === 'history') {
    versionsLoading.value = true
    try {
      docVersions.value = await kbApi.listDocumentVersions(kbId, doc.id)
    } finally {
      versionsLoading.value = false
    }
  }
}

async function toggleChunk(c: KnowledgeChunk) {
  const kbId = activeDoc.value?.knowledgeBaseId || activeDoc.value?.knowledge_base_id
  if (!kbId) return
  const next = !c.enabled
  const ok = await kbApi.setChunkEnabled(kbId, c.id, next)
  if (ok) {
    c.enabled = next
  }
}

async function saveGovernance() {
  const doc = activeDoc.value
  const kbId = doc?.knowledgeBaseId || doc?.knowledge_base_id
  if (!doc || !kbId) return
  govSaving.value = true
  try {
    const updated = await kbApi.updateDocumentGovernance(kbId, doc.id, {
      visibility: govForm.visibility,
      securityLevel: govForm.securityLevel,
      department: govForm.department,
      tags: govForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
      category: govForm.category,
    })
    if (updated) {
      activeDoc.value = updated
      alert('安全治理设置更新成功！')
      await refreshList()
    }
  } finally {
    govSaving.value = false
  }
}

// 版本更替文件上传
const versionFile = ref<File | null>(null)
const versionUploading = ref(false)

function onVersionFileSelected(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    versionFile.value = file
  }
}

async function submitVersionUpload() {
  const doc = activeDoc.value
  const kbId = doc?.knowledgeBaseId || doc?.knowledge_base_id
  if (!doc || !kbId || !versionFile.value) return
  versionUploading.value = true
  try {
    const res = await kbApi.uploadDocumentVersion(kbId, doc.id, versionFile.value)
    if (res) {
      alert('新版本上传完成，正在后台重新切分与建图！')
      versionFile.value = null
      await switchDetailTab('history')
      await refreshList()
    }
  } finally {
    versionUploading.value = false
  }
}

async function switchCurrentVersion(ver: KnowledgeDocumentDetail) {
  const doc = activeDoc.value
  const kbId = doc?.knowledgeBaseId || doc?.knowledge_base_id
  if (!doc || !kbId) return
  const res = await kbApi.setCurrentDocumentVersion(kbId, ver.id)
  if (res) {
    alert(`已切换当前版本为 v${ver.version ?? 1}`)
    await switchDetailTab('history')
    await refreshList()
  }
}

async function archiveVer(ver: KnowledgeDocumentDetail) {
  const doc = activeDoc.value
  const kbId = doc?.knowledgeBaseId || doc?.knowledge_base_id
  if (!doc || !kbId) return
  if (!confirm(`确定归档版本 v${ver.version ?? 1} 吗？`)) return
  const res = await kbApi.archiveDocument(kbId, ver.id)
  if (res) {
    alert(`版本 v${ver.version ?? 1} 已成功归档。`)
    await switchDetailTab('history')
    await refreshList()
  }
}

// 格式化函数
function formatSize(bytes?: number | null) {
  if (bytes == null) return '-'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function formatType(filename: string) {
  const ext = filename.split('.').pop()?.toUpperCase()
  return ext || '未知'
}

function formatDateTime(val?: string) {
  if (!val) return '-'
  const d = new Date(val)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatTime(ms?: number | null): string {
  if (ms == null) return '00:00'
  const sec = Math.floor(ms / 1000)
  const min = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function statusLabelOf(status?: string): string {
  if (status === 'running') return '处理中'
  if (status === 'skipped') return '已跳过'
  return KNOWLEDGE_DOCUMENT_STATUS_LABELS[status || 'pending'] ?? '未知'
}

function statusClassOf(status?: string): string {
  if (status === 'completed') return 'pill--success'
  if (status === 'failed') return 'pill--error'
  if (status === 'processing' || status === 'running' || status === 'pending') return 'pill--warning'
  return 'pill--secondary'
}

function graphStatusLabelOf(status?: string): string {
  if (status === 'indexed') return '已同步'
  if (status === 'failed') return '同步失败'
  if (status === 'skipped') return '已跳过'
  return '排队中'
}

function graphStatusClassOf(status?: string): string {
  if (status === 'indexed') return 'pill--success'
  if (status === 'failed') return 'pill--error'
  if (status === 'skipped') return 'pill--secondary'
  return 'pill--warning'
}

const stageLabels: Record<string, string> = {
  uploaded: '已上传',
  parsing: '多模态解析',
  chunking: '分片切分',
  embedding: '向量检索索引',
  keyword_indexing: '全文检索索引',
  graph_indexing: '知识图谱建图',
  completed: '成功',
  failed: '失败',
}

function stageLabelOf(stage?: string): string {
  return (stageLabels[stage || ''] ?? stage) || '排队'
}

function taskStepLabelOf(step?: string): string {
  const labels: Record<string, string> = {
    parse: '解析文件',
    index: '写入索引',
    graph_sync: '同步图谱',
  }
  return labels[step || ''] ?? step ?? '-'
}
</script>

<style scoped>
.document-list {
  padding: 32px 24px;
  height: 100%;
  overflow-y: auto;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.page-head h2 {
  margin: 0 0 4px;
  font-size: 24px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.02em;
}

.subtitle {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--primary-gradient, linear-gradient(135deg, #3b82f6, #2563eb));
  color: #fff;
  border: none;
  border-radius: var(--radius-md, 8px);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--shadow-btn);
  transition: all 0.2s ease;
}

.btn-primary:hover {
  filter: brightness(1.04);
  transform: translateY(-1px);
}

.btn-secondary {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
}

.btn-ghost {
  border: none;
  background: transparent;
  color: var(--primary);
  font-weight: 700;
  cursor: pointer;
}

.filters-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg, 12px);
}

.filters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.filter-field span {
  font-weight: 700;
}

.filter-field input,
.filter-field select {
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  background: #fff;
}

.btn-reset {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 12.5px;
  cursor: pointer;
}

.list-section {
  flex: 1;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg, 12px);
  overflow: hidden;
}

.table-container {
  overflow-x: auto;
}

.doc-table {
  width: 100%;
  border-collapse: collapse;
}

.doc-table th {
  text-align: left;
  padding: 14px 18px;
  border-bottom: 2px solid var(--border-muted);
  font-size: 12px;
  font-weight: 750;
  color: var(--text-secondary);
}

.doc-table td {
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-muted);
  font-size: 13px;
}

.cell-filename {
  cursor: pointer;
}

.filename-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filename-wrapper strong {
  font-weight: 700;
  color: var(--text);
}

.kb-badge {
  background: rgba(59, 130, 246, 0.08);
  color: var(--primary);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 700;
}

.meta-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.version-acl-stack {
  display: flex;
  gap: 6px;
  align-items: center;
}

.version-label {
  font-weight: 700;
  color: var(--text-muted);
  font-size: 11px;
}

.visibility-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10.5px;
  font-weight: 700;
}

.vis--company { background: #d1fae5; color: #065f46; }
.vis--department { background: #eff6ff; color: #1e40af; }
.vis--private { background: #fef3c7; color: #92400e; }

.security-level-pill {
  background: #fee2e2;
  color: #991b1b;
  font-size: 10px;
  font-weight: 750;
  padding: 2px 5px;
  border-radius: 4px;
}

.status-indicator-pill {
  display: inline-flex;
  flex-direction: column;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 700;
}

.stage-sub {
  font-size: 9px;
  font-weight: 600;
  opacity: 0.8;
}

.pill--success { background: rgba(16, 185, 129, 0.08); color: var(--success); }
.pill--error { background: rgba(239, 68, 68, 0.08); color: var(--error); }
.pill--warning { background: rgba(245, 158, 11, 0.08); color: var(--warning); }
.pill--secondary { background: rgba(100, 116, 139, 0.08); color: var(--text-secondary); }

.assets-chunks-counter {
  display: flex;
  gap: 6px;
}

.chunks-num {
  font-weight: 700;
  color: var(--text);
}

.assets-num {
  background: #f3e8ff;
  color: #6b21a8;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
}

.cell-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.action-btn {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.action-btn--danger {
  color: var(--error);
}

/* Modal and Drawer Backdrop */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: flex-end;
  z-index: 100;
}

.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: flex;
  justify-content: flex-end;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(4px);
}

.drawer {
  width: 480px;
  background: #fff;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 32px rgba(15, 23, 42, 0.12);
}

.drawer--large {
  width: 780px;
}

.drawer-head {
  padding: 24px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.drawer-head h3 {
  margin: 0;
  font-weight: 800;
}

.drawer-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

.drawer-close {
  border: none;
  background: transparent;
  cursor: pointer;
}

.drawer-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-muted);
  background: var(--surface-soft);
  padding: 0 16px;
}

.tab-btn {
  padding: 12px 16px;
  font-size: 13px;
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

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.upload-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}

.required {
  color: var(--error);
}

.file-picker__dropzone {
  border: 2px dashed var(--border);
  padding: 24px;
  border-radius: 8px;
  text-align: center;
  cursor: pointer;
  background: var(--surface-soft);
}

.picker-icon {
  margin-bottom: 8px;
  color: var(--text-muted);
}

.section-divider {
  font-size: 11px;
  font-weight: 750;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border-muted);
  padding-bottom: 6px;
  margin-top: 12px;
}

.field-error {
  margin: 0;
  color: var(--error);
  font-size: 12px;
}

.upload-queue {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.upload-queue-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-muted);
  border-radius: 8px;
  background: #f8fafc;
}

.upload-queue-item div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.upload-queue-item strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.upload-queue-item > div:first-child span {
  font-size: 11px;
  color: var(--text-muted);
}

.upload-queue-item__tail {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.drawer-foot {
  padding: 16px 24px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn-cancel {
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}

.btn-submit {
  padding: 8px 16px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

/* Detail Info Styles */
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 24px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-item .lbl {
  font-size: 11.5px;
  color: var(--text-muted);
  font-weight: 600;
}

.info-item .val {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text);
}

.gov-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 16px;
}

/* Chunks and Markdown Styles */
.chunk-card-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chunk-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  background: var(--surface-soft);
}

.chunk-card--disabled {
  opacity: 0.6;
}

.chunk-card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 8px;
}

.chunk-card__body {
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  color: var(--text-secondary);
}

.markdown-preview-box {
  background: #f8fafc;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  overflow-x: auto;
}

.md-raw {
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-wrap;
}

/* Assets tab */
.assets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.asset-detail-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.asset-detail-card .header {
  padding: 10px 14px;
  background: var(--surface-soft);
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}

.asset-detail-card .body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.asset-img {
  width: 100%;
  max-height: 160px;
  object-fit: cover;
  border-radius: 4px;
}

.time-tag {
  font-size: 11px;
  font-weight: 750;
  color: #6b21a8;
}

.mini-audio-player {
  width: 100%;
}

.caption-text {
  font-size: 11.5px;
  color: var(--text-secondary);
  background: #faf5ff;
  padding: 8px;
  border-radius: 4px;
}

/* Version History */
.history-upload-section {
  background: var(--surface-soft);
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  margin-bottom: 24px;
}

.history-upload-section h4 {
  margin: 0 0 10px;
  font-weight: 800;
}

.version-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.version-item {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #fff;
}

.version-item.is-current {
  border-color: rgba(59, 130, 246, 0.4);
  background: #eff6ff;
}

.v-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.current-badge {
  background: var(--primary);
  color: #fff;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 700;
}

.archived-badge {
  background: #64748b;
  color: #fff;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 700;
}

.v-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.v-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.btn-sm {
  min-height: 26px;
  padding: 4px 8px;
  font-size: 11px;
}

.task-detail-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.task-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.task-error,
.task-step__error {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  color: #991b1b;
  background: #fef2f2;
  font-size: 12px;
  line-height: 1.5;
}

.task-step-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
}

.task-step {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f8fafc;
}

.task-step__head,
.task-step__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.task-step__meta {
  color: var(--text-muted);
  font-size: 11px;
}

.loader-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px;
}

.spin-icon {
  animation: spin 1s linear infinite;
}
</style>
