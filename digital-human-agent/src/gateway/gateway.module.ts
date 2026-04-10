import { Module } from '@nestjs/common';
import { ConversationGateway } from './conversation.gateway';
import { AgentModule } from '../agent/agent.module';
import { AsrModule } from '../asr/asr.module';
import { TtsModule } from '../tts/tts.module';
import { ConversationModule } from '../conversation/conversation.module';
import { PersonaModule } from '../persona/persona.module';
import { DigitalHumanModule } from '../digital-human/digital-human.module';

@Module({
  imports: [
    AgentModule,
    AsrModule,
    TtsModule,
    ConversationModule,
    PersonaModule,
    DigitalHumanModule,
  ],
  providers: [ConversationGateway],
})
export class GatewayModule {}
