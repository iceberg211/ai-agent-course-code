import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TaskService } from '@/task/task.service';
import { CreateTaskDto } from '@/task/dto/create-task.dto';
import { EventLogService } from '@/event/event-log.service';

@ApiTags('tasks')
@Controller('tasks')
export class TaskController {
  constructor(
    private readonly taskService: TaskService,
    private readonly eventLog: EventLogService,
  ) {}

  // ─── 列表 ─────────────────────────────────────────────────
  @Get()
  @ApiOperation({ summary: '获取任务列表（按创建时间倒序，支持分页）' })
  @ApiResponse({ status: 200, description: '任务摘要数组' })
  list(@Query('take') take?: string, @Query('skip') skip?: string) {
    return this.taskService.listTasks(
      take ? Math.min(Number(take), 100) : 50,
      skip ? Number(skip) : 0,
    );
  }

  // ─── 新建任务 ─────────────────────────────────────────────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  // 任务创建触发 LLM 调用链，单独限流：每分钟最多 10 次
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: '创建任务并立即开始执行' })
  @ApiResponse({ status: 201, description: '新建的任务对象' })
  @ApiResponse({ status: 400, description: '请求参数不合法' })
  @ApiResponse({ status: 429, description: '请求过于频繁' })
  create(@Body() dto: CreateTaskDto) {
    return this.taskService.createTask(dto.input);
  }

  // ─── 任务摘要 ─────────────────────────────────────────────
  @Get(':id')
  @ApiOperation({ summary: '获取单个任务基本信息' })
  @ApiParam({ name: 'id', description: '任务 UUID' })
  @ApiResponse({ status: 200, description: '任务对象' })
  @ApiResponse({ status: 404, description: '任务不存在' })
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.taskService.getTask(id);
  }

  // ─── 任务详情（含 revision/run/plan/step/artifact）────────
  @Get(':id/detail')
  @ApiOperation({
    summary: '获取任务完整详情',
    description:
      '包含所有 revision、runs 列表、当前 run 的计划/步骤/产物。前端初始化和 WebSocket 断线重连时调用。',
  })
  @ApiParam({ name: 'id', description: '任务 UUID' })
  @ApiResponse({
    status: 200,
    description: '{ task, revisions, runs, currentRun }',
  })
  @ApiResponse({ status: 404, description: '任务不存在' })
  detail(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.taskService.getTaskDetail(id);
  }

  // ─── 事件回放 ───────────────────────────────────────────
  @Get(':id/events')
  @ApiOperation({
    summary: '获取任务事件日志',
    description:
      '按创建时间正序返回 task_events，可用于刷新后回放执行过程或调试事件链路。',
  })
  @ApiParam({ name: 'id', description: '任务 UUID' })
  @ApiResponse({ status: 200, description: '事件日志数组' })
  @ApiResponse({ status: 400, description: '请求参数不合法' })
  listEvents(
    @Param('id', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Query('runId') runId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.eventLog.listTaskEvents({
      taskId,
      runId,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  // ─── 单次 Run 详情 ────────────────────────────────────────
  @Get(':id/runs/:runId')
  @ApiOperation({
    summary: '获取指定 Run 的完整执行记录（含 plan/steps/artifacts）',
  })
  @ApiParam({ name: 'id', description: '任务 UUID' })
  @ApiParam({ name: 'runId', description: 'Run UUID' })
  @ApiResponse({ status: 200, description: 'Run 对象（含关联数据）' })
  @ApiResponse({ status: 404, description: 'Run 不存在' })
  getRun(
    @Param('id', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
  ) {
    return this.taskService.getRunDetail(taskId, runId);
  }

  // ─── 取消当前 Run ─────────────────────────────────────────
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '请求取消当前正在执行的 Run（协作式取消）' })
  @ApiParam({ name: 'id', description: '任务 UUID' })
  @ApiResponse({ status: 200, description: '{ message }' })
  @ApiResponse({ status: 404, description: '任务不存在或没有正在运行的 Run' })
  async cancel(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.taskService.cancelRun(id);
    return { message: 'cancel requested' };
  }

  // ─── 重试 ────────────────────────────────────────────────
  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '基于当前 revision 新建一次 Run 并重试' })
  @ApiParam({ name: 'id', description: '任务 UUID' })
  @ApiResponse({ status: 200, description: '{ message }' })
  @ApiResponse({ status: 404, description: '任务不存在' })
  async retry(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.taskService.retryTask(id);
    return { message: 'retry started' };
  }

  // ─── 删除任务 ────────────────────────────────────────────
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除任务及其所有历史记录（不可恢复）' })
  @ApiParam({ name: 'id', description: '任务 UUID' })
  @ApiResponse({ status: 204, description: '删除成功，无响应体' })
  @ApiResponse({ status: 404, description: '任务不存在' })
  async delete(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.taskService.deleteTask(id);
  }

  // ─── 编辑任务（新 revision）──────────────────────────────
  @Put(':id/edit')
  @ApiOperation({
    summary: '修改任务描述，生成新 revision 并重新执行',
    description: '如果当前有正在运行的 Run，会先请求取消，再创建新 revision。',
  })
  @ApiParam({ name: 'id', description: '任务 UUID' })
  @ApiResponse({ status: 200, description: '新建的 TaskRevision 对象' })
  @ApiResponse({ status: 400, description: '请求参数不合法' })
  @ApiResponse({ status: 404, description: '任务不存在' })
  edit(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.taskService.editTask(id, dto.input);
  }
}
