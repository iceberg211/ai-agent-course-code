import { IsString, MinLength, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsString({ message: '用户名必须为字符串' })
  @MinLength(3, { message: '用户名长度不能低于 3 位' })
  @MaxLength(30, { message: '用户名长度不能高于 30 位' })
  username: string;

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
