import { IsIn, IsOptional, IsString } from 'class-validator';

export class UploadDocumentDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  tags?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  businessCategory?: string;

  @IsOptional()
  @IsIn(['private', 'department', 'company'])
  visibility?: 'private' | 'department' | 'company';

  @IsOptional()
  @IsString()
  expiresAt?: string;

  @IsOptional()
  securityLevel?: any;
}
