import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { KnowledgeController } from '../src/knowledge/knowledge.controller';
import { KnowledgeService } from '../src/knowledge/knowledge.service';

describe('Knowledge API (e2e)', () => {
  let app: INestApplication;
  const service = {
    ingestDocument: jest.fn(),
    listDocuments: jest.fn(),
    deleteDocument: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [
        {
          provide: KnowledgeService,
          useValue: service,
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

  it('POST /knowledge/:personaId/documents 上传文档成功', async () => {
    service.ingestDocument.mockResolvedValue({
      id: 'doc-1',
      personaId: 'persona-1',
      filename: 'readme.txt',
      status: 'completed',
    });

    const res = await request(app.getHttpServer())
      .post('/knowledge/persona-1/documents')
      .field('category', 'faq')
      .attach('file', Buffer.from('这是测试文档内容'), 'readme.txt')
      .expect(201);

    expect(service.ingestDocument).toHaveBeenCalledWith(
      'persona-1',
      'readme.txt',
      '这是测试文档内容',
      'faq',
    );
    expect(res.body).toEqual({
      id: 'doc-1',
      personaId: 'persona-1',
      filename: 'readme.txt',
      status: 'completed',
    });
  });

  it('GET /knowledge/:personaId/documents 返回文档列表', async () => {
    service.listDocuments.mockResolvedValue([
      {
        id: 'doc-2',
        filename: 'intro.md',
        status: 'completed',
      },
    ]);

    const res = await request(app.getHttpServer())
      .get('/knowledge/persona-1/documents')
      .expect(200);

    expect(service.listDocuments).toHaveBeenCalledWith('persona-1');
    expect(res.body).toEqual([
      {
        id: 'doc-2',
        filename: 'intro.md',
        status: 'completed',
      },
    ]);
  });

  it('DELETE /knowledge/:personaId/documents/:docId 删除文档', async () => {
    service.deleteDocument.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .delete('/knowledge/persona-1/documents/doc-3')
      .expect(200);

    expect(service.deleteDocument).toHaveBeenCalledWith('doc-3');
  });
});
