import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreatePersonaDto {
  @ApiProperty({ description: '角色名称', example: '李老师' })
  @Transform(({ value, obj }) => value ?? obj?.persona_name)
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: '角色简介', example: '资深前端讲师' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: '说话风格',
    example: '说话温和，喜欢举例子',
  })
  @Transform(({ value, obj }) => value ?? obj?.speaking_style)
  @IsOptional()
  @IsString()
  speakingStyle?: string;

  @ApiPropertyOptional({
    description: '擅长领域',
    example: ['React', 'TypeScript'],
    type: [String],
  })
  @Transform(({ value, obj }) => value ?? obj?.expertise_list)
  @IsOptional()
  @IsArray()
  expertise?: string[];

  @ApiPropertyOptional({ description: '音色 ID', example: 'longxiaochun' })
  @Transform(({ value, obj }) => value ?? obj?.voice_id)
  @IsOptional()
  @IsString()
  voiceId?: string;

  @ApiPropertyOptional({
    description: '数字人形象 ID',
    example: 'avatar_teacher_01',
  })
  @Transform(({ value, obj }) => value ?? obj?.avatar_id)
  @IsOptional()
  @IsString()
  avatarId?: string;

  @ApiPropertyOptional({
    description: '系统提示补充',
    example: '回答尽量简洁。',
  })
  @Transform(({ value, obj }) => value ?? obj?.system_prompt_extra)
  @IsOptional()
  @IsString()
  systemPromptExtra?: string;
}
