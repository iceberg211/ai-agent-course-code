import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { VoiceCloneController } from '@/speech/voice-clone/voice-clone.controller';
import { VoiceCloneService } from '@/speech/voice-clone/voice-clone.service';

describe('VoiceClone API (e2e)', () => {
  let app: INestApplication;
  const personaId = '44444444-4444-4444-8444-444444444444';
  const service = {
    createVoice: jest.fn(),
    getStatus: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [VoiceCloneController],
      providers: [
        {
          provide: VoiceCloneService,
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

  it('POST /voice-clone/:personaId 支持上传音频样本', async () => {
    service.createVoice.mockResolvedValue({
      personaId,
      status: 'training',
      voiceId: null,
    });

    const res = await request(app.getHttpServer())
      .post(`/voice-clone/${personaId}`)
      .attach('file', Buffer.from('audio'), {
        filename: 'sample.mp3',
        contentType: 'audio/mpeg',
      })
      .expect(201);

    expect(service.createVoice).toHaveBeenCalledWith(
      personaId,
      expect.objectContaining({
        originalname: 'sample.mp3',
        mimetype: 'audio/mpeg',
      }),
    );
    expect(res.body).toEqual({
      personaId,
      status: 'training',
      voiceId: null,
    });
  });

  it('POST /voice-clone/:personaId 不支持的文件类型返回 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/voice-clone/${personaId}`)
      .attach('file', Buffer.from('bad'), {
        filename: 'sample.txt',
        contentType: 'text/plain',
      })
      .expect(400);

    expect(service.createVoice).not.toHaveBeenCalled();
    expect(String(res.body.message)).toContain(
      '仅支持 wav/mp3/m4a/aac 语音样本',
    );
  });

  it('GET /voice-clone/:personaId/status 非 UUID 返回 400', async () => {
    await request(app.getHttpServer())
      .get('/voice-clone/not-a-uuid/status')
      .expect(400);
    expect(service.getStatus).not.toHaveBeenCalled();
  });
});
