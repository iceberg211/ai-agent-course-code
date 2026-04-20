import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { VoiceCloneService } from '@/voice-clone/voice-clone.service';

@ApiTags('voice-clone')
@Controller('voice-clone')
export class VoiceCloneController {
  constructor(private readonly voiceCloneService: VoiceCloneService) {}

  @Post(':personaId')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: '上传语音样本并发起克隆' })
  @ApiParam({ name: 'personaId', description: '角色 ID（UUID）' })
  async createVoice(
    @Param('personaId') personaId: string,
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
  getStatus(@Param('personaId') personaId: string) {
    return this.voiceCloneService.getStatus(personaId);
  }
}
