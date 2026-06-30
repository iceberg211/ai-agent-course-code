import {
  Body,
  Controller,
  Post,
  Patch,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Delete,
  Get,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from '@/auth/services/auth.service';
import {
  RegisterDto,
  LoginDto,
  ChangePasswordDto,
  CreateApiKeyDto,
  UpdateProfileDto,
} from '@/auth/dto/auth.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { PermissionGuard } from '@/rbac/guards/permission.guard';
import { RequirePermissions } from '@/rbac/decorators/permissions.decorator';

@ApiTags('认证与用户')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: '注册新用户' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.username, dto.password, dto.department);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户登录' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.username, dto.password);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('user', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '修改当前登录用户的密码' })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: any,
  ) {
    return this.authService.changePassword(req.user.id, dto.oldPassword, dto.newPassword);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('user', 'admin')
  @ApiOperation({ summary: '获取当前用户资料' })
  async me(@Req() req: any) {
    return this.authService.getProfile(req.user.id);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('user', 'admin')
  @ApiOperation({ summary: '更新当前用户资料' })
  async updateMe(@Body() dto: UpdateProfileDto, @Req() req: any) {
    return this.authService.updateProfile(req.user.id, {
      department: dto.department,
    });
  }

  @Post('api-keys')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
  @Roles('user', 'admin')
  @RequirePermissions('api-key:manage')
  @ApiOperation({ summary: '创建 API Key' })
  async createApiKey(@Body() dto: CreateApiKeyDto, @Req() req: any) {
    return this.authService.createApiKey(req.user.id, dto.name);
  }

  @Get('api-keys')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
  @Roles('user', 'admin')
  @RequirePermissions('api-key:manage')
  @ApiOperation({ summary: '获取 API Key 列表' })
  async listApiKeys(@Req() req: any) {
    return this.authService.listApiKeys(req.user.id);
  }

  @Delete('api-keys/:id')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
  @Roles('user', 'admin')
  @RequirePermissions('api-key:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '废弃/注销 API Key' })
  async revokeApiKey(@Param('id') id: string, @Req() req: any) {
    await this.authService.revokeApiKey(req.user.id, id);
  }
}
