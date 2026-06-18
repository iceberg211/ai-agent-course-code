import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ChatRequestDto {
  @ApiPropertyOptional({
    description: 'AI SDK 生成的聊天 ID（兼容字段，服务端忽略）',
    example: 'chat_123',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({
    description: '角色 ID',
    example: '491a6f8f-739a-47ff-94fa-6382ed79baf9',
  })
  @IsString()
  @IsUUID()
  personaId: string;

  @ApiPropertyOptional({
    description: '会话 ID（首次可不传）',
    example: '32852c62-e672-456f-8391-da1f24c1dbfa',
  })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional({
    description: '调用方标识，用于隔离同一 persona 下的会话复用',
    example: 'browser-device-123',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  clientId?: string;

  @ApiPropertyOptional({
    description: '调用方标识别名，兼容 owner 命名',
    example: 'browser-device-123',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ownerId?: string;

  @ApiPropertyOptional({
    description: '兼容纯文本入参',
    example: '你好，请介绍下这个项目',
  })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional({
    description: 'AI SDK UIMessage 数组',
    type: [Object],
  })
  @IsOptional()
  @IsArray()
  messages?: Array<Record<string, unknown>>;

  @ApiPropertyOptional({
    description: '触发类型（AI SDK 会自动传）',
    example: 'submit-message',
  })
  @IsOptional()
  @IsString()
  trigger?: string;

  @ApiPropertyOptional({
    description: 'AI SDK 当前提交消息 ID（兼容字段，服务端忽略）',
    example: 'msg_123',
  })
  @IsOptional()
  @IsString()
  messageId?: string;
}
