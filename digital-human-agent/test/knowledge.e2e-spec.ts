import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { KnowledgeContentController } from '@/knowledge-content/knowledge-content.controller';
import { PersonaKnowledgeSearchController } from '@/knowledge-content/persona-knowledge-search.controller';
import { KnowledgeContentService } from '@/knowledge-content/knowledge-content.service';
import { KnowledgeController } from '@/knowledge/knowledge.controller';
import { KnowledgeService } from '@/knowledge/knowledge.service';
import { PersonaKnowledgeController } from '@/knowledge/persona-knowledge.controller';

describe('Knowledge API (e2e)', () => {
  let app: INestApplication;

  const kbId = '11111111-1111-4111-8111-111111111111';
  const docId = '22222222-2222-4222-8222-222222222222';
  const chunkId = '33333333-3333-4333-8333-333333333333';
  const personaId = '44444444-4444-4444-8444-444444444444';

  const knowledgeContentService = {
    ingestDocument: jest.fn(),
    listDocumentsByKnowledgeId: jest.fn(),
    deleteDocument: jest.fn(),
    listChunksByDocumentId: jest.fn(),
    updateChunkEnabled: jest.fn(),
    retrieveWithStages: jest.fn(),
    retrieveForPersona: jest.fn(),
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
        KnowledgeContentController,
        PersonaKnowledgeSearchController,
      ],
      providers: [
        {
          provide: KnowledgeContentService,
          useValue: knowledgeContentService,
        },
        {
          provide: KnowledgeService,
          useValue: knowledgeCatalogService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
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
        retrievalConfig: { threshold: 0.6, stage1TopK: 20, finalTopK: 5, rerank: true },
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
        retrievalConfig: { threshold: 0.6, stage1TopK: 20, finalTopK: 5, rerank: true },
      },
    ]);
  });

  it('POST /knowledge-bases/:kbId/documents 上传文档成功', async () => {
    knowledgeContentService.ingestDocument.mockResolvedValue({
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

    expect(knowledgeContentService.ingestDocument).toHaveBeenCalledWith(
      kbId,
      'readme.txt',
      '这是测试文档内容',
      expect.objectContaining({
        mimeType: 'text/plain',
        fileSize: expect.any(Number),
        category: 'faq',
      }),
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

    expect(knowledgeContentService.ingestDocument).not.toHaveBeenCalled();
    expect(res.body.message).toContain('缺少上传文件');
  });

  it('GET /knowledge-bases/:kbId/documents 返回文档列表', async () => {
    knowledgeContentService.listDocumentsByKnowledgeId.mockResolvedValue([
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
      knowledgeContentService.listDocumentsByKnowledgeId,
    ).toHaveBeenCalledWith(
      kbId,
    );
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
    knowledgeContentService.deleteDocument.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .delete(`/knowledge-bases/${kbId}/documents/${docId}`)
      .expect(200);

    expect(knowledgeContentService.deleteDocument).toHaveBeenCalledWith(docId);
  });

  it('GET /knowledge-bases/:kbId/documents/:docId/chunks 返回 chunk 列表', async () => {
    knowledgeContentService.listChunksByDocumentId.mockResolvedValue([
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
      knowledgeContentService.listChunksByDocumentId,
    ).toHaveBeenCalledWith(docId);
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
    knowledgeContentService.updateChunkEnabled.mockResolvedValue(undefined);

    const res = await request(app.getHttpServer())
      .patch(`/knowledge-bases/${kbId}/chunks/${chunkId}`)
      .send({ enabled: false })
      .expect(200);

    expect(knowledgeContentService.updateChunkEnabled).toHaveBeenCalledWith(
      chunkId,
      false,
    );
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
    knowledgeContentService.retrieveForPersona.mockResolvedValue([
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

    expect(knowledgeContentService.retrieveForPersona).toHaveBeenCalledWith(
      personaId,
      '产品如何部署？',
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
});
