import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { KnowledgeService } from '../src/knowledge/knowledge.service';
import { KnowledgeBaseController } from '../src/knowledge-base/knowledge-base.controller';
import { PersonaKnowledgeBaseController } from '../src/knowledge-base/persona-knowledge-base.controller';
import { KnowledgeBaseService } from '../src/knowledge-base/knowledge-base.service';

describe('KnowledgeBase API (e2e)', () => {
  let app: INestApplication;

  const kbId = '11111111-1111-4111-8111-111111111111';
  const docId = '22222222-2222-4222-8222-222222222222';
  const chunkId = '33333333-3333-4333-8333-333333333333';
  const personaId = '44444444-4444-4444-8444-444444444444';

  const knowledgeService = {
    ingestDocument: jest.fn(),
    listDocumentsByKb: jest.fn(),
    deleteDocument: jest.fn(),
    listChunksByDocumentId: jest.fn(),
    updateChunkEnabled: jest.fn(),
    retrieveWithStages: jest.fn(),
    retrieveForPersona: jest.fn(),
  };

  const kbService = {
    listAll: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    listKbsForPersona: jest.fn(),
    listPersonaIdsForKb: jest.fn(),
    attachPersona: jest.fn(),
    detachPersona: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KnowledgeBaseController, PersonaKnowledgeBaseController],
      providers: [
        {
          provide: KnowledgeService,
          useValue: knowledgeService,
        },
        {
          provide: KnowledgeBaseService,
          useValue: kbService,
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
    kbService.listAll.mockResolvedValue([
      {
        id: kbId,
        name: '产品 FAQ',
        retrievalConfig: { threshold: 0.6, stage1TopK: 20, finalTopK: 5, rerank: true },
      },
    ]);

    const res = await request(app.getHttpServer())
      .get('/knowledge-bases')
      .expect(200);

    expect(kbService.listAll).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual([
      {
        id: kbId,
        name: '产品 FAQ',
        retrievalConfig: { threshold: 0.6, stage1TopK: 20, finalTopK: 5, rerank: true },
      },
    ]);
  });

  it('POST /knowledge-bases/:kbId/documents 上传文档成功', async () => {
    knowledgeService.ingestDocument.mockResolvedValue({
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

    expect(knowledgeService.ingestDocument).toHaveBeenCalledWith(
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

    expect(knowledgeService.ingestDocument).not.toHaveBeenCalled();
    expect(res.body.message).toContain('缺少上传文件');
  });

  it('GET /knowledge-bases/:kbId/documents 返回文档列表', async () => {
    knowledgeService.listDocumentsByKb.mockResolvedValue([
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

    expect(knowledgeService.listDocumentsByKb).toHaveBeenCalledWith(kbId);
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
    knowledgeService.deleteDocument.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .delete(`/knowledge-bases/${kbId}/documents/${docId}`)
      .expect(200);

    expect(knowledgeService.deleteDocument).toHaveBeenCalledWith(docId);
  });

  it('GET /knowledge-bases/:kbId/documents/:docId/chunks 返回 chunk 列表', async () => {
    knowledgeService.listChunksByDocumentId.mockResolvedValue([
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

    expect(knowledgeService.listChunksByDocumentId).toHaveBeenCalledWith(docId);
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
    knowledgeService.updateChunkEnabled.mockResolvedValue(undefined);

    const res = await request(app.getHttpServer())
      .patch(`/knowledge-bases/${kbId}/chunks/${chunkId}`)
      .send({ enabled: false })
      .expect(200);

    expect(knowledgeService.updateChunkEnabled).toHaveBeenCalledWith(chunkId, false);
    expect(res.body).toEqual({ chunkId, enabled: false });
  });

  it('GET /personas/:personaId/knowledge-bases 返回已挂载知识库', async () => {
    kbService.listKbsForPersona.mockResolvedValue([
      {
        id: kbId,
        name: '产品 FAQ',
      },
    ]);

    const res = await request(app.getHttpServer())
      .get(`/personas/${personaId}/knowledge-bases`)
      .expect(200);

    expect(kbService.listKbsForPersona).toHaveBeenCalledWith(personaId);
    expect(res.body).toEqual([
      {
        id: kbId,
        name: '产品 FAQ',
      },
    ]);
  });

  it('POST /personas/:personaId/knowledge-bases 挂载知识库', async () => {
    kbService.attachPersona.mockResolvedValue(undefined);

    const res = await request(app.getHttpServer())
      .post(`/personas/${personaId}/knowledge-bases`)
      .send({ knowledgeBaseId: kbId })
      .expect(201);

    expect(kbService.attachPersona).toHaveBeenCalledWith(personaId, kbId);
    expect(res.body).toEqual({
      personaId,
      knowledgeBaseId: kbId,
      attached: true,
    });
  });

  it('DELETE /personas/:personaId/knowledge-bases/:kbId 解除挂载', async () => {
    kbService.detachPersona.mockResolvedValue(undefined);

    const res = await request(app.getHttpServer())
      .delete(`/personas/${personaId}/knowledge-bases/${kbId}`)
      .expect(200);

    expect(kbService.detachPersona).toHaveBeenCalledWith(personaId, kbId);
    expect(res.body).toEqual({
      personaId,
      knowledgeBaseId: kbId,
      attached: false,
    });
  });
});
