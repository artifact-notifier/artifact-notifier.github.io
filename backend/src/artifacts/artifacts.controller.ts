import { Body, Controller, Delete, Get, Param, ParseEnumPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ArtifactsService } from './artifacts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/decorators';
import { Ecosystem } from '@prisma/client';
import { MAX_PATTERN_LENGTH, MAX_VERSION_RULES, PATTERN_RE, VersionRuleType } from './version-rules';

class FollowDto {
  @IsEnum(Ecosystem)
  ecosystem!: Ecosystem;

  // npm names are <= 214 chars; Maven group:artifact and PyPI names stay well below
  @IsString()
  @MaxLength(256)
  @Matches(/^[\w.@/:-]+$/)
  coordinates!: string;
}

class VersionRuleDto {
  @IsIn(['include', 'exclude'])
  type!: VersionRuleType;

  @IsString()
  @MaxLength(MAX_PATTERN_LENGTH)
  @Matches(PATTERN_RE)
  pattern!: string;
}

class RulesDto {
  @IsArray()
  @ArrayMaxSize(MAX_VERSION_RULES)
  @ValidateNested({ each: true })
  @Type(() => VersionRuleDto)
  rules!: VersionRuleDto[];

  // null or absent: the user's preference applies
  @IsOptional()
  @IsBoolean()
  includePrereleases?: boolean | null;
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

  @Put(':id/rules')
  setRules(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() dto: RulesDto) {
    return this.artifacts.setRules(user.sub, id, dto.rules, dto.includePrereleases ?? null);
  }

  @Get(':id/versions')
  versions(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.artifacts.previewVersions(user.sub, id);
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
