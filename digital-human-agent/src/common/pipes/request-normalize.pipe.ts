import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';

/**
 * 请求体字段归一化：
 * 兼容前端可能传入的 snake_case 字段，统一映射到后端 DTO 使用的 camelCase。
 */
@Injectable()
export class RequestNormalizePipe implements PipeTransform {
  private readonly aliases: Record<string, string> = {
    persona_name: 'name',
    speaking_style: 'speakingStyle',
    expertise_list: 'expertise',
    voice_id: 'voiceId',
    avatar_id: 'avatarId',
    system_prompt_extra: 'systemPromptExtra',
  };

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'body' || !this.isPlainObject(value)) {
      return value;
    }
    const body = { ...value };
    for (const [legacyKey, modernKey] of Object.entries(this.aliases)) {
      if (body[modernKey] === undefined && body[legacyKey] !== undefined) {
        body[modernKey] = body[legacyKey];
      }
    }
    return body;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
}
