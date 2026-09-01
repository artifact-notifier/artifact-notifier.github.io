import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import * as Handlebars from 'handlebars';
import { t } from '../../i18n/notifications.i18n';

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

  async send(to: string, subject: string, html: string) {
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
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
    return template({ ...pkg, title: t(locale,'emailImmediateTitle'), intro: t(locale,'emailImmediateIntro'), ecoLabel: t(locale,'emailEcosystem'), artLabel: t(locale,'emailArtifact'), verLabel: t(locale,'emailVersion'), dashboard: t(locale,'emailDashboard') });
  }

  renderDigest(items: { coordinates: string; ecosystem: string; version: string }[], locale?: string) {
    const template = Handlebars.compile(`
      <h2>{{title}}</h2>
      <p>{{intro}}</p>
      <ul>
        {{#each items}}
          <li><strong>{{this.ecosystem}}</strong> – {{this.coordinates}} : {{this.version}}</li>
        {{/each}}
      </ul>
    `);
    return template({ items, title: t(locale,'emailDigestTitle'), intro: t(locale,'emailDigestIntro') });
  }
}
