import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { NotificationQueryDto } from '@/notification/dto/notification-query.dto';
import { NotificationService } from '@/notification/notification.service';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: '分页查询站内通知' })
  list(@Query() query: NotificationQueryDto, @Req() req: any) {
    return this.notificationService.list({
      ...query,
      ownerId: req.user?.id,
    });
  }

  @Patch(':id/read')
  @ApiOperation({ summary: '标记单条通知已读' })
  markRead(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.notificationService.markRead(id, req.user?.id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: '标记当前用户全部通知已读' })
  markAllRead(@Req() req: any) {
    return this.notificationService.markAllRead(req.user?.id);
  }
}
