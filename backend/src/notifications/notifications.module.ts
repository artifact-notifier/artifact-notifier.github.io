import { Module } from '@nestjs/common';
import { MailService } from './mail/mail.service';
import { NotificationsService } from './notifications.service';
import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { UnsubscribeService } from './unsubscribe.service';
import { UnsubscribeController } from './unsubscribe.controller';

@Module({
  imports: [AuthModule, TelegramModule],
  controllers: [UnsubscribeController],
  providers: [MailService, NotificationsService, UnsubscribeService],
  exports: [NotificationsService, MailService],
})
export class NotificationsModule {}
