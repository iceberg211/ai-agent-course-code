import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { TaskService } from './task.service';
import { CreateTaskDto } from './dto/create-task.dto';

@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get()
  list() {
    return this.taskService.listTasks();
  }

  @Post()
  create(@Body() dto: CreateTaskDto) {
    return this.taskService.createTask(dto.input);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.taskService.getTask(id);
  }

  @Get(':id/detail')
  detail(@Param('id') id: string) {
    return this.taskService.getTaskDetail(id);
  }

  @Get(':id/runs/:runId')
  getRun(@Param('runId') runId: string) {
    return this.taskService.getRunDetail(runId);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.taskService.cancelRun(id);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.taskService.retryTask(id);
  }

  @Put(':id/edit')
  edit(@Param('id') id: string, @Body() dto: CreateTaskDto) {
    return this.taskService.editTask(id, dto.input);
  }
}
