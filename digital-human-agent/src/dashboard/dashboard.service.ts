import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationMessage } from '@/conversation/entities/conversation-message.entity';
import { Conversation } from '@/conversation/entities/conversation.entity';
import { Notification } from '@/notification/entities/notification.entity';
import { DocumentTask } from '@/knowledge/entities/document-task.entity';
import { KnowledgeChunk } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import { Knowledge } from '@/knowledge/entities/knowledge.entity';
import { KnowledgeEvalCase } from '@/knowledge/entities/knowledge-eval-case.entity';

export interface RagHealthSummary {
  answerCount: number;
  noCitationAnswerCount: number;
  noCitationRate: number;
  lowRatedAnswerCount: number;
  downVoteRate: number;
  averageLatencyMs: number;
  averageRerankLatencyMs: number | null;
  permissionFilteredCount: number;
  fallbackToPgCount: number;
  degradedChannels: Array<{ channel: string; count: number }>;
  rrfFusionTraceCount: number;
  documentHealth: {
    total: number;
    failed: number;
    processing: number;
    multimodal: number;
    multimodalRate: number;
    graphFailed: number;
    unchunked: number;
  };
  taskHealth: {
    pending: number;
    running: number;
    failed: number;
  };
  evalSummary: {
    total: number;
    success: number;
    failed: number;
    unrun: number;
    reviewedPassed: number;
    reviewedFailed: number;
    unreviewed: number;
    hitAt1: number | null;
    hitAt3: number | null;
    recallAt5: number | null;
    recallAt10: number | null;
    avgRetrievalLatencyMs: number | null;
    avgRerankLatencyMs: number | null;
  };
  recentLowRatedAnswers: Array<{
    question: string;
    answer: string;
    answerId: string;
    conversationId: string;
    createdAt: Date;
    latencyMs: number | null;
  }>;
  recentFailedDocuments: KnowledgeDocument[];
  recentFailedTasks: DocumentTask[];
  recentNotifications: Notification[];
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Knowledge)
    private readonly knowledgeRepo: Repository<Knowledge>,
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepo: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepo: Repository<KnowledgeChunk>,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(ConversationMessage)
    private readonly messageRepo: Repository<ConversationMessage>,
    @InjectRepository(KnowledgeEvalCase)
    private readonly evalCaseRepo: Repository<KnowledgeEvalCase>,
    @InjectRepository(DocumentTask)
    private readonly taskRepo: Repository<DocumentTask>,
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
  ) {}

  async summary() {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);

    const [
      knowledgeBaseCount,
      documentCount,
      chunkCount,
      failedDocumentCount,
      conversationCount,
      messageCount,
      recentDocuments,
      recentConversations,
      failedDocs,
      hotQuestionsRaw,
      lowRatedRaw,
      citationStatsRaw,
      recentFailedDocuments,
      unchunkedDocumentCount,
      graphFailedDocumentCount,
      evalReviewStatsRaw,
    ] = await Promise.all([
      this.knowledgeRepo.count(),
      this.documentRepo.count(),
      this.chunkRepo.count(),
      this.documentRepo.count({ where: { status: 'failed' } }),
      this.conversationRepo.count(),
      this.messageRepo.count(),
      this.documentRepo.find({
        relations: ['knowledge'],
        order: { createdAt: 'DESC' },
        take: 5,
      }),
      this.conversationRepo.find({
        order: { updatedAt: 'DESC' },
        take: 5,
      }),
      // P5: 失败文档趋势
      this.documentRepo
        .createQueryBuilder('doc')
        .select(['doc.createdAt'])
        .where("doc.status = 'failed'")
        .andWhere('doc.createdAt >= :startDate', { startDate })
        .getMany(),
      // P5: 热门提问统计
      this.messageRepo
        .createQueryBuilder('msg')
        .select('TRIM(msg.content)', 'question')
        .addSelect('COUNT(*)', 'count')
        .where("msg.role = 'user'")
        .groupBy('TRIM(msg.content)')
        .orderBy('count', 'DESC')
        .limit(5)
        .getRawMany(),
      // P5: 点踩回答详情关联
      this.messageRepo
        .createQueryBuilder('answer')
        .innerJoin(
          ConversationMessage,
          'question',
          'question.conversationId = answer.conversationId AND question.turnId = answer.turnId AND question.role = :userRole',
          { userRole: 'user' },
        )
        .select([
          'question.content AS question',
          'answer.content AS answer',
          'answer.id AS answerId',
          'answer.createdAt AS createdAt',
        ])
        .where("answer.role = 'assistant'")
        .andWhere("answer.feedback = 'down'")
        .orderBy('answer.createdAt', 'DESC')
        .limit(5)
        .getRawMany(),
      // P5: 机器人回答引用统计，避免拉取全量消息到内存
      this.messageRepo
        .createQueryBuilder('citationMsg')
        .select('COUNT(*)', 'total')
        .addSelect(
          `SUM(CASE WHEN citationMsg.citations IS NULL OR jsonb_array_length(citationMsg.citations) = 0 THEN 1 ELSE 0 END)`,
          'noCitationCount',
        )
        .where("citationMsg.role = 'assistant'")
        .getRawOne(),
      this.documentRepo.find({
        relations: ['knowledge'],
        where: { status: 'failed' },
        order: { updatedAt: 'DESC' },
        take: 5,
      }),
      this.documentRepo.count({
        where: { status: 'completed', chunkCount: 0 },
      }),
      this.documentRepo.count({
        where: { graphSyncStatus: 'failed' },
      }),
      this.evalCaseRepo
        .createQueryBuilder('evalCase')
        .select('COUNT(*)', 'total')
        .addSelect(
          `SUM(CASE WHEN evalCase.user_review_status = 'passed' THEN 1 ELSE 0 END)`,
          'passed',
        )
        .getRawOne(),
    ]);

    // 1. 失败文档趋势折线数据构造
    const trendMap = new Map<string, number>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = this.toLocalDateStr(d);
      trendMap.set(dateStr, 0);
    }
    for (const doc of failedDocs) {
      const dateStr = this.toLocalDateStr(new Date(doc.createdAt));
      if (trendMap.has(dateStr)) {
        trendMap.set(dateStr, (trendMap.get(dateStr) ?? 0) + 1);
      }
    }
    const failedDocumentTrend = Array.from(trendMap.entries()).map(([date, count]) => ({
      date,
      count,
    }));

    // 2. 热门提问映射
    const hotQuestions = hotQuestionsRaw.map((row) => ({
      question: row.question,
      count: Number(row.count),
    }));

    // 3. 机器人无引用率计算
    const totalAssistant = Number(citationStatsRaw?.total ?? 0);
    const noCitationCount = Number(citationStatsRaw?.noCitationCount ?? 0);
    const noCitationRate =
      totalAssistant > 0
        ? parseFloat((noCitationCount / totalAssistant).toFixed(4))
        : 0;
    const evalTotal = Number(evalReviewStatsRaw?.total ?? 0);
    const evalPassed = Number(evalReviewStatsRaw?.passed ?? 0);
    const evalPassRate =
      evalTotal > 0 ? parseFloat((evalPassed / evalTotal).toFixed(4)) : 0;

    // 4. RAG 性能指标: 平均问答延迟
    const latencyRaw = await this.messageRepo
      .createQueryBuilder('msg')
      .select('AVG(msg.latencyMs)', 'avg')
      .where("msg.role = 'assistant'")
      .getRawOne();
    const averageLatencyMs = Math.round(Number(latencyRaw?.avg ?? 0));

    // 5. 文档指标: 多模态文档占比
    const multimodalDocsCount = await this.documentRepo
      .createQueryBuilder('doc')
      .where(
        "doc.mimeType LIKE 'image/%' OR doc.mimeType LIKE 'audio/%' OR doc.mimeType LIKE 'video/%'",
      )
      .getCount();
    const multimodalRate = documentCount > 0 ? parseFloat((multimodalDocsCount / documentCount).toFixed(4)) : 0;

    // 6. 文档指标: 平均处理耗时 (基于最近 50 条已完成文档)
    const completedDocs = await this.documentRepo.find({
      select: ['createdAt', 'updatedAt'],
      where: { status: 'completed' },
      take: 50,
    });
    const averageDocumentProcessTimeMs = completedDocs.length > 0
      ? Math.round(
          completedDocs.reduce((acc, doc) => acc + (doc.updatedAt.getTime() - doc.createdAt.getTime()), 0) /
          completedDocs.length
        )
      : 0;

    // 7. 权限指标: 被过滤的检索结果条数 & 越权访问拦截次数 (扫描最近 100 条回复的 Trace)
    const recentMessagesForAcl = await this.messageRepo.find({
      select: ['ragTrace', 'status', 'content'],
      where: { role: 'assistant' },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    let totalPermissionFilteredCount = 0;
    let blockedAccessCount = 0;
    for (const msg of recentMessagesForAcl) {
      if (msg.ragTrace) {
        const traces = (msg.ragTrace.retrievalTrace as any[]) || [];
        for (const tr of traces) {
          if (tr?.permissionFilter?.filtered) {
            totalPermissionFilteredCount += Number(tr.permissionFilter.filtered);
          }
        }
      }
      if (msg.status === 'failed' && (msg.content?.includes('无权') || msg.content?.includes('越权'))) {
        blockedAccessCount++;
      }
    }

    return {
      knowledgeBaseCount,
      documentCount,
      chunkCount,
      failedDocumentCount,
      conversationCount,
      messageCount,
      recentDocuments,
      recentConversations,
      failedDocumentTrend,
      hotQuestions,
      lowRatedAnswers: lowRatedRaw,
      noCitationRate,
      recentFailedDocuments,
      unchunkedDocumentCount,
      graphFailedDocumentCount,
      evalPassRate,
      averageLatencyMs,
      multimodalRate,
      averageDocumentProcessTimeMs,
      totalPermissionFilteredCount,
      blockedAccessCount,
    };
  }

  private toLocalDateStr(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  async ragHealth(): Promise<RagHealthSummary> {
    const [
      answerStatsRaw,
      lowRatedAnswerCount,
      documentCount,
      failedDocumentCount,
      processingDocumentCount,
      graphFailedDocumentCount,
      unchunkedDocumentCount,
      multimodalDocumentCount,
      pendingTaskCount,
      runningTaskCount,
      failedTaskCount,
      recentLowRatedAnswers,
      recentFailedDocuments,
      recentFailedTasks,
      recentNotifications,
      recentAssistantMessages,
      evalCases,
    ] = await Promise.all([
      this.messageRepo
        .createQueryBuilder('answerStats')
        .select('COUNT(*)', 'answerCount')
        .addSelect(
          `SUM(CASE WHEN answerStats.citations IS NULL OR jsonb_array_length(answerStats.citations) = 0 THEN 1 ELSE 0 END)`,
          'noCitationAnswerCount',
        )
        .addSelect('AVG(answerStats.latencyMs)', 'averageLatencyMs')
        .where("answerStats.role = 'assistant'")
        .getRawOne(),
      this.messageRepo.count({
        where: { role: 'assistant', feedback: 'down' },
      }),
      this.documentRepo.count(),
      this.documentRepo.count({ where: { status: 'failed' } }),
      this.documentRepo.count({ where: { status: 'processing' } }),
      this.documentRepo.count({ where: { graphSyncStatus: 'failed' } }),
      this.documentRepo.count({ where: { status: 'completed', chunkCount: 0 } }),
      this.documentRepo
        .createQueryBuilder('doc')
        .where(
          "doc.mimeType LIKE 'image/%' OR doc.mimeType LIKE 'audio/%' OR doc.mimeType LIKE 'video/%'",
        )
        .getCount(),
      this.taskRepo.count({ where: { status: 'pending' } }),
      this.taskRepo.count({ where: { status: 'running' } }),
      this.taskRepo.count({ where: { status: 'failed' } }),
      this.messageRepo
        .createQueryBuilder('answer')
        .innerJoin(
          ConversationMessage,
          'question',
          'question.conversationId = answer.conversationId AND question.turnId = answer.turnId AND question.role = :userRole',
          { userRole: 'user' },
        )
        .select([
          'question.content AS question',
          'answer.content AS answer',
          'answer.id AS "answerId"',
          'answer.conversationId AS "conversationId"',
          'answer.createdAt AS "createdAt"',
          'answer.latencyMs AS "latencyMs"',
        ])
        .where("answer.role = 'assistant'")
        .andWhere("answer.feedback = 'down'")
        .orderBy('answer.createdAt', 'DESC')
        .limit(8)
        .getRawMany(),
      this.documentRepo.find({
        relations: ['knowledge'],
        where: { status: 'failed' },
        order: { updatedAt: 'DESC' },
        take: 8,
      }),
      this.taskRepo.find({
        relations: ['document'],
        where: { status: 'failed' },
        order: { updatedAt: 'DESC' },
        take: 8,
      }),
      this.notificationRepo.find({
        order: { createdAt: 'DESC' },
        take: 8,
      }),
      this.messageRepo.find({
        select: ['ragTrace', 'latencyMs', 'citations', 'feedback', 'createdAt'],
        where: { role: 'assistant' },
        order: { createdAt: 'DESC' },
        take: 200,
      }),
      this.evalCaseRepo.find({
        select: [
          'lastRunStatus',
          'userReviewStatus',
          'lastRunHitAt1',
          'lastRunHitAt3',
          'lastRunRecallAt5',
          'lastRunRecallAt10',
          'lastRunRetrievalLatencyMs',
          'lastRunRerankLatencyMs',
        ],
      }),
    ]);

    const answerCount = Number(answerStatsRaw?.answerCount ?? 0);
    const noCitationAnswerCount = Number(
      answerStatsRaw?.noCitationAnswerCount ?? 0,
    );
    const averageLatencyMs = Math.round(
      Number(answerStatsRaw?.averageLatencyMs ?? 0),
    );
    const traceStats = this.extractTraceStats(recentAssistantMessages);
    const evalSummary = this.buildEvalSummary(evalCases);

    return {
      answerCount,
      noCitationAnswerCount,
      noCitationRate: this.ratio(noCitationAnswerCount, answerCount),
      lowRatedAnswerCount,
      downVoteRate: this.ratio(lowRatedAnswerCount, answerCount),
      averageLatencyMs,
      averageRerankLatencyMs: traceStats.averageRerankLatencyMs,
      permissionFilteredCount: traceStats.permissionFilteredCount,
      fallbackToPgCount: traceStats.fallbackToPgCount,
      degradedChannels: Array.from(traceStats.degradedChannels.entries())
        .map(([channel, count]) => ({ channel, count }))
        .sort((a, b) => b.count - a.count),
      rrfFusionTraceCount: traceStats.rrfFusionTraceCount,
      documentHealth: {
        total: documentCount,
        failed: failedDocumentCount,
        processing: processingDocumentCount,
        multimodal: multimodalDocumentCount,
        multimodalRate: this.ratio(multimodalDocumentCount, documentCount),
        graphFailed: graphFailedDocumentCount,
        unchunked: unchunkedDocumentCount,
      },
      taskHealth: {
        pending: pendingTaskCount,
        running: runningTaskCount,
        failed: failedTaskCount,
      },
      evalSummary,
      recentLowRatedAnswers,
      recentFailedDocuments,
      recentFailedTasks,
      recentNotifications,
    };
  }

  private extractTraceStats(messages: Pick<ConversationMessage, 'ragTrace'>[]) {
    let permissionFilteredCount = 0;
    let fallbackToPgCount = 0;
    let rrfFusionTraceCount = 0;
    const rerankLatencies: number[] = [];
    const degradedChannels = new Map<string, number>();

    for (const message of messages) {
      const trace = message.ragTrace ?? {};
      const retrievalTrace = Array.isArray(trace.retrievalTrace)
        ? trace.retrievalTrace
        : [];
      for (const item of retrievalTrace) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, any>;
        if (row.fallbackToPg) {
          fallbackToPgCount += 1;
          this.incrementMap(degradedChannels, 'vector_fallback');
        }
        if (Array.isArray(row.skippedChannels)) {
          for (const channel of row.skippedChannels) {
            this.incrementMap(degradedChannels, String(channel));
          }
        }
        if (Array.isArray(row.rrfFusion) && row.rrfFusion.length > 0) {
          rrfFusionTraceCount += 1;
        }
        const permissionFilter = row.permissionFilter;
        if (permissionFilter && typeof permissionFilter === 'object') {
          permissionFilteredCount += Number(permissionFilter.filtered ?? 0);
        }
      }

      const stageTrace = trace.stageTrace as Record<string, any> | undefined;
      if (stageTrace?.permissionFilter) {
        permissionFilteredCount += Number(
          stageTrace.permissionFilter.filtered ?? 0,
        );
      }
      if (typeof stageTrace?.rerankLatencyMs === 'number') {
        rerankLatencies.push(stageTrace.rerankLatencyMs);
      }
      const stageRrf = stageTrace?.rrfFusion;
      if (Array.isArray(stageRrf) && stageRrf.length > 0) {
        rrfFusionTraceCount += 1;
      }
      const degraded = Array.isArray(trace.degradedChannels)
        ? trace.degradedChannels
        : [];
      for (const channel of degraded) {
        if (!channel || typeof channel !== 'object') continue;
        this.incrementMap(
          degradedChannels,
          String((channel as Record<string, unknown>).channel ?? 'unknown'),
        );
      }
    }

    return {
      permissionFilteredCount,
      fallbackToPgCount,
      degradedChannels,
      rrfFusionTraceCount,
      averageRerankLatencyMs: this.average(rerankLatencies),
    };
  }

  private buildEvalSummary(evalCases: KnowledgeEvalCase[]): RagHealthSummary['evalSummary'] {
    const successCases = evalCases.filter(
      (item) => item.lastRunStatus === 'success',
    );
    return {
      total: evalCases.length,
      success: successCases.length,
      failed: evalCases.filter((item) => item.lastRunStatus === 'failed').length,
      unrun: evalCases.filter((item) => item.lastRunStatus === 'unrun').length,
      reviewedPassed: evalCases.filter(
        (item) => item.userReviewStatus === 'passed',
      ).length,
      reviewedFailed: evalCases.filter(
        (item) => item.userReviewStatus === 'failed',
      ).length,
      unreviewed: evalCases.filter(
        (item) => item.userReviewStatus === 'unreviewed',
      ).length,
      hitAt1: this.average(successCases.map((item) => item.lastRunHitAt1)),
      hitAt3: this.average(successCases.map((item) => item.lastRunHitAt3)),
      recallAt5: this.average(successCases.map((item) => item.lastRunRecallAt5)),
      recallAt10: this.average(
        successCases.map((item) => item.lastRunRecallAt10),
      ),
      avgRetrievalLatencyMs: this.average(
        successCases.map((item) => item.lastRunRetrievalLatencyMs),
      ),
      avgRerankLatencyMs: this.average(
        successCases.map((item) => item.lastRunRerankLatencyMs),
      ),
    };
  }

  private incrementMap(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  private average(values: Array<number | null | undefined>): number | null {
    const valid = values.filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value),
    );
    if (valid.length === 0) return null;
    return Number(
      (valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2),
    );
  }

  private ratio(value: number, total: number): number {
    if (total <= 0) return 0;
    return Number((value / total).toFixed(4));
  }
}
