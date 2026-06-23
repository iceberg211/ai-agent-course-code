import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEvalCaseDto {
  @ApiProperty({ description: '用于验证检索质量的真实问题' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  question: string;

  @ApiPropertyOptional({ description: '可选的期望答案或验收要点' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  expectedAnswer?: string;
}
