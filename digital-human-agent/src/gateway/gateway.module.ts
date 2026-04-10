import { Module } from '@nestjs/common';
import { ConversationGateway } from './conversation.gateway';
import { AgentModule } from '../agent/agent.module';
import { AsrModule } from '../asr/asr.module';
import { TtsModule } from '../tts/tts.module';
import { ConversationModule } from '../conversation/conversation.module';
import { PersonaModule } from '../persona/persona.module';
import { DigitalHumanModule } from '../digital-human/digital-human.module';
import { RealtimeSessionModule } from '../realtime-session/realtime-session.module';
// Handlers
import { SessionHandler } from './handlers/session.handler';
import { AudioHandler } from './handlers/audio.handler';
import { TextHandler } from './handlers/text.handler';
import { InterruptHandler } from './handlers/interrupt.handler';
import { WebRtcHandler } from './handlers/webrtc.handler';
// Pipelines
import { AgentPipelineService } from './pipeline/agent-pipeline.service';
import { TtsPipelineService } from './pipeline/tts-pipeline.service';
import { SpeakPipelineService } from './pipeline/speak-pipeline.service';

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
    WebRtcHandler,
    // Pipelines
    AgentPipelineService,
    TtsPipelineService,
    SpeakPipelineService,
  ],
})
export class GatewayModule {}
