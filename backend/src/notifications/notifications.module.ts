import { Module } from '@nestjs/common';
import { MailService } from './mail/mail.service';
import { NotificationsService } from './notifications.service';
import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [AuthModule, TelegramModule],
  providers: [MailService, NotificationsService],
  exports: [NotificationsService, MailService],
})
export class NotificationsModule {}
