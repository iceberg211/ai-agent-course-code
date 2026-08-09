import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AccessControlService } from '@/common/security/access-control.service';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly accessControl: AccessControlService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    this.accessControl.assertHttpRequest(
      context.switchToHttp().getRequest<Request>(),
    );
    return true;
  }
}
