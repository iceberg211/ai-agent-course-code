import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConversationQueryDto } from '@/conversation/controllers/dto/conversation-query.dto';
import { MessageFeedbackDto } from '@/conversation/controllers/dto/message-feedback.dto';
import { ConversationService } from '@/conversation/services/conversation.service';

@ApiTags('conversations')
@Controller('conversations')
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Get()
  @ApiOperation({ summary: '分页查询会话列表' })
  list(@Query() query: ConversationQueryDto) {
    return this.conversationService.listConversations({
      personaId: query.personaId,
      ownerId: query.ownerId,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get(':conversationId/messages')
  @ApiOperation({ summary: '查询会话消息' })
  listMessages(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    return this.conversationService.getRecentMessages(conversationId, 500);
  }

  @Delete(':conversationId')
  @ApiOperation({ summary: '删除会话' })
  remove(@Param('conversationId', ParseUUIDPipe) conversationId: string) {
    return this.conversationService.deleteConversation(conversationId);
  }

  @Patch(':conversationId/messages/:messageId/feedback')
  @ApiOperation({ summary: '标记或清除回答反馈' })
  async setFeedback(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: MessageFeedbackDto,
  ) {
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
}
