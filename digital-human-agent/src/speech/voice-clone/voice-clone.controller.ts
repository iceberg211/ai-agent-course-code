import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'node:path';
import { VoiceCloneService } from '@/speech/voice-clone/voice-clone.service';

const VOICE_CLONE_SAMPLE_MAX_FILE_SIZE = 20 * 1024 * 1024;
const VOICE_CLONE_SAMPLE_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac']);
const VOICE_CLONE_SAMPLE_MIME_PATTERN =
  /^audio\/(wav|x-wav|mpeg|mp3|mp4|aac|x-m4a)$/i;

function isSupportedVoiceSample(file: {
  originalname?: string;
  mimetype?: string;
}): boolean {
  const ext = extname(file.originalname ?? '').toLowerCase();
  const mime = String(file.mimetype ?? '').toLowerCase();
  return (
    VOICE_CLONE_SAMPLE_EXTENSIONS.has(ext) ||
    VOICE_CLONE_SAMPLE_MIME_PATTERN.test(mime)
  );
}

@ApiTags('voice-clone')
@Controller('voice-clone')
export class VoiceCloneController {
  constructor(private readonly voiceCloneService: VoiceCloneService) {}

  @Post(':personaId')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: VOICE_CLONE_SAMPLE_MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (isSupportedVoiceSample(file)) {
          cb(null, true);
          return;
        }
        cb(new BadRequestException('仅支持 wav/mp3/m4a/aac 语音样本'), false);
      },
    }),
  )
  @ApiOperation({ summary: '上传语音样本并发起克隆' })
  @ApiParam({ name: 'personaId', description: '角色 ID（UUID）' })
  async createVoice(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('请使用 file 字段上传语音样本');
    }
    return this.voiceCloneService.createVoice(personaId, file);
  }

  @Get(':personaId/status')
  @ApiOperation({ summary: '查询语音克隆状态' })
  @ApiParam({ name: 'personaId', description: '角色 ID（UUID）' })
  getStatus(@Param('personaId', ParseUUIDPipe) personaId: string) {
    return this.voiceCloneService.getStatus(personaId);
  }
}
