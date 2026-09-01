import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OidcService } from './oidc.service';
import { OidcController } from './oidc.controller';
import { UsersService } from './users.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PreferencesController } from './preferences.controller';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: (config.get<string>('JWT_EXPIRES_IN') || '7d') as any },
      }),
    }),
  ],
  controllers: [OidcController, PreferencesController],
  providers: [OidcService, UsersService, JwtAuthGuard],
  exports: [OidcService, UsersService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
