<template>
  <div class="flex flex-col gap-6 text-left">
    <!-- 顶部核心运营大盘 -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div class="p-4 border border-slate-200/60 rounded-xl bg-slate-50/50 flex flex-col gap-2">
        <span class="text-[11px] font-bold text-text-muted">已解析文档 (Docs)</span>
        <strong class="text-2xl font-black text-text-main">12 篇</strong>
        <small class="text-text-muted text-[10px]">成功率 100% · 无异常中断</small>
      </div>
      <div class="p-4 border border-slate-200/60 rounded-xl bg-slate-50/50 flex flex-col gap-2">
        <span class="text-[11px] font-bold text-text-muted">关联语义分片 (Chunks)</span>
        <strong class="text-2xl font-black text-text-main">846 段</strong>
        <small class="text-text-muted text-[10px]">Dense Vector: bge-large-zh</small>
      </div>
      <div class="p-4 border border-slate-200/60 rounded-xl bg-slate-50/50 flex flex-col gap-2">
        <span class="text-[11px] font-bold text-text-muted">最近 30 日检索频次</span>
        <strong class="text-2xl font-black text-text-main">1,420 次</strong>
        <small class="text-text-muted text-[10px]">平均相似度评分：0.78</small>
      </div>
      <div class="p-4 border border-slate-200/60 rounded-xl bg-slate-50/50 flex flex-col gap-2">
        <span class="text-[11px] font-bold text-text-muted">黄金用例回归覆盖率</span>
        <strong class="text-2xl font-black text-text-main">85%</strong>
        <small class="text-text-muted text-[10px]">共 15 条标准用例 · 成功 13 条</small>
      </div>
    </div>

    <!-- 快捷分析与指标趋势 -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="border border-slate-200/60 rounded-xl p-5 bg-white flex flex-col gap-3">
        <h4 class="m-0 text-xs font-bold text-text-main">文档类型分布统计</h4>
        <div class="flex items-center gap-6 py-4">
          <!-- 饼图卡片模拟 -->
          <div class="w-24 h-24 rounded-full border-[10px] border-primary flex items-center justify-center shrink-0" style="border-right-color: #10b981; border-bottom-color: #f59e0b;">
            <strong class="text-xs text-text-secondary">多模态</strong>
          </div>
          <div class="flex flex-col gap-1.5 text-xs text-text-secondary">
            <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded bg-primary"></span>PDF 文档（占 60%）</span>
            <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded bg-emerald-500"></span>Markdown/网页（占 30%）</span>
            <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded bg-amber-500"></span>音视频解析（占 10%）</span>
          </div>
        </div>
      </div>

      <div class="border border-slate-200/60 rounded-xl p-5 bg-white flex flex-col gap-4 text-left">
        <h4 class="m-0 text-xs font-bold text-text-main">知识库最近动态</h4>
        <div class="flex flex-col gap-3 text-xs text-text-secondary">
          <div class="flex gap-3 justify-between items-center pb-2.5 border-b border-slate-100">
            <span>系统管理员 录入了 <strong>公司2026财务制度.pdf</strong></span>
            <span class="text-text-muted text-[10px]">2小时前</span>
          </div>
          <div class="flex gap-3 justify-between items-center pb-2.5 border-b border-slate-100">
            <span>批量回归测试自动执行，通过率 <strong>86.6%</strong></span>
            <span class="text-text-muted text-[10px]">昨天</span>
          </div>
          <div class="flex gap-3 justify-between items-center">
            <span>文档 <strong>产品技术白皮书V4.pdf</strong> 重新生成分片</span>
            <span class="text-text-muted text-[10px]">3天前</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
