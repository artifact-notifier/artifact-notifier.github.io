import { Body, Controller, Delete, ForbiddenException, Get, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { TelegramService, TelegramAuthData } from './telegram.service';
import { UsersService } from '../auth/users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser, Public } from '../auth/decorators';

@Controller('auth/telegram')
export class TelegramController {
  constructor(
    private readonly telegram: TelegramService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get('config')
  configPublic() {
    return {
      enabled: this.telegram.isEnabled(),
      botUsername: this.telegram.getBotUsername() || null,
    };
  }

  @Public()
  @Post('verify')
  async verify(@Body() data: TelegramAuthData, @Res({ passthrough: true }) res: Response) {
    if (!this.telegram.isEnabled()) throw new ForbiddenException('Telegram login is disabled');
    if (!this.telegram.verifyAuthData(data)) {
      throw new UnauthorizedException('Invalid Telegram hash');
    }
    const profile = {
      email: `${data.id}@telegram.local`,
      name: [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username || `tg_${data.id}`,
      avatarUrl: data.photo_url,
      provider: 'telegram',
      providerSubject: String(data.id),
    };
    const user = await this.users.findOrCreateFromTelegram({
      telegramId: String(data.id),
      telegramUsername: data.username,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    });

    const token = this.jwt.sign(
      { sub: user.id, email: user.email, provider: user.provider },
      { secret: this.config.get<string>('JWT_SECRET'), expiresIn: (this.config.get<string>('JWT_EXPIRES_IN') || '7d') as any },
    );
    res.cookie('access_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<string>('NODE_ENV') === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return { success: true, user };
  }

  @Post('link')
  @UseGuards(JwtAuthGuard)
  async link(@CurrentUser() u: AuthedUser, @Body() data: TelegramAuthData) {
    if (!this.telegram.isEnabled()) throw new ForbiddenException('Telegram link is disabled');
    if (!this.telegram.verifyAuthData(data)) throw new UnauthorizedException('Invalid Telegram hash');
    const user = await this.users.linkTelegram(u.sub, {
      telegramId: String(data.id),
      telegramUsername: data.username,
    });
    return user;
  }

  @Delete('unlink')
  @UseGuards(JwtAuthGuard)
  async unlink(@CurrentUser() u: AuthedUser) {
    return this.users.unlinkTelegram(u.sub);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  async status(@Req() req: any) {
    const user = await this.users.findById(req.user.sub);
    return {
      linked: !!user?.preferences?.telegramChatId,
      telegramId: user?.preferences?.telegramChatId || null,
      telegramUsername: (user?.preferences as any)?.telegramUsername || null,
    };
  }
}
