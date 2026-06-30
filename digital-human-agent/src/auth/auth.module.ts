import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { UserModule } from '@/user/user.module';
import { ApiKey } from '@/auth/entities/api-key.entity';
import { AuthService } from '@/auth/services/auth.service';
import { AuthController } from '@/auth/controllers/auth.controller';
import { JwtStrategy } from '@/auth/strategies/jwt.strategy';
import { ApiKeyStrategy } from '@/auth/strategies/api-key.strategy';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { NotificationModule } from '@/notification/notification.module';
import { RbacModule } from '@/rbac/rbac.module';

@Module({
  imports: [
    UserModule,
    NotificationModule,
    RbacModule,
    TypeOrmModule.forFeature([ApiKey]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'default-jwt-secret-key-12345678',
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRES_IN') || '7d') as any,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, ApiKeyStrategy, RolesGuard],
  exports: [AuthService, JwtModule, PassportModule, RbacModule],
})
export class AuthModule {}
