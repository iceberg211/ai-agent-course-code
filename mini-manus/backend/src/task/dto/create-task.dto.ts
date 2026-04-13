import { IsString, IsNotEmpty, IsOptional, IsIn, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ApprovalMode } from '@/common/enums';

export class CreateTaskDto {
  @ApiProperty({
    description: '任务描述（用户自然语言输入）',
    example: '帮我调研 React Compiler 的最新进展，整理成一份笔记',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  input: string;

  @ApiPropertyOptional({
    description: 'HITL 审批模式：none=不审批，side_effects=仅副作用步骤，all_steps=每步都审批',
    enum: ['none', 'side_effects', 'all_steps'],
    default: 'none',
  })
  @IsOptional()
  @IsIn(['none', 'plan_first', 'side_effects', 'all_steps'])
  approvalMode?: ApprovalMode;
}
