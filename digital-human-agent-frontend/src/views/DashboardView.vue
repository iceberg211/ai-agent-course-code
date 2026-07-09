<template>
  <main class="p-6 bg-transparent flex flex-col gap-6 box-border w-full">
    <!-- 头部：清爽的 Title 和快捷操作 -->
    <header class="flex items-center justify-between gap-5 mb-1">
      <div class="dashboard__head-title">
        <h2 class="m-0 mb-1 text-xl font-extrabold text-text-main tracking-tight text-left">控制台大盘</h2>
        <p class="m-0 text-xs text-text-muted text-left">实时监控您的企业知识底座、问答效能与多模态安全审计指标</p>
      </div>
      <button class="inline-flex items-center gap-2 p-2.5 px-4.5 bg-gradient-to-br from-blue-500 to-blue-700 text-white border-none rounded-lg text-xs font-bold cursor-pointer shadow-btn transition-all duration-250 ease-out hover:-translate-y-[1.5px] hover:shadow-btn-hover hover:brightness-103 shrink-0" type="button" @click="router.push('/chat')">
        <MessageSquareIcon :size="14" />
        <span>发起数字人通话</span>
      </button>
    </header>

    <!-- 1. 系统组件运行状态监控 -->
    <section class="w-full bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-4.5 flex flex-col gap-3 text-left shadow-card">
      <div class="flex justify-between items-center">
        <div class="flex items-center gap-2">
          <ShieldAlertIcon v-if="!isSystemAllHealthy" :size="15" class="text-red-500 animate-bounce" />
          <ShieldCheckIcon v-else :size="15" class="text-emerald-500" />
          <strong class="text-xs font-bold text-text-main">三方系统服务连接状态</strong>
        </div>
        <button class="bg-transparent border-none text-primary text-[11px] font-bold cursor-pointer p-0 hover:underline" type="button" @click="loadData">
          重新检测
        </button>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div v-for="(probe, name) in systemHealth?.checks" :key="name" 
             class="flex flex-col gap-1 p-2.5 px-3 border rounded-lg bg-slate-50/50"
             :class="probe.status === 'ok' ? 'border-slate-200/60' : 'border-red-500/20 bg-red-500/5'"
        >
          <div class="flex items-center justify-between gap-1.5">
            <span class="text-[11px] font-extrabold text-text-secondary capitalize">{{ formatComponentName(name) }}</span>
            <span class="w-1.5 h-1.5 rounded-full"
                  :class="probe.status === 'ok' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'"
            />
          </div>
          <div class="flex items-baseline gap-1 mt-0.5">
            <strong class="text-xs text-text-main font-bold">
              {{ probe.status === 'ok' ? '运行中' : '故障' }}
            </strong>
            <span v-if="probe.latencyMs !== undefined" class="text-[9.5px] text-text-muted ml-1">
              {{ Math.round(probe.latencyMs) }}ms
            </span>
          </div>
          <span v-if="probe.message" class="text-[9px] text-red-500/80 truncate block w-full" :title="probe.message">
            {{ probe.message }}
          </span>
        </div>
        <div v-if="!systemHealth?.checks" class="col-span-6 py-2 text-center text-text-muted text-[11px]">
          正在获取系统健康指标...
        </div>
      </div>
    </section>

    <!-- 新手指引：快捷操作路径 (3列，每列 col-4) -->
    <section class="grid grid-cols-12 gap-6 w-full box-border" aria-label="快捷向导">
      <div class="flex flex-col items-start p-5 rounded-lg bg-white/70 border border-slate-200/60 cursor-pointer transition-all duration-250 ease-out hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_12px_28px_rgba(15,23,42,0.05)] text-left col-span-12 lg:col-span-4 group" @click="router.push('/documents')">
        <div class="flex items-center justify-center w-8 h-8 rounded-[9px] mb-3 bg-primary/8 text-primary">
          <PlusIcon :size="15" />
        </div>
        <div class="quick-card__info">
          <h4 class="m-0 mb-1.5 text-sm font-bold text-text-main">① 录入企业知识</h4>
          <p class="m-0 mb-3.5 text-xs text-text-muted leading-[1.55] min-h-[38px]">支持 PDF 及音视频，后台自动进行分片和解析入库任务。</p>
        </div>
        <span class="text-[11.5px] font-bold text-primary mt-auto transition-transform duration-200 group-hover:translate-x-0.5">立即导入 →</span>
      </div>

      <div class="flex flex-col items-start p-5 rounded-lg bg-white/70 border border-slate-200/60 cursor-pointer transition-all duration-250 ease-out hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_12px_28px_rgba(15,23,42,0.05)] text-left col-span-12 lg:col-span-4 group" @click="router.push('/search')">
        <div class="flex items-center justify-center w-8 h-8 rounded-[9px] mb-3 bg-purple-500/8 text-purple-600">
          <SearchIcon :size="15" />
        </div>
        <div class="quick-card__info">
          <h4 class="m-0 mb-1.5 text-sm font-bold text-text-main">② 检索关联资产</h4>
          <p class="m-0 mb-3.5 text-xs text-text-muted leading-[1.55] min-h-[38px]">实时调参，洞察多路 RRF 融合与重排 Trace 轨迹。</p>
        </div>
        <span class="text-[11.5px] font-bold text-primary mt-auto transition-transform duration-200 group-hover:translate-x-0.5">检索测试 →</span>
      </div>

      <div class="flex flex-col items-start p-5 rounded-lg bg-white/70 border border-slate-200/60 cursor-pointer transition-all duration-250 ease-out hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_12px_28px_rgba(15,23,42,0.05)] text-left col-span-12 lg:col-span-4 group" @click="router.push('/chat')">
        <div class="flex items-center justify-center w-8 h-8 rounded-[9px] mb-3 bg-teal-500/8 text-teal-600">
          <MessageSquareIcon :size="15" />
        </div>
        <div class="quick-card__info">
          <h4 class="m-0 mb-1.5 text-sm font-bold text-text-main">③ 数字人对话</h4>
          <p class="m-0 mb-3.5 text-xs text-text-muted leading-[1.55] min-h-[38px]">与您的专属 3D/2D 虚拟分身建立高拟真音视频通话。</p>
        </div>
        <span class="text-[11.5px] font-bold text-primary mt-auto transition-transform duration-200 group-hover:translate-x-0.5">建立连线 →</span>
      </div>
    </section>

    <!-- 2. 数据加载时的 Skeleton 骨架屏占位 -->
    <LoadingSkeleton v-if="loading && !summary" :rows="5" :row-height="110" label="正在加载系统指标" />

    <!-- 3. 数据拉取失败提示 -->
    <ErrorState
      v-else-if="!summary"
      title="首页大盘数据加载失败"
      description="可能由于本地后端连接中断，请检查服务状态后重试。"
      @retry="loadData"
    />

    <!-- 4. 实体仪表盘内容 -->
    <div v-else class="flex flex-col gap-6 w-full">
      <!-- 4 个精心设计的大版块核心指标卡片 (4列，每列 col-3) -->
      <section class="grid grid-cols-12 gap-6 w-full box-border" aria-label="核心指标看板">
        <!-- 卡片 1：知识库资产 -->
        <div class="flex flex-col p-4.5 px-5 bg-white/65 backdrop-blur-md border border-white/50 rounded-lg shadow-card transition-all duration-250 ease-out hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-card-hover text-left col-span-12 md:col-span-6 lg:col-span-3">
          <div class="flex justify-between items-center mb-3">
            <span class="text-[11px] font-bold text-text-muted uppercase tracking-[0.03em]">知识库资产</span>
            <LibraryIcon :size="15" class="text-blue-500" />
          </div>
          <div class="flex flex-col gap-2">
            <div class="flex items-baseline gap-1.5">
              <strong class="text-[28px] font-extrabold text-text-main leading-none">{{ summary?.knowledgeBaseCount ?? 0 }}</strong>
              <span class="text-[11px] font-bold text-text-secondary">个知识库</span>
            </div>
            <div class="text-[11.5px] text-text-muted flex gap-1.5 items-center">
              <span>文档：<strong class="text-text-secondary font-bold">{{ summary?.documentCount ?? 0 }}</strong> 篇</span>
              <span class="text-slate-200/80">|</span>
              <span>分片：<strong class="text-text-secondary font-bold">{{ summary?.chunkCount ?? 0 }}</strong> 段</span>
            </div>
          </div>
        </div>

        <!-- 卡片 2：会话与交互 -->
        <div class="flex flex-col p-4.5 px-5 bg-white/65 backdrop-blur-md border border-white/50 rounded-lg shadow-card transition-all duration-250 ease-out hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-card-hover text-left col-span-12 md:col-span-6 lg:col-span-3">
          <div class="flex justify-between items-center mb-3">
            <span class="text-[11px] font-bold text-text-muted uppercase tracking-[0.03em]">会话与交互</span>
            <MessageSquareIcon :size="15" class="text-teal-500" />
          </div>
          <div class="flex flex-col gap-2">
            <div class="flex items-baseline gap-1.5">
              <strong class="text-[28px] font-extrabold text-text-main leading-none">{{ summary?.conversationCount ?? 0 }}</strong>
              <span class="text-[11px] font-bold text-text-secondary">次会话</span>
            </div>
            <div class="text-[11.5px] text-text-muted flex gap-1.5 items-center">
              <span>消息总数：<strong class="text-text-secondary font-bold">{{ summary?.messageCount ?? 0 }}</strong> 条</span>
            </div>
          </div>
        </div>

        <!-- 卡片 3：检索与系统时延 -->
        <div class="flex flex-col p-4.5 px-5 bg-white/65 backdrop-blur-md border border-white/50 rounded-lg shadow-card transition-all duration-250 ease-out hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-card-hover text-left col-span-12 md:col-span-6 lg:col-span-3">
          <div class="flex justify-between items-center mb-3">
            <span class="text-[11px] font-bold text-text-muted uppercase tracking-[0.03em]">平均问答时延</span>
            <SparklesIcon :size="15" class="text-indigo-500" />
          </div>
          <div class="flex flex-col gap-2">
            <div class="flex items-baseline gap-1.5">
              <strong class="text-[28px] font-extrabold text-text-main leading-none">{{ formatLatency(summary?.averageLatencyMs) }}</strong>
              <span class="text-[11px] font-bold text-text-secondary">秒</span>
            </div>
            <div class="text-[11.5px] text-text-muted flex gap-1.5 items-center">
              <span>文档处理耗时：<strong class="text-text-secondary font-bold">{{ formatProcessTime(summary?.averageDocumentProcessTimeMs) }}</strong></span>
            </div>
          </div>
        </div>

        <!-- 卡片 4：安全隔离与健康 -->
        <div class="flex flex-col p-4.5 px-5 bg-white/65 backdrop-blur-md border border-white/50 rounded-lg shadow-card transition-all duration-250 ease-out hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-card-hover text-left col-span-12 md:col-span-6 lg:col-span-3" :class="{ 'border-red-500/25 bg-red-50/35 hover:border-red-500/45': (summary?.failedDocumentCount ?? 0) > 0 }">
          <div class="flex justify-between items-center mb-3">
            <span class="text-[11px] font-bold text-text-muted uppercase tracking-[0.03em]">安全与故障审计</span>
            <AlertCircleIcon :size="15" :class="(summary?.failedDocumentCount ?? 0) > 0 ? 'text-error' : 'text-success'" />
          </div>
          <div class="flex flex-col gap-2">
            <div class="flex items-baseline gap-1.5">
              <strong class="text-[28px] font-extrabold text-text-main leading-none">{{ summary?.failedDocumentCount ?? 0 }}</strong>
              <span class="text-[11px] font-bold text-text-secondary" :class="{ 'text-error': (summary?.failedDocumentCount ?? 0) > 0 }">篇解析失败</span>
            </div>
            <div class="text-[11.5px] text-text-muted flex gap-1.5 items-center">
              <span>拦截：<strong class="text-text-secondary font-bold">{{ summary?.blockedAccessCount ?? 0 }}</strong> 次</span>
              <span class="text-slate-200/80">|</span>
              <span>过滤：<strong class="text-text-secondary font-bold">{{ summary?.totalPermissionFilteredCount ?? 0 }}</strong> 段</span>
            </div>
          </div>
        </div>
      </section>

      <section v-if="ragHealth" class="grid grid-cols-12 gap-6 w-full box-border" aria-label="RAG 健康监控">
        <article class="bg-white/65 backdrop-blur-md border border-white/50 rounded-lg p-5 shadow-card flex flex-col min-h-0 transition-all duration-250 ease-out col-span-12">
          <header class="flex items-center justify-between mb-4 pb-3 border-b border-slate-200/50">
            <div>
              <h3 class="m-0 text-sm font-bold text-text-main">RAG 质量与运营监控</h3>
              <span class="text-[10.5px] text-text-muted">基于最近问答、检索 Trace、文档任务和评估集汇总</span>
            </div>
            <button class="bg-transparent border-none text-primary text-[11.5px] font-bold cursor-pointer p-0 hover:underline" type="button" @click="loadData">刷新指标</button>
          </header>

          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div class="flex flex-col gap-1.5 p-3.5 border border-slate-200/65 rounded-lg bg-slate-50/72 min-w-0" :class="{ 'border-amber-500/32 bg-amber-50/72': ragHealth.noCitationRate > 0.25 }">
              <span class="text-[11px] font-bold text-text-muted">无引用回答率</span>
              <strong class="text-2xl leading-none text-text-main">{{ percent(ragHealth.noCitationRate) }}</strong>
              <small class="text-text-muted text-[10.5px] whitespace-nowrap overflow-hidden text-ellipsis">{{ ragHealth.noCitationAnswerCount }} / {{ ragHealth.answerCount }} 条</small>
            </div>
            <div class="flex flex-col gap-1.5 p-3.5 border border-slate-200/65 rounded-lg bg-slate-50/72 min-w-0" :class="{ 'border-amber-500/32 bg-amber-50/72': ragHealth.lowRatedAnswerCount > 0 }">
              <span class="text-[11px] font-bold text-text-muted">低评分回答</span>
              <strong class="text-2xl leading-none text-text-main">{{ ragHealth.lowRatedAnswerCount }}</strong>
              <small class="text-text-muted text-[10.5px] whitespace-nowrap overflow-hidden text-ellipsis">点踩率 {{ percent(ragHealth.downVoteRate) }}</small>
            </div>
            <div class="flex flex-col gap-1.5 p-3.5 border border-slate-200/65 rounded-lg bg-slate-50/72 min-w-0">
              <span class="text-[11px] font-bold text-text-muted">平均问答时延</span>
              <strong class="text-2xl leading-none text-text-main">{{ formatLatency(ragHealth.averageLatencyMs) }}s</strong>
              <small class="text-text-muted text-[10.5px] whitespace-nowrap overflow-hidden text-ellipsis">Rerank {{ formatMs(ragHealth.averageRerankLatencyMs) }}</small>
            </div>
            <div class="flex flex-col gap-1.5 p-3.5 border border-slate-200/65 rounded-lg bg-slate-50/72 min-w-0" :class="{ 'border-amber-500/32 bg-amber-50/72': ragHealth.permissionFilteredCount > 0 }">
              <span class="text-[11px] font-bold text-text-muted">权限过滤片段</span>
              <strong class="text-2xl leading-none text-text-main">{{ ragHealth.permissionFilteredCount }}</strong>
              <small class="text-text-muted text-[10.5px] whitespace-nowrap overflow-hidden text-ellipsis">PG 降级 {{ ragHealth.fallbackToPgCount }} 次</small>
            </div>
            <div class="flex flex-col gap-1.5 p-3.5 border border-slate-200/65 rounded-lg bg-slate-50/72 min-w-0">
              <span class="text-[11px] font-bold text-text-muted">评估运行成功率</span>
              <strong class="text-2xl leading-none text-text-main">{{ percent(evalSuccessRate) }}</strong>
              <small class="text-text-muted text-[10.5px] whitespace-nowrap overflow-hidden text-ellipsis">{{ ragHealth.evalSummary.success }} / {{ ragHealth.evalSummary.total }} 条</small>
            </div>
            <div class="flex flex-col gap-1.5 p-3.5 border border-slate-200/65 rounded-lg bg-slate-50/72 min-w-0" :class="{ 'border-amber-500/32 bg-amber-50/72': ragHealth.taskHealth.failed > 0 }">
              <span class="text-[11px] font-bold text-text-muted">失败任务</span>
              <strong class="text-2xl leading-none text-text-main">{{ ragHealth.taskHealth.failed }}</strong>
              <small class="text-text-muted text-[10.5px] whitespace-nowrap overflow-hidden text-ellipsis">运行中 {{ ragHealth.taskHealth.running }}，待处理 {{ ragHealth.taskHealth.pending }}</small>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3.5">
            <section class="border border-slate-200/65 rounded-lg bg-white/62 p-3.5 min-w-0">
              <div class="flex justify-between items-center gap-2.5 mb-2.5">
                <strong class="text-xs text-text-secondary">降级通道</strong>
                <button class="bg-transparent border-none text-primary text-[11.5px] font-bold cursor-pointer p-0 hover:underline" type="button" @click="router.push('/search')">查看检索</button>
              </div>
              <ul v-if="ragHealth.degradedChannels.length" class="list-none p-0 m-0 flex flex-col gap-2">
                <li v-for="item in ragHealth.degradedChannels.slice(0, 5)" :key="item.channel" class="flex justify-between gap-3 items-center text-[11.5px] text-text-muted">
                  <span class="overflow-hidden whitespace-nowrap text-ellipsis">{{ degradedChannelLabel(item.channel) }}</span>
                  <strong class="shrink-0 text-text-secondary text-[11px]">{{ item.count }} 次</strong>
                </li>
              </ul>
              <p v-else class="m-0 min-h-[72px] flex items-center justify-center text-text-muted text-xs border border-dashed border-slate-200/65 rounded-lg">暂无检索降级记录</p>
            </section>

            <section class="border border-slate-200/65 rounded-lg bg-white/62 p-3.5 min-w-0">
              <div class="flex justify-between items-center gap-2.5 mb-2.5">
                <strong class="text-xs text-text-secondary">最近失败任务</strong>
                <button class="bg-transparent border-none text-primary text-[11.5px] font-bold cursor-pointer p-0 hover:underline" type="button" @click="router.push('/documents')">处理任务</button>
              </div>
              <ul v-if="ragHealth.recentFailedTasks.length" class="list-none p-0 m-0 flex flex-col gap-2">
                <li v-for="task in ragHealth.recentFailedTasks.slice(0, 5)" :key="task.id" class="flex justify-between gap-3 items-center text-[11.5px] text-text-muted">
                  <span class="overflow-hidden whitespace-nowrap text-ellipsis" :title="task.error || '处理失败'">{{ task.stage || 'failed' }}</span>
                  <strong class="shrink-0 text-text-secondary text-[11px]">{{ formatDateTime(task.updatedAt || task.updated_at) }}</strong>
                </li>
              </ul>
              <p v-else class="m-0 min-h-[72px] flex items-center justify-center text-text-muted text-xs border border-dashed border-slate-200/65 rounded-lg">暂无失败任务</p>
            </section>

            <section class="border border-slate-200/65 rounded-lg bg-white/62 p-3.5 min-w-0">
              <div class="flex justify-between items-center gap-2.5 mb-2.5">
                <strong class="text-xs text-text-secondary">最近通知</strong>
                <button class="bg-transparent border-none text-primary text-[11.5px] font-bold cursor-pointer p-0 hover:underline" type="button" @click="router.push('/profile')">个人中心</button>
              </div>
              <ul v-if="ragHealth.recentNotifications.length" class="list-none p-0 m-0 flex flex-col gap-2">
                <li v-for="notice in ragHealth.recentNotifications.slice(0, 5)" :key="notice.id" class="flex justify-between gap-3 items-center text-[11.5px] text-text-muted">
                  <span class="overflow-hidden whitespace-nowrap text-ellipsis" :title="notice.message || notice.title">{{ notice.title }}</span>
                  <strong class="shrink-0 text-text-secondary text-[11px]">{{ formatDateTime(notice.createdAt || notice.created_at) }}</strong>
                </li>
              </ul>
              <p v-else class="m-0 min-h-[72px] flex items-center justify-center text-text-muted text-xs border border-dashed border-slate-200/65 rounded-lg">暂无通知</p>
            </section>
          </div>
        </article>
      </section>

      <!-- 双栏近态跟踪列表 (2列，每列 col-6) -->
      <section class="grid grid-cols-12 gap-6 w-full box-border">
        <!-- 1. 最近上传文档 -->
        <article class="bg-white/65 backdrop-blur-md border border-white/50 rounded-lg p-5 shadow-card flex flex-col min-h-[280px] transition-all duration-250 ease-out col-span-12 lg:col-span-6">
          <header class="flex items-center justify-between mb-4 pb-3 border-b border-slate-200/50">
            <h3 class="m-0 text-sm font-bold text-text-main">最近录入文档</h3>
            <button class="bg-transparent border-none text-primary text-[11.5px] font-bold cursor-pointer p-0 hover:underline" type="button" @click="router.push('/documents')">查看全部</button>
          </header>
          <ul v-if="summary?.recentDocuments?.length" class="list-none m-0 p-0 flex flex-col gap-2.5">
            <li v-for="doc in summary.recentDocuments" :key="doc.id" class="flex items-center justify-between p-2.5 px-3.5 bg-slate-50/50 rounded-lg border border-slate-200/30">
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <FileTextIcon :size="13" class="text-text-muted shrink-0" />
                <span class="text-[12.5px] font-semibold text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap max-w-[150px] text-left" :title="doc.filename">{{ doc.filename }}</span>
              </div>
              <div class="flex items-center gap-2.5 shrink-0">
                <StatusBadge :status="doc.status" :label="statusLabelOf(doc)" />
                <span class="text-[10.5px] text-text-muted">{{ formatDate(doc.createdAt || doc.created_at) }}</span>
              </div>
            </li>
          </ul>
          <p v-else class="flex-1 flex items-center justify-center text-text-muted text-[12.5px] border border-dashed border-slate-200/60 rounded-lg m-0 min-h-[120px]">暂无最近录入的文档数据</p>
        </article>

        <!-- 2. 最近对话历史 -->
        <article class="bg-white/65 backdrop-blur-md border border-white/50 rounded-lg p-5 shadow-card flex flex-col min-h-[280px] transition-all duration-250 ease-out col-span-12 lg:col-span-6">
          <header class="flex items-center justify-between mb-4 pb-3 border-b border-slate-200/50">
            <h3 class="m-0 text-sm font-bold text-text-main">最近对话历史</h3>
            <button class="bg-transparent border-none text-primary text-[11.5px] font-bold cursor-pointer p-0 hover:underline" type="button" @click="router.push('/chat')">查看全部</button>
          </header>
          <ul v-if="summary?.recentConversations?.length" class="list-none m-0 p-0 flex flex-col gap-2.5">
            <li v-for="conv in summary.recentConversations" :key="conv.id" class="flex items-center justify-between p-2.5 px-3.5 bg-white border border-slate-200/60 rounded-lg cursor-pointer transition-all duration-200 hover:bg-slate-50/60 hover:border-primary/25 hover:translate-x-[1px]" @click="goChat(conv.id)">
              <div class="flex items-center gap-2.5 min-w-0 flex-1">
                <span class="text-[16px]">💬</span>
                <div class="flex flex-col min-w-0 text-left">
                  <strong class="text-[12.5px] font-semibold text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap" :title="conv.lastMessage?.content || '新对话'">
                    {{ conv.lastMessage?.content || '新对话' }}
                  </strong>
                  <span class="mt-0.5 text-[10.5px] text-text-muted">{{ formatDate(conv.updatedAt) }}</span>
                </div>
              </div>
              <ChevronRightIcon :size="13" class="text-text-muted shrink-0" />
            </li>
          </ul>
          <p v-else class="flex-1 flex items-center justify-center text-text-muted text-[12.5px] border border-dashed border-slate-200/60 rounded-lg m-0 min-h-[120px]">暂无近期对话历史</p>
        </article>
      </section>

      <!-- 下方辅助分析栏 (2列，每列 col-6) -->
      <section class="grid grid-cols-12 gap-6 w-full box-border">
        <!-- 3. 最近失败详情 -->
        <article class="bg-white/65 backdrop-blur-md border border-white/50 rounded-lg p-5 shadow-card flex flex-col min-h-[280px] transition-all duration-250 ease-out col-span-12 lg:col-span-6">
          <header class="flex items-center justify-between mb-4 pb-3 border-b border-slate-200/50">
            <h3 class="m-0 text-sm font-bold text-text-main">故障日志记录</h3>
            <button class="bg-transparent border-none text-primary text-[11.5px] font-bold cursor-pointer p-0 hover:underline" type="button" @click="goDocuments({ status: 'failed' })">查看详情</button>
          </header>
          <ul v-if="summary?.recentFailedDocuments?.length" class="list-none m-0 p-0 flex flex-col gap-2.5">
            <li v-for="doc in summary.recentFailedDocuments" :key="doc.id" class="flex items-center justify-between p-2.5 px-3.5 bg-slate-50/50 rounded-lg border border-slate-200/30">
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <AlertCircleIcon :size="13" class="text-error shrink-0" />
                <span class="text-[12.5px] font-semibold text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap max-w-[150px] text-left" :title="doc.filename">{{ doc.filename }}</span>
              </div>
              <span class="text-[10.5px] text-text-muted inline-block max-w-[50%] overflow-hidden text-ellipsis whitespace-nowrap text-right" :title="doc.processingError ?? doc.processing_error ?? '解析异常'">
                {{ doc.processingError ?? doc.processing_error ?? '处理失败' }}
              </span>
            </li>
          </ul>
          <p v-else class="flex-1 flex items-center justify-center text-text-muted text-[12.5px] border border-dashed border-slate-200/60 rounded-lg m-0 min-h-[120px]">近态无资产处理故障</p>
        </article>

        <!-- 4. 热门问题统计 -->
        <article class="bg-white/65 backdrop-blur-md border border-white/50 rounded-lg p-5 shadow-card flex flex-col min-h-[280px] transition-all duration-250 ease-out col-span-12 lg:col-span-6">
          <header class="flex items-center justify-between mb-4 pb-3 border-b border-slate-200/50">
            <h3 class="m-0 text-sm font-bold text-text-main">热门业务问题追踪</h3>
            <button class="bg-transparent border-none text-primary text-[11.5px] font-bold cursor-pointer p-0 hover:underline" type="button" @click="router.push('/chat')">发起提问</button>
          </header>
          <ul v-if="summary?.hotQuestions?.length" class="list-none m-0 p-0 flex flex-col gap-2.5">
            <li v-for="item in summary.hotQuestions" :key="item.question" class="flex items-center justify-between p-2.5 px-3.5 bg-white border border-slate-200/60 rounded-lg cursor-default">
              <div class="flex flex-col min-w-0 text-left">
                <strong class="text-[12.5px] font-semibold text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap">{{ item.question }}</strong>
                <span class="mt-0.5 text-[10.5px] text-text-muted">业务提问频次：出现 {{ item.count }} 次</span>
              </div>
            </li>
          </ul>
          <p v-else class="flex-1 flex items-center justify-center text-text-muted text-[12.5px] border border-dashed border-slate-200/60 rounded-lg m-0 min-h-[120px]">暂无高频提问统计</p>
        </article>
      </section>

      <!-- 5. 用户负反馈诊断 (仅管理员可见) -->
      <section v-if="summary?.lowRatedAnswers?.length" class="grid grid-cols-12 gap-6 w-full box-border" style="margin-top: 24px;">
        <article class="bg-white/65 backdrop-blur-md border border-white/50 rounded-lg p-5 shadow-card flex flex-col min-h-0 transition-all duration-250 ease-out col-span-12">
          <header class="flex items-center justify-between mb-4 pb-3 border-b border-slate-200/50">
            <div class="flex items-center gap-2">
              <h3 class="m-0">用户负反馈诊断 (Bad Cases)</h3>
              <span class="p-0.5 px-2 rounded-[6px] text-[10px] font-bold bg-red-50 text-red-700">低分回答</span>
            </div>
            <span class="text-[10.5px] text-text-muted">追踪用户点踩的回答并一键转化为评测回归用例</span>
          </header>
          <div class="overflow-x-auto w-full">
            <table class="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th scope="col" class="p-3 px-3.5 border-b border-slate-200/60 text-xs font-bold text-text-secondary w-1/4">提问 (Question)</th>
                  <th scope="col" class="p-3 px-3.5 border-b border-slate-200/60 text-xs font-bold text-text-secondary w-1/2">当时回答 (Answer)</th>
                  <th scope="col" class="p-3 px-3.5 border-b border-slate-200/60 text-xs font-bold text-text-secondary w-1/6">反馈时间</th>
                  <th scope="col" class="p-3 px-3.5 border-b border-slate-200/60 text-xs font-bold text-text-secondary w-1/12 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in summary.lowRatedAnswers" :key="item.answerId" class="hover:bg-slate-50/40">
                  <td class="p-3 px-3.5 border-b border-slate-200/40 text-xs text-text-secondary align-middle font-bold max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap" :title="item.question">
                    {{ item.question }}
                  </td>
                  <td class="p-3 px-3.5 border-b border-slate-200/40 text-[11.5px] text-text-muted align-middle max-w-[400px] overflow-hidden text-ellipsis whitespace-nowrap" :title="item.answer">
                    {{ item.answer }}
                  </td>
                  <td class="p-3 px-3.5 border-b border-slate-200/40 text-[10.5px] text-text-muted align-middle">
                    {{ formatDateTime(item.createdAt) }}
                  </td>
                  <td class="p-3 px-3.5 border-b border-slate-200/40 text-xs align-middle text-right">
                    <button class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-br from-blue-500 to-blue-700 text-white border-none rounded-md text-[10.5px] font-bold cursor-pointer hover:brightness-104 shadow-btn" type="button" @click="importToEval(item)">
                      <span>一键转评测</span>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircleIcon,
  ChevronRightIcon,
  FileTextIcon,
  LibraryIcon,
  MessageSquareIcon,
  SparklesIcon,
  SearchIcon,
  PlusIcon,
  ShieldCheckIcon,
  ShieldAlertIcon,
} from 'lucide-vue-next'
import { useProductizedKnowledge } from '@/hooks/useProductizedKnowledge'
import { KNOWLEDGE_DOCUMENT_STATUS_LABELS } from '@/common/constants'
import type { DashboardRagHealth, DashboardSummary, KnowledgeDocument } from '@/types'
import PageHeader from '@/components/common/PageHeader.vue'
import LoadingSkeleton from '@/components/common/LoadingSkeleton.vue'
import ErrorState from '@/components/common/ErrorState.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'

