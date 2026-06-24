import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationMessage } from '@/conversation/entities/conversation-message.entity';
import { Conversation } from '@/conversation/entities/conversation.entity';
import { KnowledgeChunk } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import { Knowledge } from '@/knowledge/entities/knowledge.entity';

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
      assistantMessages,
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
      // P5: 机器人回答的引用字段拉取
      this.messageRepo.find({
        where: { role: 'assistant' },
        select: ['citations'],
      }),
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
    const totalAssistant = assistantMessages.length;
    let noCitationCount = 0;
    for (const msg of assistantMessages) {
      if (!msg.citations || (Array.isArray(msg.citations) && msg.citations.length === 0)) {
        noCitationCount++;
      }
    }
    const noCitationRate = totalAssistant > 0 ? parseFloat((noCitationCount / totalAssistant).toFixed(4)) : 0;

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
    };
  }

  private toLocalDateStr(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
