import { Module } from '@nestjs/common';
import { AgentGateway } from '@/gateway/agent.gateway';
import { TaskModule } from '@/task/task.module';

@Module({
  imports: [TaskModule],
  providers: [AgentGateway],
})
export class GatewayModule {}
