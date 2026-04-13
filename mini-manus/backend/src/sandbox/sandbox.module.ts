import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SandboxService } from '@/sandbox/sandbox.service';
import { DockerSandboxRunner } from '@/sandbox/docker-sandbox-runner';
import { SANDBOX_RUNNER } from '@/sandbox/sandbox-runner.interface';

@Module({
  providers: [
    {
      provide: SANDBOX_RUNNER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const workspaceBasePath = config.get<string>(
          'WORKSPACE_BASE_DIR',
          '/tmp/mini-manus-workspaces',
        );
        const socketPath = config.get<string>(
          'DOCKER_SOCKET_PATH',
          '/var/run/docker.sock',
        );
        return new DockerSandboxRunner(workspaceBasePath, socketPath);
      },
    },
    SandboxService,
  ],
  exports: [SandboxService],
})
export class SandboxModule {}
