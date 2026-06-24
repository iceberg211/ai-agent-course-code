import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { KnowledgeDocumentController } from '@/knowledge/controllers/knowledge-document.controller';
import { KnowledgeSearchController } from '@/knowledge/controllers/knowledge-search.controller';
import { KnowledgeDocumentService } from '@/knowledge/services/document/knowledge-document.service';
import { KnowledgeSearchService } from '@/knowledge/services/retrieval/pipeline/knowledge-search.service';
import { KnowledgeController } from '@/knowledge/controllers/knowledge.controller';
import { KnowledgeService } from '@/knowledge/services/knowledge.service';
import { PersonaKnowledgeController } from '@/knowledge/controllers/persona-knowledge.controller';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';

describe('Knowledge API (e2e)', () => {
  let app: INestApplication;

  const kbId = '11111111-1111-4111-8111-111111111111';
  const docId = '22222222-2222-4222-8222-222222222222';
  const chunkId = '33333333-3333-4333-8333-333333333333';
  const personaId = '44444444-4444-4444-8444-444444444444';

  const knowledgeDocumentService = {
    parseAndIngestDocument: jest.fn(),
    listDocumentsByKnowledgeId: jest.fn(),
    deleteDocument: jest.fn(),
    deleteDocumentForKnowledge: jest.fn(),
    listDocumentsForKnowledge: jest.fn(),
    retryDocumentForKnowledge: jest.fn(),
    getChunkContextForKnowledge: jest.fn(),
    listChunksByDocumentId: jest.fn(),
    listChunksByKnowledgeDocument: jest.fn(),
    updateChunkEnabled: jest.fn(),
    updateChunkEnabledForKnowledge: jest.fn(),
  };

  const knowledgeSearchService = {
    retrieveForPersona: jest.fn(),
    retrieveForPersonaWithStages: jest.fn(),
    retrieveForPersonaWithDebug: jest.fn(),
    retrieveWithStages: jest.fn(),
  };

  const knowledgeCatalogService = {
    listAll: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    listForPersona: jest.fn(),
    listPersonaIdsForKnowledge: jest.fn(),
    attachPersona: jest.fn(),
    detachPersona: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        KnowledgeController,
        PersonaKnowledgeController,
        KnowledgeDocumentController,
        KnowledgeSearchController,
      ],
      providers: [
        {
          provide: KnowledgeDocumentService,
          useValue: knowledgeDocumentService,
        },
        {
          provide: KnowledgeSearchService,
          useValue: knowledgeSearchService,
        },
        {
          provide: KnowledgeService,
          useValue: knowledgeCatalogService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = { id: 'mock-user-id', username: 'mock-user', role: 'user' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /knowledge-bases 返回知识库列表', async () => {
    knowledgeCatalogService.listAll.mockResolvedValue([
      {
        id: kbId,
        name: '产品 FAQ',
        retrievalConfig: {
          threshold: 0.6,
          stage1TopK: 20,
          finalTopK: 5,
          rerank: true,
        },
      },
    ]);

    const res = await request(app.getHttpServer())
      .get('/knowledge-bases')
      .expect(200);

    expect(knowledgeCatalogService.listAll).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual([
      {
        id: kbId,
        name: '产品 FAQ',
        retrievalConfig: {
          threshold: 0.6,
          stage1TopK: 20,
          finalTopK: 5,
          rerank: true,
        },
      },
    ]);
  });

  it('POST /knowledge-bases/:kbId/documents 上传文档成功', async () => {
    knowledgeDocumentService.parseAndIngestDocument.mockResolvedValue({
      id: docId,
      knowledgeBaseId: kbId,
      filename: 'readme.txt',
      status: 'completed',
    });

    const res = await request(app.getHttpServer())
      .post(`/knowledge-bases/${kbId}/documents`)
      .field('category', 'faq')
      .attach('file', Buffer.from('这是测试文档内容'), {
        filename: 'readme.txt',
        contentType: 'text/plain',
      })
      .expect(201);

    expect(
      knowledgeDocumentService.parseAndIngestDocument,
    ).toHaveBeenCalledWith(
      kbId,
      expect.objectContaining({
        originalname: 'readme.txt',
        mimetype: 'text/plain',
        buffer: expect.any(Buffer),
      }),
      'faq',
    );
    expect(res.body).toEqual({
      id: docId,
      knowledgeBaseId: kbId,
      filename: 'readme.txt',
      status: 'completed',
    });
  });

  it('POST /knowledge-bases/:kbId/documents 缺少文件返回 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/knowledge-bases/${kbId}/documents`)
      .field('category', 'faq')
      .expect(400);

    expect(
      knowledgeDocumentService.parseAndIngestDocument,
    ).not.toHaveBeenCalled();
    expect(res.body.message).toContain('缺少上传文件');
  });

  it('POST /knowledge-bases/:kbId/documents 不支持的文件类型会在上传入口返回 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/knowledge-bases/${kbId}/documents`)
      .attach('file', Buffer.from('not text'), {
        filename: 'payload.exe',
        contentType: 'application/octet-stream',
      })
      .expect(400);

    expect(
      knowledgeDocumentService.parseAndIngestDocument,
    ).not.toHaveBeenCalled();
    expect(String(res.body.message)).toContain('仅支持 txt、md、pdf 文档上传');
  });

  it('GET /knowledge-bases/:kbId/documents 非 UUID 返回 400', async () => {
    await request(app.getHttpServer())
      .get('/knowledge-bases/not-a-uuid/documents')
      .expect(400);
    expect(
      knowledgeDocumentService.listDocumentsByKnowledgeId,
    ).not.toHaveBeenCalled();
  });

  it('GET /knowledge-bases/:kbId/documents 返回文档列表', async () => {
    knowledgeDocumentService.listDocumentsByKnowledgeId.mockResolvedValue([
      {
        id: docId,
        knowledgeBaseId: kbId,
        filename: 'intro.md',
        status: 'completed',
      },
    ]);

    const res = await request(app.getHttpServer())
      .get(`/knowledge-bases/${kbId}/documents`)
      .expect(200);

    expect(
      knowledgeDocumentService.listDocumentsByKnowledgeId,
    ).toHaveBeenCalledWith(kbId);
    expect(res.body).toEqual([
      {
        id: docId,
        knowledgeBaseId: kbId,
        filename: 'intro.md',
        status: 'completed',
      },
    ]);
  });

  it('DELETE /knowledge-bases/:kbId/documents/:docId 删除文档', async () => {
    knowledgeDocumentService.deleteDocumentForKnowledge.mockResolvedValue(
      undefined,
    );

    await request(app.getHttpServer())
      .delete(`/knowledge-bases/${kbId}/documents/${docId}`)
      .expect(200);

    expect(
      knowledgeDocumentService.deleteDocumentForKnowledge,
    ).toHaveBeenCalledWith(kbId, docId);
  });

  it('GET /knowledge-bases/:kbId/documents/:docId/chunks 返回 chunk 列表', async () => {
    knowledgeDocumentService.listChunksByKnowledgeDocument.mockResolvedValue([
      {
        id: chunkId,
        documentId: docId,
        chunkIndex: 0,
        content: '测试片段',
        enabled: true,
      },
    ]);

    const res = await request(app.getHttpServer())
      .get(`/knowledge-bases/${kbId}/documents/${docId}/chunks`)
      .expect(200);

    expect(
      knowledgeDocumentService.listChunksByKnowledgeDocument,
    ).toHaveBeenCalledWith(kbId, docId);
    expect(res.body).toEqual([
      {
        id: chunkId,
        documentId: docId,
        chunkIndex: 0,
        content: '测试片段',
        enabled: true,
      },
    ]);
  });

  it('PATCH /knowledge-bases/:kbId/chunks/:chunkId 切换 chunk 状态', async () => {
    knowledgeDocumentService.updateChunkEnabledForKnowledge.mockResolvedValue(
      undefined,
    );

    const res = await request(app.getHttpServer())
      .patch(`/knowledge-bases/${kbId}/chunks/${chunkId}`)
      .send({ enabled: false })
      .expect(200);

    expect(
      knowledgeDocumentService.updateChunkEnabledForKnowledge,
    ).toHaveBeenCalledWith(kbId, chunkId, false);
    expect(res.body).toEqual({ chunkId, enabled: false });
  });

  it('GET /personas/:personaId/knowledge-bases 返回已挂载知识库', async () => {
    knowledgeCatalogService.listForPersona.mockResolvedValue([
      {
        id: kbId,
        name: '产品 FAQ',
      },
    ]);

    const res = await request(app.getHttpServer())
      .get(`/personas/${personaId}/knowledge-bases`)
      .expect(200);

    expect(knowledgeCatalogService.listForPersona).toHaveBeenCalledWith(
      personaId,
    );
    expect(res.body).toEqual([
      {
        id: kbId,
        name: '产品 FAQ',
      },
    ]);
  });

  it('POST /personas/:personaId/knowledge-bases 挂载知识库', async () => {
    knowledgeCatalogService.attachPersona.mockResolvedValue(undefined);

    const res = await request(app.getHttpServer())
      .post(`/personas/${personaId}/knowledge-bases`)
      .send({ knowledgeBaseId: kbId })
      .expect(201);

    expect(knowledgeCatalogService.attachPersona).toHaveBeenCalledWith(
      personaId,
      kbId,
    );
    expect(res.body).toEqual({
      personaId,
      knowledgeBaseId: kbId,
      attached: true,
    });
  });

  it('DELETE /personas/:personaId/knowledge-bases/:kbId 解除挂载', async () => {
    knowledgeCatalogService.detachPersona.mockResolvedValue(undefined);

    const res = await request(app.getHttpServer())
      .delete(`/personas/${personaId}/knowledge-bases/${kbId}`)
      .expect(200);

    expect(knowledgeCatalogService.detachPersona).toHaveBeenCalledWith(
      personaId,
      kbId,
    );
    expect(res.body).toEqual({
      personaId,
      knowledgeBaseId: kbId,
      attached: false,
    });
  });

  it('POST /personas/:personaId/search 返回 persona 聚合检索结果', async () => {
    knowledgeSearchService.retrieveForPersona.mockResolvedValue([
      {
        id: chunkId,
        source: '产品 FAQ',
        chunk_index: 1,
        content: '这里是命中的知识片段',
        similarity: 0.92,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post(`/personas/${personaId}/search`)
      .send({ query: '产品如何部署？' })
      .expect(201);

    expect(knowledgeSearchService.retrieveForPersona).toHaveBeenCalledWith(
      personaId,
      '产品如何部署？',
      {
        rerank: undefined,
        threshold: undefined,
        retrievalLimit: undefined,
        rerankLimit: undefined,
      },
    );
    expect(res.body).toEqual({
      query: '产品如何部署？',
      results: [
        {
          id: chunkId,
          source: '产品 FAQ',
          chunk_index: 1,
          content: '这里是命中的知识片段',
          similarity: 0.92,
        },
      ],
    });
  });

  it('POST /personas/:personaId/search/stages 返回 persona 分阶段检索结果', async () => {
    knowledgeSearchService.retrieveForPersonaWithDebug.mockResolvedValue({
      query: '产品如何部署？',
      retrievalQuery: '产品如何部署？',
      retrievalQueries: [],
      rewrite: { changed: false },
      options: {},
      retrievalTrace: [],
      hybridChunks: [],
      rerankedChunks: [
        {
          id: chunkId,
          source: '产品 FAQ',
          chunk_index: 1,
          content: '这里是命中的知识片段',
          similarity: 0.92,
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .post(`/personas/${personaId}/search/stages`)
      .send({ query: '产品如何部署？' })
      .expect(201);

    expect(
      knowledgeSearchService.retrieveForPersonaWithDebug,
    ).toHaveBeenCalledWith(personaId, '产品如何部署？', {
      rerank: undefined,
      threshold: undefined,
      retrievalLimit: undefined,
      rerankLimit: undefined,
    });
    expect(res.body.rerankedChunks).toHaveLength(1);
  });
});
