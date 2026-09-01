import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MailerModule } from '@nestjs-modules/mailer';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ArtifactsModule } from './artifacts/artifacts.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ListenersModule } from './listeners/listeners.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    AppConfigModule,
    ConfigModule,
    PrismaModule,
    ScheduleModule.forRoot(),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get('SMTP_HOST'),
          port: config.get('SMTP_PORT'),
          secure: false,
          auth: { user: config.get('SMTP_USER'), pass: config.get('SMTP_PASS') },
        },
        defaults: { from: config.get('MAIL_FROM') },
      }),
    }),
    AuthModule,
    ArtifactsModule,
    NotificationsModule,
    ListenersModule,
    TelegramModule,
  ],
})
export class AppModule {}
