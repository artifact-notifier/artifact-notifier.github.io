import { Module } from '@nestjs/common';
import { ArtifactsService } from './artifacts.service';
import { ArtifactsController } from './artifacts.controller';
import { TestArtifactsController } from './test.controller';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [ArtifactsController, TestArtifactsController],
  providers: [ArtifactsService],
  exports: [ArtifactsService],
})
export class ArtifactsModule {}
