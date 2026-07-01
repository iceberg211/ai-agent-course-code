import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationMessage } from '@/conversation/entities/conversation-message.entity';
import { Conversation } from '@/conversation/entities/conversation.entity';
import { KnowledgeChunk } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import { Knowledge } from '@/knowledge/entities/knowledge.entity';
import { KnowledgeEvalCase } from '@/knowledge/entities/knowledge-eval-case.entity';

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
}
