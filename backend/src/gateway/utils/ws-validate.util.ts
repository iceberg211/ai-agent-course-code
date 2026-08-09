import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  WsBaseMessageDto,
  WsSessionStartMessageDto,
  WsTextInputMessageDto,
  WsInterruptMessageDto,
  WsPingMessageDto,
} from '../gateway.dto';

export async function validateInboundMessage(
  rawMsg: unknown,
): Promise<{
  isValid: boolean;
  errors?: string[];
  validatedMsg?: any;
}> {
  if (!rawMsg || typeof rawMsg !== 'object') {
    return { isValid: false, errors: ['消息体必须是 JSON 对象'] };
  }

  // 1. 先验证基本参数
  const baseInstance = plainToInstance(WsBaseMessageDto, rawMsg);
  const baseErrors = await validate(baseInstance);
  if (baseErrors.length > 0) {
    const errorMsgs = baseErrors.flatMap((err) =>
      Object.values(err.constraints ?? {}),
    );
    return { isValid: false, errors: errorMsgs };
  }

  let dtoClass: new () => object;
  switch (baseInstance.type) {
    case 'session:start':
      dtoClass = WsSessionStartMessageDto;
      break;
    case 'conversation:text':
      dtoClass = WsTextInputMessageDto;
      break;
    case 'conversation:interrupt':
      dtoClass = WsInterruptMessageDto;
      break;
    case 'ping':
      dtoClass = WsPingMessageDto;
      break;
    default:
      return {
        isValid: false,
        errors: [`不支持的消息类型: ${baseInstance.type}`],
      };
  }

  const finalInstance = plainToInstance(dtoClass, rawMsg);
  const finalErrors = await validate(finalInstance);
  if (finalErrors.length > 0) {
    const errorMsgs = finalErrors.flatMap((err) => {
      if (err.children && err.children.length > 0) {
        return err.children.flatMap((child) =>
          Object.values(child.constraints ?? {}),
        );
      }
      return Object.values(err.constraints ?? {});
    });
    return { isValid: false, errors: errorMsgs };
  }

  return { isValid: true, validatedMsg: finalInstance };
}
