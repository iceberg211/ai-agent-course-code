import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  ForbiddenException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConversationQueryDto } from '@/conversation/controllers/dto/conversation-query.dto';
import { MessageFeedbackDto } from '@/conversation/controllers/dto/message-feedback.dto';
import { ConversationService } from '@/conversation/services/conversation.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';

@ApiTags('conversations')
@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Get()
  @ApiOperation({ summary: '分页查询会话列表' })
  list(@Query() query: ConversationQueryDto, @Req() req: any) {
    return this.conversationService.listConversations({
      personaId: query.personaId,
      ownerId: req.user.id,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get(':conversationId/messages')
  @ApiOperation({ summary: '查询会话消息' })
  async listMessages(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Req() req: any,
  ) {
    await this.checkConversationOwnership(conversationId, req.user.id);
    return this.conversationService.getRecentMessages(conversationId, 500);
  }

  @Delete(':conversationId')
  @ApiOperation({ summary: '删除会话' })
  async remove(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Req() req: any,
  ) {
    await this.checkConversationOwnership(conversationId, req.user.id);
    return this.conversationService.deleteConversation(conversationId);
  }

  @Patch(':conversationId/messages/:messageId/feedback')
  @ApiOperation({ summary: '标记或清除回答反馈' })
  async setFeedback(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: MessageFeedbackDto,
    @Req() req: any,
  ) {
    await this.checkConversationOwnership(conversationId, req.user.id);
    const message = await this.conversationService.setMessageFeedback(
      conversationId,
      messageId,
      dto.feedback ?? null,
    );
    if (!message) {
      throw new NotFoundException('消息不存在或不属于当前会话');
    }
    return message;
  }

  private async checkConversationOwnership(conversationId: string, ownerId: string) {
    const conversation = await this.conversationService.getConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundException('会话不存在');
    }
    if (conversation.ownerId !== ownerId) {
      throw new ForbiddenException('您无权访问或操作该会话');
    }
    return conversation;
  }
}
