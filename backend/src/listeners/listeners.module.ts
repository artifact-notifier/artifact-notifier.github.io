import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NpmArtifactListener } from './npm-artifact.listener';
import { MavenArtifactListener } from './maven-artifact.listener';
import { PypiArtifactListener } from './pypi-artifact.listener';
import { ListenersOrchestrator } from './listeners.orchestrator';
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ScheduleModule.forRoot(), ArtifactsModule, NotificationsModule],
  providers: [
    NpmArtifactListener,
    MavenArtifactListener,
    PypiArtifactListener,
    ListenersOrchestrator,
  ],
})
export class ListenersModule {}
