import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ArtifactsService } from './artifacts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/decorators';
import { Ecosystem } from '@prisma/client';

interface FollowDto {
  ecosystem: Ecosystem;
  coordinates: string;
}

@Controller('artifacts')
@UseGuards(JwtAuthGuard)
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  @Get('sync-status')
  syncStatus() {
    return this.artifacts.getSyncStatus();
  }

  @Get('ecosystems')
  ecosystems() {
    return this.artifacts.getAvailableEcosystems();
  }

  @Get()
  list(@CurrentUser() user: AuthedUser) {
    return this.artifacts.list(user.sub);
  }

  @Post('follow')
  follow(@CurrentUser() user: AuthedUser, @Body() dto: FollowDto) {
    return this.artifacts.follow(user.sub, dto.ecosystem, dto.coordinates);
  }

  @Delete(':id')
  unfollow(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.artifacts.unfollow(user.sub, id);
  }

  @Get('search')
  search(@Query('ecosystem') ecosystem: Ecosystem, @Query('q') q: string) {
    return this.artifacts.search(ecosystem, q);
  }
}
