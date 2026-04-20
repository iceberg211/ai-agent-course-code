import { Module } from '@nestjs/common';
import { VoiceCloneService } from '@/voice-clone/voice-clone.service';
import { VoiceCloneController } from '@/voice-clone/voice-clone.controller';
import { PersonaModule } from '@/persona/persona.module';

@Module({
  imports: [PersonaModule],
  providers: [VoiceCloneService],
  controllers: [VoiceCloneController],
  exports: [VoiceCloneService],
})
export class VoiceCloneModule {}
