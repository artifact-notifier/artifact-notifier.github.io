import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthedUser {
  sub: string;
  email: string;
  provider: string;
}

export const CurrentUser = createParamDecorator((data: unknown, ctx: ExecutionContext): AuthedUser => {
  const req = ctx.switchToHttp().getRequest();
  return req.user;
});
