import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
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
    AuthModule,
    ArtifactsModule,
    NotificationsModule,
    ListenersModule,
    TelegramModule,
  ],
})
export class AppModule {}
