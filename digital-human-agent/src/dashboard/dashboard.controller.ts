import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from '@/dashboard/dashboard.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';

@ApiTags('dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: '首页大盘轻量统计' })
  summary() {
    return this.dashboardService.summary();
  }

  @Get('rag-health')
  @ApiOperation({ summary: 'RAG 质量、评估与任务健康统计' })
  ragHealth() {
    return this.dashboardService.ragHealth();
  }
}
