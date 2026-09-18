import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response, Request } from 'express';
import {
  buildAuthorizationUrl,
  authorizationCodeGrant,
  randomPKCECodeVerifier,
  randomState,
  calculatePKCECodeChallenge,
} from 'openid-client';
import { OidcService } from './oidc.service';
import { UsersService } from './users.service';
import { JwtService } from '@nestjs/jwt';
import { Public } from './decorators';
import { CurrentUser, AuthedUser } from './decorators';
import {JwtAuthGuard} from "./jwt-auth.guard";

@Controller('auth')
export class OidcController {
  constructor(
    private readonly oidc: OidcService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}


  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: any) {
    const user = await this.users.findById(req.user.sub);
    if (!user) throw new UnauthorizedException();
    const { preferences, ...rest } = user;
    return { ...rest, preferences };
  }

  @Get('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token', this.cookieOptions());
    return { success: true };
  }

  @Public()
  @Get('providers')
  providers() {
    return this.oidc.listProviders();
  }

  @Get('links')
  @UseGuards(JwtAuthGuard)
  async links(@CurrentUser() user: AuthedUser) {
    const linked = await this.users.listLinkedProviders(user.sub);
    const all = this.oidc.listProviders();
    return all.map((p) => ({ ...p, linked: linked.includes(p.key) }));
  }

  @Post('link-token')
  @UseGuards(JwtAuthGuard)
  linkToken(@CurrentUser() user: AuthedUser) {
    // One-time token consumed by GET :provider/link: full-page OAuth
    // navigation can't carry the Authorization header (esp. cross-origin),
    // so this bridges the session across the round-trip.
    return { token: this.oidc.createLinkToken(user.sub) };
  }

  @Get('merge/preview')
  @UseGuards(JwtAuthGuard)
  async mergePreview(@CurrentUser() user: AuthedUser, @Query('token') token: string) {
    const m = this.oidc.peekMerge(token || '');
    if (!m || m.toUserId !== user.sub) throw new UnauthorizedException('Invalid or expired merge request');
    return { token, ...(await this.users.mergePreview(m.toUserId, m.fromUserId)) };
  }

  @Post('merge/confirm')
  @UseGuards(JwtAuthGuard)
  async mergeConfirm(@CurrentUser() user: AuthedUser, @Body() body: { token: string }) {
    const m = this.oidc.consumeMerge(body?.token || '');
    if (!m || m.toUserId !== user.sub) throw new UnauthorizedException('Invalid or expired merge request');
    return this.users.mergeAccounts(m.toUserId, m.fromUserId);
  }

  @Delete('account')
  @UseGuards(JwtAuthGuard)
  async deleteAccount(@CurrentUser() user: AuthedUser) {
    return this.users.deleteAccount(user.sub);
  }

  @Delete(':provider/link')
  @UseGuards(JwtAuthGuard)
  async unlink(@CurrentUser() user: AuthedUser, @Param('provider') provider: string) {
    return this.users.unlinkProvider(user.sub, provider.toLowerCase());
  }

  @Public()
  @Get(':provider/link')
  async link(
    @Param('provider') provider: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const hashPrefix = this.frontendUrl().includes('#') ? this.frontendUrl() : `${this.frontendUrl()}/#`;
    try {
      const userId = this.oidc.consumeLinkToken(token || '');
      if (!userId) {
        return res.redirect(`${hashPrefix}/preferences?error=invalid_link_token`);
      }
      const oidcConfig = await this.oidc.getClient(provider);
      const codeVerifier = randomPKCECodeVerifier();
      const state = randomState();
      const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);

      this.oidc.storeVerifier(state, codeVerifier, provider, userId);

      const cfg = this.oidc.getProviderConfig(provider);
      const redirectTo = buildAuthorizationUrl(oidcConfig, {
        scope: cfg.scopes.join(' '),
        redirect_uri: this.oidc.redirectUriFor(provider),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      return res.redirect(redirectTo.href);
    } catch (e) {
      throw new UnauthorizedException((e as Error).message);
    }
  }

  @Public()
  @Get(':provider')
  async login(@Param('provider') provider: string, @Res() res: Response) {
    try {
      const oidcConfig = await this.oidc.getClient(provider);
      const codeVerifier = randomPKCECodeVerifier();
      const state = randomState();
      const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);

      this.oidc.storeVerifier(state, codeVerifier, provider);

      const cfg = this.oidc.getProviderConfig(provider);
      const redirectTo = buildAuthorizationUrl(oidcConfig, {
        scope: cfg.scopes.join(' '),
        redirect_uri: this.oidc.redirectUriFor(provider),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      return res.redirect(redirectTo.href);
    } catch (e) {
      throw new UnauthorizedException((e as Error).message);
    }
  }

  @Public()
  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Hash-location frontend (GitHub Pages): the route must live inside the
    // fragment, e.g. /#/auth/callback?access_token=... — a path-style
    // /auth/callback#access_token=... would 404 on static hosting and clash
    // with the router's own use of `#`.
    const hashPrefix = this.frontendUrl().includes('#') ? this.frontendUrl() : `${this.frontendUrl()}/#`;
    const verifier = this.oidc.consumeVerifier(state);
    // Link-flow errors go back to preferences (the session is still valid).
    const dest = verifier?.linkUserId ? 'preferences' : 'login';
    if (error) {
      return res.redirect(`${hashPrefix}/${dest}?error=${encodeURIComponent(error)}`);
    }
    if (!verifier || verifier.provider !== provider || !code) {
      return res.redirect(`${hashPrefix}/${dest}?error=invalid_state`);
    }

    const oidcConfig = await this.oidc.getClient(provider);
    // The code exchange replays exactly the redirect_uri registered with the IdP:
    // the public API URL, never the frontend one.
    const callbackUrl = new URL(`${this.apiPublicUrl()}${req.originalUrl}`);
    const redirectUri = this.oidc.redirectUriFor(provider);

    try {
      let profile;
      if (this.oidc.isOAuth2Only(provider)) {
        // Plain OAuth2 (GitHub): manual code exchange + userinfo, no OIDC tokenset
        // GitHub enforces PKCE: the code_challenge sent at authorize time must be
        // redeemed with its code_verifier here.
        const accessToken = await this.oidc.exchangeOAuth2Code(provider, code, redirectUri, verifier.codeVerifier);
        profile = await this.oidc.fetchOAuth2Profile(provider, accessToken);
      } else {
        const tokenset = await authorizationCodeGrant(oidcConfig, callbackUrl, {
          expectedState: state,
          pkceCodeVerifier: verifier.codeVerifier,
        });

        profile = await this.oidc.fetchProfile(provider, {
          access_token: tokenset.access_token,
          claims: () => tokenset.claims(),
        });
      }
      if (verifier.linkUserId) {
        const owner = await this.users.findIdentityOwner(profile);
        if (owner && owner !== verifier.linkUserId) {
          // Identity belongs to a *different* account: stage a merge
          // (absorption) pending explicit user confirmation.
          const mergeToken = this.oidc.createMergeToken(verifier.linkUserId, owner, provider);
          return res.redirect(`${hashPrefix}/preferences?merge=${mergeToken}`);
        }
        await this.users.linkProvider(verifier.linkUserId, profile);
        // Link flow: keep the current session, just confirm the new identity.
        return res.redirect(`${hashPrefix}/preferences?linked=${encodeURIComponent(provider)}`);
      }
      const user = await this.users.findOrCreateFromProfile(profile);
      if (!user) throw new UnauthorizedException('Account not found after linking');

      const token = this.jwt.sign(
        { sub: user.id, email: user.email, provider: user.provider },
        {
          secret: this.config.get<string>('JWT_SECRET'),
          expiresIn: (this.config.get<string>('JWT_EXPIRES_IN') || '7d') as any,
        },
      );

      res.cookie('access_token', token, this.cookieOptions());

      // Query inside the fragment (never the URL fragment `#access_token=`):
      // stays client-side and is parsed by the Angular router as queryParam.
      return res.redirect(`${hashPrefix}/auth/callback?access_token=${token}`);
    } catch (e) {
      // Link flow errors go back to preferences (session is still valid there).
      const dest = verifier.linkUserId ? 'preferences' : 'login';
      return res.redirect(
        `${hashPrefix}/${dest}?error=${encodeURIComponent((e as Error).message)}`,
      );
    }
  }

  private frontendUrl(): string {
    const raw =
      this.config.get<string>('FRONTEND_URL')?.split(',')[0]?.trim() ||
      'http://localhost:4200';
    return raw.replace(/\/+$/, '');
  }

  private apiPublicUrl(): string {
    const raw =
      this.config.get<string>('BACKEND_PUBLIC_URL')?.trim() ||
      this.frontendUrl().split(',')[0]?.trim() ||
      'http://localhost:4200';
    return raw.replace(/\/+$/, '');
  }

  /**
   * Session cookie carried by the API.
   * Same-origin: Lax is enough. Cross-origin (frontend on another domain):
   * SameSite=None + Secure are required, otherwise the browser rejects the cookie.
   */
  private cookieOptions(): { httpOnly: boolean; sameSite: 'lax' | 'none'; secure: boolean; maxAge: number; path: string } {
    const crossSite = this.isCrossSite();
    return {
      httpOnly: true,
      sameSite: crossSite ? 'none' : 'lax',
      secure: this.config.get<string>('NODE_ENV') === 'production' || crossSite,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    };
  }

  private isCrossSite(): boolean {
    try {
      const front = new URL(this.frontendUrl().split(',')[0].trim());
      const api = new URL(this.apiPublicUrl());
      return front.origin !== api.origin;
    } catch {
      return false;
    }
  }
}
