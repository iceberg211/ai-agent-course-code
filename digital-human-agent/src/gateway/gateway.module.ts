import { Module } from '@nestjs/common';
import { ConversationGateway } from '@/gateway/conversation.gateway';
import { AgentModule } from '@/agent/agent.module';
import { AsrModule } from '@/asr/asr.module';
import { TtsModule } from '@/tts/tts.module';
import { ConversationModule } from '@/conversation/conversation.module';
import { PersonaModule } from '@/persona/persona.module';
import { DigitalHumanModule } from '@/digital-human/digital-human.module';
import { RealtimeSessionModule } from '@/realtime-session/realtime-session.module';
// Handlers
import { SessionHandler } from '@/gateway/handlers/session.handler';
import { AudioHandler } from '@/gateway/handlers/audio.handler';
import { TextHandler } from '@/gateway/handlers/text.handler';
import { InterruptHandler } from '@/gateway/handlers/interrupt.handler';
// Pipelines
import { AgentPipelineService } from '@/gateway/pipeline/agent-pipeline.service';
import { TtsPipelineService } from '@/gateway/pipeline/tts-pipeline.service';
import { SpeakPipelineService } from '@/gateway/pipeline/speak-pipeline.service';

@Module({
  imports: [
    AgentModule,
    AsrModule,
    TtsModule,
    ConversationModule,
    PersonaModule,
    DigitalHumanModule,
    RealtimeSessionModule,
  ],
  providers: [
    ConversationGateway,
    // Handlers
    SessionHandler,
    AudioHandler,
    TextHandler,
    InterruptHandler,
    // Pipelines
    AgentPipelineService,
    TtsPipelineService,
    SpeakPipelineService,
  ],
})
export class GatewayModule {}
