import { Readable } from 'node:stream';
import { DocumentTaskRunnerService } from './document-task-runner.service';

function createRepoMock() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    update: jest.fn(async () => ({ affected: 1 })),
  };
}

describe('DocumentTaskRunnerService', () => {
  let taskRepo: ReturnType<typeof createRepoMock>;
  let stepRepo: ReturnType<typeof createRepoMock>;
  let assetRepo: ReturnType<typeof createRepoMock>;
  let documentServiceMock: any;
  let configServiceMock: { get: jest.Mock };
  let storageProviderMock: {
    putObject: jest.Mock;
    getObject: jest.Mock;
  };
  let parserServiceMock: {
    parse: jest.Mock;
  };
  let runner: DocumentTaskRunnerService;

  beforeEach(() => {
    taskRepo = createRepoMock();
    stepRepo = createRepoMock();
    assetRepo = createRepoMock();

    configServiceMock = {
      get: jest.fn((key: string) => {
        if (key === 'S3_BUCKET') return 'test-bucket';
        return undefined;
      }),
    };

    storageProviderMock = {
      putObject: jest.fn().mockResolvedValue(undefined),
      getObject: jest.fn().mockImplementation(() => {
        const stream = new Readable();
        stream.push('mocked-markdown-content');
        stream.push(null);
        return Promise.resolve(stream);
      }),
    };

    documentServiceMock = {
      parseDocument: jest.fn().mockResolvedValue('mocked-markdown-content'),
      createDocument: jest.fn().mockResolvedValue({ id: 'doc-123' }),
      indexDocumentChunks: jest.fn().mockResolvedValue([
        { id: 'chunk-1', chunk_index: 0, content: 'mocked-markdown-content' },
      ]),
      syncGraphOnly: jest.fn().mockResolvedValue(undefined),
      listChunksByDocumentId: jest.fn().mockResolvedValue([]),
      findOneDocument: jest.fn().mockResolvedValue({ id: 'doc-123', graphSyncStatus: 'indexed' }),
      updateDocument: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    parserServiceMock = {
      parse: jest.fn().mockResolvedValue({
        markdown: 'mocked-markdown-content',
        assets: [
          {
            assetType: 'image',
            filename: 'img.png',
            mimeType: 'image/png',
            storageKey: 'key-123',
            caption: 'description',
            ocrText: 'extracted-text',
          },
        ],
        metadata: {},
      }),
    };

    runner = new DocumentTaskRunnerService(
      taskRepo as any,
      stepRepo as any,
      assetRepo as any,
      documentServiceMock as any,
      configServiceMock as any,
      storageProviderMock as any,
      parserServiceMock as any,
    );
  });

  it('全新任务应依次执行 parse、index 和 graph_sync，并更新状态及持久化 assets', async () => {
    const mockTask = {
      id: 'task-1',
      documentId: null,
      ingestRunId: 'run-1',
      checkpointData: null,
    };
    taskRepo.findOne.mockResolvedValue(mockTask);

    const mockSteps = [
      { step: 'parse', status: 'pending' },
      { step: 'index', status: 'pending' },
      { step: 'graph_sync', status: 'pending' },
    ];
    stepRepo.find.mockResolvedValue(mockSteps);

    await runner.runUploadIngestTask({
      taskId: 'task-1',
      knowledgeBaseId: 'kb-1',
      file: {
        originalname: 'demo.md',
        mimetype: 'text/markdown',
        buffer: Buffer.from('# content'),
        size: 9,
      },
      input: {},
    });

    // 1. 验证 task 状态流转
    expect(taskRepo.update).toHaveBeenCalledWith('task-1', expect.objectContaining({ status: 'running' }));
    expect(taskRepo.update).toHaveBeenCalledWith('task-1', expect.objectContaining({ status: 'completed', stage: 'completed', progress: 100 }));

    // 2. 验证 steps 的调用
    expect(parserServiceMock.parse).toHaveBeenCalled();
    expect(storageProviderMock.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'test-bucket',
        key: 'knowledge-bases/kb-1/markdown/run-1.md',
      }),
    );
    expect(documentServiceMock.createDocument).toHaveBeenCalled();
    expect(assetRepo.save).toHaveBeenCalled(); // 验证保存了图片资产
    expect(documentServiceMock.indexDocumentChunks).toHaveBeenCalled();
    expect(documentServiceMock.syncGraphOnly).toHaveBeenCalled();
  });

  it('当 parse 已完成时，重试应跳过 parse 步骤，直接进行 index 和 graph_sync', async () => {
    const mockTask = {
      id: 'task-1',
      documentId: 'doc-123',
      ingestRunId: 'run-1',
      checkpointData: { markdownStorageKey: 'knowledge-bases/kb-1/markdown/run-1.md' },
    };
    taskRepo.findOne.mockResolvedValue(mockTask);

    const mockSteps = [
      { step: 'parse', status: 'completed', checkpoint: { markdownStorageKey: 'knowledge-bases/kb-1/markdown/run-1.md' }, documentId: 'doc-123' },
      { step: 'index', status: 'pending' },
      { step: 'graph_sync', status: 'pending' },
    ];
    stepRepo.find.mockResolvedValue(mockSteps);

    await runner.runUploadIngestTask({
      taskId: 'task-1',
      knowledgeBaseId: 'kb-1',
      file: {
        originalname: 'demo.md',
        mimetype: 'text/markdown',
        buffer: Buffer.from('# content'),
        size: 9,
      },
      input: {},
    });

    // 验证 parse 没有被重复调用
    expect(parserServiceMock.parse).not.toHaveBeenCalled();
    expect(storageProviderMock.putObject).not.toHaveBeenCalled();
    expect(documentServiceMock.createDocument).not.toHaveBeenCalled();
    expect(assetRepo.save).not.toHaveBeenCalled();

    // 验证从 S3 读取了 markdown 内容，并继续进行 index 步骤
    expect(storageProviderMock.getObject).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'test-bucket',
        key: 'knowledge-bases/kb-1/markdown/run-1.md',
      }),
    );
    expect(documentServiceMock.indexDocumentChunks).toHaveBeenCalled();
    expect(documentServiceMock.syncGraphOnly).toHaveBeenCalled();
  });
});