const router = useRouter()
const { getDashboardSummary, getDashboardRagHealth, getSystemHealth } = useProductizedKnowledge()

const summary = ref<DashboardSummary | null>(null)
const ragHealth = ref<DashboardRagHealth | null>(null)
const systemHealth = ref<any>(null)
const loading = ref(false)

const evalSuccessRate = computed(() => {
  const total = ragHealth.value?.evalSummary.total ?? 0
  if (!total) return 0
  return (ragHealth.value?.evalSummary.success ?? 0) / total
})

const isSystemAllHealthy = computed(() => {
  if (!systemHealth.value?.checks) return true
  return Object.values(systemHealth.value.checks).every((c: any) => c.status === 'ok')
})

async function loadData() {
  loading.value = true
  try {
    const [result, healthResult, systemHealthResult] = await Promise.all([
      getDashboardSummary(),
      getDashboardRagHealth(),
      getSystemHealth(),
    ])
    if (result) {
      summary.value = result
    }
    if (healthResult) {
      ragHealth.value = healthResult
    }
    if (systemHealthResult) {
      systemHealth.value = systemHealthResult
    }
  } finally {
    loading.value = false
  }
}

onMounted(loadData)

function statusLabelOf(doc: KnowledgeDocument): string {
  const status = doc.status || 'pending'
  return KNOWLEDGE_DOCUMENT_STATUS_LABELS[status] ?? status
}

