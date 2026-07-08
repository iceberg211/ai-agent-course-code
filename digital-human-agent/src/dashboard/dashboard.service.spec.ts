import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const mockKnowledgeRepo = {
    count: jest.fn().mockResolvedValue(10),
  };

  const mockDocumentRepo = {
    count: jest.fn().mockResolvedValue(100),
    find: jest.fn().mockImplementation((options) => {
      if (options?.where?.status === 'completed') {
        const now = Date.now();
        return Promise.resolve([
          {
            createdAt: new Date(now - 10000),
            updatedAt: new Date(now),
          },
        ]);
      }
      return Promise.resolve([{ id: 'doc-1', filename: '测试文档.md' }]);
    }),
    createQueryBuilder: jest.fn(),
  };

  const mockChunkRepo = {
    count: jest.fn().mockResolvedValue(2000),
  };

  const mockConversationRepo = {
    count: jest.fn().mockResolvedValue(50),
    find: jest.fn().mockResolvedValue([{ id: 'conv-1' }]),
  };

  const mockMessageRepo = {
    count: jest.fn().mockResolvedValue(300),
    find: jest.fn().mockImplementation((options) => {
      if (options?.where?.role === 'assistant') {
        return Promise.resolve([
          {
            ragTrace: {
              retrievalTrace: [{ permissionFilter: { filtered: 2 } }],
            },
            status: 'failed',
            content: '权限不足，无权访问该知识库。',
          },
        ]);
      }
      return Promise.resolve([]);
    }),
    createQueryBuilder: jest.fn(),
  };

  const mockEvalCaseRepo = {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
  };

  const mockTaskRepo = {
    count: jest.fn(),
    find: jest.fn(),
  };

  const mockNotificationRepo = {
    find: jest.fn(),
  };

  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DashboardService(
      mockKnowledgeRepo as never,
      mockDocumentRepo as never,
      mockChunkRepo as never,
      mockConversationRepo as never,
      mockMessageRepo as never,
      mockEvalCaseRepo as never,
      mockTaskRepo as never,
      mockNotificationRepo as never,
    );
  });

  it('summary() 应该返回基础汇总信息以及增强的失败趋势、热门问题、点踩问题、无引用占比、耗时指标和权限过滤指标', async () => {
    // 1. Mock 失败文档的 queryBuilder
    const mockFailedDocs = [
      { createdAt: new Date() }, // 今天
      { createdAt: new Date(Date.now() - 24 * 3600 * 1000) }, // 昨天
    ];

    mockDocumentRepo.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(mockFailedDocs),
      getCount: jest.fn().mockResolvedValue(20), // 20 个多模态文档
    });

    // 2. Mock 热门提问 & 平均延迟的 queryBuilder
    const mockHotQuestionsRaw = [
      { question: '如何部署？', count: '5' },
      { question: '支持哪些格式？', count: '3' },
    ];

    const hotMsgQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(mockHotQuestionsRaw),
      getRawOne: jest.fn().mockResolvedValue({ avg: '1200' }), // 平均时延
    };

    // 3. Mock 无引用率 SQL 聚合
    const citationStatsQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({
        total: '3',
        noCitationCount: '2',
      }),
    };

    // 4. Mock 点踩回答的 queryBuilder
    const mockLowRatedRaw = [
      {
        question: '不好用的提问',
        answer: '差劲的回答',
        answerId: 'ans-1',
        createdAt: new Date(),
      },
    ];
    const lowRatedQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(mockLowRatedRaw),
    };

    // queryBuilder 选择性模拟
    mockMessageRepo.createQueryBuilder.mockImplementation((alias) => {
      if (alias === 'msg') {
        return hotMsgQueryBuilder;
      }
      if (alias === 'answer') {
        return lowRatedQueryBuilder;
      }
      if (alias === 'citationMsg') {
        return citationStatsQueryBuilder;
      }
      return {};
    });

    const evalQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({
        total: '4',
        passed: '3',
      }),
    };
    mockEvalCaseRepo.createQueryBuilder.mockReturnValue(evalQueryBuilder);

    // 执行方法
    const result = await service.summary();

    // 基础校验
    expect(result.knowledgeBaseCount).toBe(10);
    expect(result.documentCount).toBe(100);
    expect(result.chunkCount).toBe(2000);
    expect(result.conversationCount).toBe(50);
    expect(result.messageCount).toBe(300);

    // 失败文档趋势折线校验 (最近 7 天)
    expect(result.failedDocumentTrend).toHaveLength(7);
    const todayObj = new Date();
    const todayStr = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`;
    const todayTrend = result.failedDocumentTrend.find((t) => t.date === todayStr);
    expect(todayTrend?.count).toBe(1);

    // 热门问题校验
    expect(result.hotQuestions).toEqual([
      { question: '如何部署？', count: 5 },
      { question: '支持哪些格式？', count: 3 },
    ]);

    // 点踩问题列表校验
    expect(result.lowRatedAnswers).toHaveLength(1);
    expect(result.lowRatedAnswers[0].question).toBe('不好用的提问');
    expect(result.lowRatedAnswers[0].answer).toBe('差劲的回答');

    // 无引用率占比校验 (总数 3，无引用 2，占比 2/3 ≈ 0.6667)
    expect(result.noCitationRate).toBe(0.6667);
    expect(result.evalPassRate).toBe(0.75);

    // 新增观测指标校验
    expect(result.averageLatencyMs).toBe(1200);
    expect(result.multimodalRate).toBe(0.2); // 20/100 = 0.2
    expect(result.averageDocumentProcessTimeMs).toBe(10000); // 10000ms = 10s
    expect(result.totalPermissionFilteredCount).toBe(2);
    expect(result.blockedAccessCount).toBe(1);
  });

  it('ragHealth() 应该聚合问答质量、任务健康、评估指标和最近告警', async () => {
    mockDocumentRepo.count.mockImplementation((options?: any) => {
      if (options?.where?.status === 'failed') return Promise.resolve(2);
      if (options?.where?.status === 'processing') return Promise.resolve(3);
      if (options?.where?.graphSyncStatus === 'failed') return Promise.resolve(1);
      if (options?.where?.chunkCount === 0) return Promise.resolve(4);
      return Promise.resolve(20);
    });
    mockDocumentRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(5),
    });
    mockTaskRepo.count.mockImplementation((options?: any) => {
      if (options?.where?.status === 'pending') return Promise.resolve(1);
      if (options?.where?.status === 'running') return Promise.resolve(2);
      if (options?.where?.status === 'failed') return Promise.resolve(3);
      return Promise.resolve(0);
    });
    mockTaskRepo.find.mockResolvedValue([{ id: 'task-1', status: 'failed' }]);
    mockNotificationRepo.find.mockResolvedValue([{ id: 'notice-1' }]);
    mockDocumentRepo.find.mockResolvedValue([{ id: 'doc-1', status: 'failed' }]);
    mockMessageRepo.count.mockResolvedValue(2);
    mockMessageRepo.find.mockResolvedValue([
      {
        ragTrace: {
          retrievalTrace: [
            {
              fallbackToPg: true,
              skippedChannels: ['graph'],
              permissionFilter: { filtered: 2 },
              rrfFusion: [{ chunkId: 'chunk-1' }],
            },
          ],
          stageTrace: {
            rerankLatencyMs: 42,
            permissionFilter: { filtered: 1 },
            rrfFusion: [{ chunkId: 'chunk-2' }],
          },
          degradedChannels: [{ channel: 'rerank' }],
        },
      },
    ]);

    const answerStatsQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({
        answerCount: '10',
        noCitationAnswerCount: '4',
        averageLatencyMs: '1500',
      }),
    };
    const lowRatedQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          question: '问题',
          answer: '回答',
          answerId: 'answer-1',
          conversationId: 'conv-1',
          createdAt: new Date(),
          latencyMs: 1500,
        },
      ]),
    };
    mockMessageRepo.createQueryBuilder.mockImplementation((alias) => {
      if (alias === 'answerStats') return answerStatsQueryBuilder;
      if (alias === 'answer') return lowRatedQueryBuilder;
      return {};
    });
    mockEvalCaseRepo.find.mockResolvedValue([
      {
        lastRunStatus: 'success',
        userReviewStatus: 'passed',
        lastRunHitAt1: 1,
        lastRunHitAt3: 1,
        lastRunRecallAt5: 0.8,
        lastRunRecallAt10: 1,
        lastRunRetrievalLatencyMs: 120,
        lastRunRerankLatencyMs: 42,
      },
      {
        lastRunStatus: 'failed',
        userReviewStatus: 'failed',
        lastRunHitAt1: null,
        lastRunHitAt3: null,
        lastRunRecallAt5: null,
        lastRunRecallAt10: null,
        lastRunRetrievalLatencyMs: null,
        lastRunRerankLatencyMs: null,
      },
    ]);

    const result = await service.ragHealth();

    expect(result.answerCount).toBe(10);
    expect(result.noCitationRate).toBe(0.4);
    expect(result.downVoteRate).toBe(0.2);
    expect(result.averageLatencyMs).toBe(1500);
    expect(result.permissionFilteredCount).toBe(3);
    expect(result.fallbackToPgCount).toBe(1);
    expect(result.rrfFusionTraceCount).toBe(2);
    expect(result.averageRerankLatencyMs).toBe(42);
    expect(result.documentHealth).toMatchObject({
      total: 20,
      failed: 2,
      processing: 3,
      multimodal: 5,
      multimodalRate: 0.25,
      graphFailed: 1,
      unchunked: 4,
    });
    expect(result.taskHealth).toEqual({ pending: 1, running: 2, failed: 3 });
    expect(result.evalSummary).toMatchObject({
      total: 2,
      success: 1,
      failed: 1,
      reviewedPassed: 1,
      reviewedFailed: 1,
      hitAt1: 1,
      recallAt5: 0.8,
      avgRetrievalLatencyMs: 120,
      avgRerankLatencyMs: 42,
    });
    expect(result.recentLowRatedAnswers).toHaveLength(1);
    expect(result.recentFailedTasks).toHaveLength(1);
    expect(result.recentNotifications).toHaveLength(1);
  });
});
