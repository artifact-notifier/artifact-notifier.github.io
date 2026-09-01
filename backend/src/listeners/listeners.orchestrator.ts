import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NpmArtifactListener } from './npm-artifact.listener';
import { MavenArtifactListener } from './maven-artifact.listener';
import { PypiArtifactListener } from './pypi-artifact.listener';

/**
 * Refreshes the in-memory followed sets periodically so listeners pick up new
 * follows/unfollows without a restart.
 */
@Injectable()
export class ListenersOrchestrator implements OnModuleInit {
  private readonly logger = new Logger(ListenersOrchestrator.name);

  constructor(
    private readonly npm: NpmArtifactListener,
    private readonly maven: MavenArtifactListener,
    private readonly pypi: PypiArtifactListener,
  ) {}

  async onModuleInit() {
    this.logger.log('Artifact listeners started (npm SSE, maven/pypi polling)');
  }

  @Interval(30000)
  async refreshFollowedCache() {
    await Promise.all([
      this.npm.refreshFollowed(),
      this.maven.refreshFollowed(),
      this.pypi.refreshFollowed(),
    ]);
  }
}