// 格式化问答耗时（毫秒转秒）
function formatLatency(ms?: number): string {
  if (!ms) return '0.0'
  const seconds = ms / 1000
  return seconds.toFixed(2)
}

function formatMs(ms?: number | null): string {
  if (ms === undefined || ms === null) return '-'
  return `${Math.round(ms)}ms`
}

function goDocuments(query: Record<string, string>) {
  router.push({ path: '/documents', query })
}

// 百分比格式化
function percent(value?: number) {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0%'
  return `${Math.round(n * 100)}%`
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin}分钟前`
  
  const diffHrs = Math.floor(diffMin / 60)
  if (diffHrs < 24) return `${diffHrs}小时前`

  return `${date.getMonth() + 1}/${date.getDate()}`
}

// 文档处理耗时格式化
function formatProcessTime(ms?: number): string {
  if (!ms) return '暂无数据'
  let seconds = ms / 1000
  if (seconds > 3600) {
    seconds = seconds / 1000
  }
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes} 分 ${remainingSeconds} 秒`
}

function latestFailedTrendCount(): number {
  const trend = summary.value?.failedDocumentTrend ?? []
  return trend.length ? trend[trend.length - 1].count : (summary.value?.failedDocumentCount ?? 0)
}

function formatDateTime(val?: string) {
  if (!val) return '-'
  const d = new Date(val)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function importToEval(item: { question: string; answer: string }) {
  router.push({
    path: '/evaluation',
    query: {
      addQuestion: item.question,
      expectedAnswer: item.answer,
    },
  })
}

function degradedChannelLabel(channel: string) {
  const labels: Record<string, string> = {
    vector: '向量召回',
    keyword: '关键词召回',
    graph: '图谱召回',
    memory: '记忆召回',
    multimodal: '多模态召回',
    rerank: '重排',
    queryRewrite: '问题改写',
    vector_fallback: '向量降级 PG',
  }
  return labels[channel] ?? channel
}

function formatComponentName(name: string | number) {
  const key = String(name)
  const map: Record<string, string> = {
    postgres: 'PostgreSQL',
    elasticsearch: 'Elasticsearch',
    neo4j: 'Neo4j (图图谱)',
    redis: 'Redis (二级缓存)',
    minio: 'MinIO (文件对象存储)',
    worker: 'Worker (解析并发队列)',
  }
  return map[key] ?? key
}

function goChat(conversationId: string) {
  router.push({
    path: '/chat',
    query: { conversationId },
  })
}
</script>
