import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { LongTermMemoryService } from '@/memory/services/long-term-memory.service';
import { MemoryPolicyService } from '@/memory/services/memory-policy.service';
import type { MemoryCategory, MemoryVisibility } from '@/memory/memory.types';

class CreateMemoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content: string;

  @IsOptional()
  @IsIn(['preference', 'profile', 'business_context', 'task_goal', 'conversation_summary'])
  category?: MemoryCategory;

  @IsOptional()
  @IsIn(['private', 'department', 'company'])
  visibility?: MemoryVisibility;
}

@ApiTags('memory')
@Controller('memories')
@UseGuards(JwtAuthGuard)
export class MemoryController {
  constructor(
    private readonly longTermMemoryService: LongTermMemoryService,
    private readonly memoryPolicyService: MemoryPolicyService,
  ) {}

  @Get()
  @ApiOperation({ summary: '查询当前用户长期记忆' })
  list(@Req() req: any, @Query('q') query?: string) {
    return this.longTermMemoryService.search(
      {
        ownerId: req.user?.id ?? null,
        department: req.user?.department ?? null,
        query,
        limit: 50,
      },
      this.accessScope(req),
    );
  }

  @Post()
  @ApiOperation({ summary: '创建当前用户长期记忆' })
  create(@Req() req: any, @Body() dto: CreateMemoryDto) {
    return this.longTermMemoryService.add({
      ownerId: req.user.id,
      department: req.user?.department ?? null,
      content: dto.content,
      category: dto.category ?? 'preference',
      visibility: this.memoryPolicyService.normalizeVisibility(dto.visibility),
      confidence: 0.9,
      metadata: { source: 'manual' },
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除当前用户长期记忆' })
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.longTermMemoryService.delete({
      id,
      ownerId: req.user?.role === 'admin' ? undefined : req.user?.id,
    });
    return { deleted: true };
  }

  private accessScope(req: any) {
    return {
      ownerId: req.user?.id ?? null,
      department: req.user?.department ?? null,
      role: req.user?.role ?? null,
    };
  }
}

