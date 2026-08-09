import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ChunkContextDto {
  @ApiPropertyOptional({ description: '向前取相邻片段数量', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  before?: number;

  @ApiPropertyOptional({ description: '向后取相邻片段数量', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  after?: number;
}
