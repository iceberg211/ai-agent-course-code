import { IsOptional, IsString, MinLength, MaxLength, IsNotEmpty } from 'class-validator';

export class RegisterDto {
  @IsString({ message: '用户名必须为字符串' })
  @MinLength(3, { message: '用户名长度不能低于 3 位' })
  @MaxLength(30, { message: '用户名长度不能高于 30 位' })
  username: string;

  @IsOptional()
  @IsString({ message: '部门必须为字符串' })
  @MaxLength(80, { message: '部门长度不能高于 80 位' })
  department?: string;

  @IsString({ message: '密码必须为字符串' })
  @MinLength(6, { message: '密码长度不能低于 6 位' })
  @MaxLength(30, { message: '密码长度不能高于 30 位' })
  password: string;
}

export class LoginDto {
  @IsString({ message: '用户名必须为字符串' })
  username: string;

  @IsString({ message: '密码必须为字符串' })
  password: string;
}

export class ChangePasswordDto {
  @IsString({ message: '旧密码必须为字符串' })
  @MinLength(6, { message: '密码长度不能低于 6 位' })
  oldPassword!: string;

  @IsString({ message: '新密码必须为字符串' })
  @MinLength(6, { message: '密码长度不能低于 6 位' })
  newPassword!: string;
}

export class CreateApiKeyDto {
  @IsString({ message: 'API Key 名称必须为字符串' })
  @IsNotEmpty({ message: 'API Key 名称不能为空' })
  @MaxLength(100, { message: 'API Key 名称长度不能高于 100 位' })
  name: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString({ message: '部门必须为字符串' })
  @MaxLength(80, { message: '部门长度不能高于 80 位' })
  department?: string;
}
