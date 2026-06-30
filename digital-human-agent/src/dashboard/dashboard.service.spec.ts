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
});
