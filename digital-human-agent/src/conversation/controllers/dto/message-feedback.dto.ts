import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { MessageFeedback } from '@/conversation/entities/conversation-message.entity';

export class MessageFeedbackDto {
  @ApiPropertyOptional({
    description: '回答反馈。传 null 或不传表示清除反馈',
    enum: ['up', 'down'],
  })
  @IsOptional()
  @IsIn(['up', 'down'])
  feedback?: MessageFeedback | null;
}
