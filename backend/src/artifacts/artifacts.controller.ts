import { Body, Controller, Delete, Get, Param, ParseEnumPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsEnum, IsString, Matches, MaxLength } from 'class-validator';
import { ArtifactsService } from './artifacts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/decorators';
import { Ecosystem } from '@prisma/client';

class FollowDto {
  @IsEnum(Ecosystem)
  ecosystem!: Ecosystem;

  // npm names are <= 214 chars; Maven group:artifact and PyPI names stay well below
  @IsString()
  @MaxLength(256)
  @Matches(/^[\w.@/:-]+$/)
  coordinates!: string;
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
  search(@Query('ecosystem', new ParseEnumPipe(Ecosystem)) ecosystem: Ecosystem, @Query('q') q: string) {
    return this.artifacts.search(ecosystem, (q ?? '').slice(0, 256));
  }
}
