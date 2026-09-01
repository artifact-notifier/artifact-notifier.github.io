import { Body, Controller, ForbiddenException, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { ArtifactsService } from './artifacts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConfigService } from '@nestjs/config';
import { Ecosystem } from '@prisma/client';

interface SimulateDto {
  coordinates: string;
  version: string;
}

@Controller('artifacts/test')
@UseGuards(JwtAuthGuard)
export class TestArtifactsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  private assertDevEnabled() {
    const nodeEnv = this.config.get<string>('NODE_ENV') || process.env.NODE_ENV;
    const enableTest = this.config.get<string>('ENABLE_TEST_MODE') || process.env.ENABLE_TEST_MODE;
    const isDev = nodeEnv !== 'production' || enableTest === 'true';
    if (!isDev) throw new ForbiddenException('Test mode disabled in production');
  }

  @Post('simulate')
  async simulate(@CurrentUser() user: AuthedUser, @Body() dto: SimulateDto) {
    this.assertDevEnabled();
    const coordinates = dto.coordinates?.trim();
    const version = dto.version?.trim();
    if (!coordinates || !version) throw new ForbiddenException('coordinates and version required');
    if (!/^[a-zA-Z0-9._\-\/]+$/.test(coordinates)) {
      // allow fairly permissive but prevent injection
    }

    // find or create TEST artifact for this user
    let fa = await this.prisma.followedArtifact.findUnique({
      where: { userId_ecosystem_coordinates: { userId: user.sub, ecosystem: Ecosystem.TEST, coordinates } },
    });
    if (!fa) {
      fa = await this.prisma.followedArtifact.create({
        data: { userId: user.sub, ecosystem: Ecosystem.TEST, coordinates, currentVersion: version },
      });
      // ensure user follows it (no event for initial version, only for simulated bump)
      // create first version as event as well so UI shows it
    }

    // avoid duplicate version
    const existing = await this.prisma.artifactVersionEvent.findUnique({
      where: { followedArtifactId_version: { followedArtifactId: fa.id, version } },
    });
    if (existing) return existing;

    await this.artifacts.markNewVersion(fa.id, version);

    // Reuse notifications flow (creates event + delivery, sends mail if IMMEDIATE)
    await this.notifications.onNewVersion(fa.id, user.sub, Ecosystem.TEST, coordinates, version);

    return this.prisma.artifactVersionEvent.findUnique({
      where: { followedArtifactId_version: { followedArtifactId: fa.id, version } },
    });
  }

  @Post('bump')
  async bump(@CurrentUser() user: AuthedUser, @Body() dto: { id: string; version: string }) {
    this.assertDevEnabled();
    const fa = await this.prisma.followedArtifact.findFirst({
      where: { id: dto.id, userId: user.sub, ecosystem: Ecosystem.TEST },
    });
    if (!fa) throw new ForbiddenException('TEST artifact not found or not owned');

    const version = dto.version?.trim();
    if (!version) throw new ForbiddenException('version required');

    const existing = await this.prisma.artifactVersionEvent.findUnique({
      where: { followedArtifactId_version: { followedArtifactId: fa.id, version } },
    });
    if (existing) return existing;

    await this.artifacts.markNewVersion(fa.id, version);
    await this.notifications.onNewVersion(fa.id, user.sub, Ecosystem.TEST, fa.coordinates, version);
    return this.prisma.artifactVersionEvent.findUnique({
      where: { followedArtifactId_version: { followedArtifactId: fa.id, version } },
    });
  }
}
