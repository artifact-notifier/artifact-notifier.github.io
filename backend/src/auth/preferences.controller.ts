import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, AuthedUser } from './decorators';
import { UsersService } from './users.service';
import { NotificationMode } from '@prisma/client';

class UpdatePreferencesDto {
  @IsOptional()
  @IsIn([NotificationMode.IMMEDIATE, NotificationMode.DIGEST])
  notificationMode?: NotificationMode;

  @IsOptional()
  @IsInt()
  @Min(1)
  digestIntervalMinutes?: number;

  @IsOptional()
  @IsString()
  @IsIn(['fr', 'en', 'es', 'de', 'zh'])
  locale?: string;

  @IsOptional()
  @IsString()
  @IsIn(['light', 'dark', 'system'])
  theme?: string;

  @IsOptional()
  @IsString()
  @IsIn(['email', 'telegram', 'both'])
  notificationChannel?: string;

  @IsOptional()
  @IsString()
  telegramChatId?: string;
}

@Controller('preferences')
@UseGuards(JwtAuthGuard)
export class PreferencesController {
  constructor(private readonly users: UsersService) {}

  @Get()
  get(@CurrentUser() user: AuthedUser) {
    return this.users.getPreferences(user.sub);
  }

  @Put()
  update(@CurrentUser() user: AuthedUser, @Body() dto: UpdatePreferencesDto) {
    return this.users.upsertPreferences(user.sub, dto);
  }
}
