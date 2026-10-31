import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import * as Handlebars from 'handlebars';
import { t } from '../../i18n/notifications.i18n';
import { DigestGroup, digestHeading as heading } from '../digest';

/** Links of a digest mail: dashboard, stop every mail, unfollow one artifact. */
export interface DigestLinks {
  dashboard: string;
  unsubscribe: string;
  unfollow: (followedArtifactId: string) => string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    this.from = this.config.get<string>('MAIL_FROM') || 'no-reply@artifact-notifier.dev';
    this.transporter = createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT'),
      secure: false,
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });
  }

  /** `unsubscribeUrl`: one-click target (RFC 8058), shown by mail clients next to the sender. */
  async send(to: string, subject: string, html: string, unsubscribeUrl?: string) {
    const headers = unsubscribeUrl
      ? { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      : undefined;
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html, headers });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (e) {
      this.logger.error(`Failed to send email to ${to}: ${(e as Error).message}`);
      throw e;
    }
  }

  renderImmediate(pkg: { coordinates: string; ecosystem: string; version: string }, locale?: string) {
    const template = Handlebars.compile(`
      <h2>{{title}}</h2>
      <p>{{intro}}</p>
      <ul>
        <li><strong>{{ecoLabel}} :</strong> {{ecosystem}}</li>
        <li><strong>{{artLabel}} :</strong> {{coordinates}}</li>
        <li><strong>{{verLabel}} :</strong> {{version}}</li>
      </ul>
      <p>{{dashboard}}</p>
    `);
    return template({
      ...pkg,
      title: t(locale, 'emailImmediateTitle'),
      intro: t(locale, 'emailImmediateIntro'),
      ecoLabel: t(locale, 'emailEcosystem'),
      artLabel: t(locale, 'emailArtifact'),
      verLabel: t(locale, 'emailVersion'),
      dashboard: t(locale, 'emailDashboard'),
    });
  }

  renderDigest(groups: DigestGroup[], locale?: string, links?: DigestLinks) {
    const template = Handlebars.compile(`
      <h2>{{title}}</h2>
      <p>{{intro}}</p>
      {{#each groups}}
        {{#if this.heading}}<h3>{{this.heading}}</h3>{{/if}}
        <ul>
          {{#each this.items}}
            <li><strong>{{this.ecosystem}}</strong> – {{this.coordinates}} : {{this.version}}{{#if this.unfollowUrl}} <a href="{{this.unfollowUrl}}" style="font-size:12px;color:#6b7280">{{../../unfollowLabel}}</a>{{/if}}</li>
          {{/each}}
        </ul>
      {{/each}}
      {{#if links}}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
        <p style="font-size:12px;color:#6b7280">
          <a href="{{links.dashboard}}">{{dashboardLabel}}</a> · <a href="{{links.unsubscribe}}">{{unsubscribeLabel}}</a>
        </p>
      {{/if}}
    `);
    const unfollowUrl = (id?: string) => (links && id ? links.unfollow(id) : undefined);
    return template({
      groups: groups.map((g) => ({
        heading: heading(g, groups, locale),
        items: g.items.map((i) => ({ ...i, unfollowUrl: unfollowUrl(i.followedArtifactId) })),
      })),
      title: t(locale, 'emailDigestTitle'),
      intro: t(locale, 'emailDigestIntro'),
      links,
      unfollowLabel: t(locale, 'emailUnfollow'),
      dashboardLabel: t(locale, 'emailManage'),
      unsubscribeLabel: t(locale, 'emailUnsubscribe'),
    });
  }
}
