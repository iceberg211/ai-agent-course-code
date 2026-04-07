import { Controller, Get, Post, Body, Param, Patch } from '@nestjs/common';
import { TaskService } from './task.service';
import { TaskStatus } from './entities/task.entity';

@Controller('task')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Post()
  async createTask(@Body() body: { title: string; userInput: string }) {
    return this.taskService.createTask(body.title, body.userInput);
  }

  @Get()
  async getAllTasks() {
    return this.taskService.getAllTasks();
  }

  @Get(':id')
  async getTask(@Param('id') id: string) {
    return this.taskService.getTask(id);
  }

  // 模拟发送命令恢复任务（例如人机交互环节）
  @Post(':id/resume')
  async resumeTask(@Param('id') id: string, @Body() body: { decision: string }) {
    // 实际项目中，这里会调用 LangGraph 的 Command({resume: decision})
    // 这里做个简单的模拟，如果当前是 waitting_human 则改回 running
    const task = await this.taskService.getTask(id);
    if (task.status === TaskStatus.WAITING_HUMAN) {
      return this.taskService.updateTaskStatus(id, TaskStatus.RUNNING);
    }
    return { success: false, message: 'Task is not waiting for human' };
  }

  // ============== 以下接口为了测试用的控制台调用 ==============

  @Post(':id/test/simulate')
  async simulateLangGraph(@Param('id') id: string) {
    // 模拟一段流式写入来触发前端 SSE
    await this.taskService.updateTaskStatus(id, TaskStatus.PLANNING);
    
    // 产生一个计划
    await new Promise(r => setTimeout(r, 1000));
    await this.taskService.savePlan(id, '完成演示', [{ title: '搜索' }, { title: '写入' }]);
    await this.taskService.updateTaskStatus(id, TaskStatus.RUNNING);

    // 开始执行步骤
    await new Promise(r => setTimeout(r, 1000));
    const step1 = await this.taskService.startStep(id, 1, 0, '搜索');
    
    await new Promise(r => setTimeout(r, 1000));
    await this.taskService.finishStep(step1.id, '模拟搜索结果：成功');

    // 再执行下一步
    await new Promise(r => setTimeout(r, 1000));
    const step2 = await this.taskService.startStep(id, 1, 1, '写入');

    await new Promise(r => setTimeout(r, 1000));
    await this.taskService.finishStep(step2.id, '模拟写入结果：成功');

    // 完成
    await new Promise(r => setTimeout(r, 1000));
    return this.taskService.updateTaskStatus(id, TaskStatus.SUCCEEDED);
  }
}
