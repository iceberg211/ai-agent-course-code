import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}
