import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreatePersonaDto {
  @IsString()
  name: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString()
  speakingStyle?: string;

  @IsOptional() @IsArray()
  expertise?: string[];

  @IsOptional() @IsString()
  voiceId?: string;

  @IsOptional() @IsString()
  avatarId?: string;

  @IsOptional() @IsString()
  systemPromptExtra?: string;
}
