import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class UpdateChunkDto {
  @ApiProperty({ description: '是否启用该 chunk 参与检索' })
  @Type(() => Boolean) @IsBoolean()
  enabled: boolean;
}
