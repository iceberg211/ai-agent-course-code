import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class WsBaseMessageDto {
  @IsNotEmpty({ message: '消息类型 type 不能为空' })
  @IsString({ message: '消息类型 type 必须为字符串' })
  type: string;

  @IsOptional()
  @IsString({ message: 'sessionId 必须为字符串' })
  sessionId?: string;

  @IsOptional()
  @IsString({ message: 'turnId 必须为字符串' })
  turnId?: string;
}

export class SessionStartPayloadDto {
  @IsOptional()
  @IsString({ message: 'personaId 必须为字符串' })
  personaId?: string;

  @IsOptional()
  @IsString({ message: 'mode 必须为字符串' })
  mode?: string;

  @IsOptional()
  @IsBoolean({ message: 'forceNew 必须为布尔值' })
  forceNew?: boolean;
}

export class WsSessionStartMessageDto extends WsBaseMessageDto {
  @IsIn(['session:start'], { message: '不支持的消息类型' })
  type: 'session:start';

  @IsOptional()
  @ValidateNested()
  @Type(() => SessionStartPayloadDto)
  payload?: SessionStartPayloadDto;
}

export class TextInputPayloadDto {
  @IsNotEmpty({ message: '文本内容 text 不能为空' })
  @IsString({ message: '文本内容 text 必须为字符串' })
  text: string;
}

export class WsTextInputMessageDto extends WsBaseMessageDto {
  @IsIn(['conversation:text'], { message: '不支持的消息类型' })
  type: 'conversation:text';

  @IsNotEmpty({ message: 'payload 不能为空' })
  @ValidateNested()
  @Type(() => TextInputPayloadDto)
  payload: TextInputPayloadDto;
}

export class WsInterruptMessageDto extends WsBaseMessageDto {
  @IsIn(['conversation:interrupt'], { message: '不支持的消息类型' })
  type: 'conversation:interrupt';
}

export class WsPingMessageDto extends WsBaseMessageDto {
  @IsIn(['ping'], { message: '不支持的消息类型' })
  type: 'ping';
}
