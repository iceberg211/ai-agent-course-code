import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class ChatRequestDto {
  @ApiProperty({
    description: '角色 ID',
    example: '491a6f8f-739a-47ff-94fa-6382ed79baf9',
  })
  @IsString()
  personaId: string;

  @ApiPropertyOptional({
    description: '会话 ID（首次可不传）',
    example: '32852c62-e672-456f-8391-da1f24c1dbfa',
  })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

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
}

