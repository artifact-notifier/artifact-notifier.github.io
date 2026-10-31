import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { UnsubscribeService } from './unsubscribe.service';

/** No session: the signed token of the mail link is the authorization. */
@Controller('unsubscribe')
export class UnsubscribeController {
  constructor(private readonly unsubscribe: UnsubscribeService) {}

  @Get()
  describe(@Query('token') token?: string) {
    return this.unsubscribe.describe(token);
  }

  // Also the RFC 8058 one-click target: mail clients POST `List-Unsubscribe=One-Click` here.
  @Post()
  @HttpCode(200)
  apply(@Query('token') token?: string) {
    return this.unsubscribe.apply(token);
  }
}
