import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TaskService } from '@/task/task.service';
import { CreateTaskDto } from '@/task/dto/create-task.dto';

@ApiTags('tasks')
@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  // ─── 列表 ─────────────────────────────────────────────────
  @Get()
  @ApiOperation({ summary: '获取所有任务列表（按创建时间倒序）' })
  @ApiResponse({ status: 200, description: '任务摘要数组' })
  list() {
    return this.taskService.listTasks();
  }

  // ─── 新建任务 ─────────────────────────────────────────────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建任务并立即开始执行' })
  @ApiResponse({ status: 201, description: '新建的任务对象' })
  @ApiResponse({ status: 400, description: '请求参数不合法' })
  create(@Body() dto: CreateTaskDto) {
    return this.taskService.createTask(dto.input);
  }

  // ─── 任务摘要 ─────────────────────────────────────────────
  @Get(':id')
  @ApiOperation({ summary: '获取单个任务基本信息' })
  @ApiParam({ name: 'id', description: '任务 UUID' })
  @ApiResponse({ status: 200, description: '任务对象' })
  @ApiResponse({ status: 404, description: '任务不存在' })
  get(@Param('id') id: string) {
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
  detail(@Param('id') id: string) {
    return this.taskService.getTaskDetail(id);
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
  getRun(@Param('id') taskId: string, @Param('runId') runId: string) {
    return this.taskService.getRunDetail(taskId, runId);
  }

  // ─── 取消当前 Run ─────────────────────────────────────────
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '请求取消当前正在执行的 Run（协作式取消）' })
  @ApiParam({ name: 'id', description: '任务 UUID' })
  @ApiResponse({ status: 200, description: '{ message }' })
  @ApiResponse({ status: 404, description: '任务不存在或没有正在运行的 Run' })
  async cancel(@Param('id') id: string) {
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
  async retry(@Param('id') id: string) {
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
  async delete(@Param('id') id: string) {
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
  edit(@Param('id') id: string, @Body() dto: CreateTaskDto) {
    return this.taskService.editTask(id, dto.input);
  }
}
