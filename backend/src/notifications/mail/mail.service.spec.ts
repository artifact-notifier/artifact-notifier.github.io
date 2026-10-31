import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

describe('MailService', () => {
  const service = new MailService(
    new ConfigService({ SMTP_HOST: 'localhost', SMTP_PORT: 2525, MAIL_FROM: 'Notifier <n@example.test>' }),
  );

  it('sends through the SMTP transport with the configured sender', async () => {
    const sendMail = jest.spyOn((service as any).transporter, 'sendMail').mockResolvedValue({});
    await service.send('to@example.test', 'Subject', '<p>hi</p>');
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Notifier <n@example.test>',
      to: 'to@example.test',
      subject: 'Subject',
      html: '<p>hi</p>',
    });
  });

  it('rethrows transport errors so the delivery is retried', async () => {
    jest.spyOn((service as any).transporter, 'sendMail').mockRejectedValue(new Error('ECONNREFUSED'));
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    await expect(service.send('to@example.test', 's', 'h')).rejects.toThrow('ECONNREFUSED');
  });

  it('renders an escaped immediate message', () => {
    const html = service.renderImmediate({ ecosystem: 'NPM', coordinates: '<script>x', version: '1.0.0' }, 'en');
    expect(html).toContain('&lt;script&gt;x');
    expect(html).toContain('1.0.0');
  });

  it('renders a digest with one line per version, without heading when there is no project', () => {
    const html = service.renderDigest(
      [
        {
          project: null,
          items: [
            { ecosystem: 'NPM', coordinates: 'a', version: '1' },
            { ecosystem: 'MAVEN', coordinates: 'g:b', version: '2' },
          ],
        },
      ],
      'fr',
    );
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain('g:b');
    expect(html).not.toContain('<h3>');
  });

  it('renders one section per project, then the follows outside projects', () => {
    const html = service.renderDigest(
      [
        { project: 'shop <b>', items: [{ ecosystem: 'NPM', coordinates: 'a', version: '1' }] },
        { project: null, items: [{ ecosystem: 'NPM', coordinates: 'b', version: '2' }] },
      ],
      'fr',
    );
    expect(html.match(/<h3>[^<]*<\/h3>/g)).toEqual(['<h3>📁 shop &lt;b&gt;</h3>', '<h3>Hors projet</h3>']);
  });

  it('links each line to its unfollow page, and the footer to the dashboard and the unsubscribe page', () => {
    const html = service.renderDigest(
      [{ project: null, items: [{ ecosystem: 'NPM', coordinates: 'a', version: '1', followedArtifactId: 'f1' }] }],
      'en',
      {
        dashboard: 'https://app.test',
        unsubscribe: 'https://app.test/u?all',
        unfollow: (id) => `https://app.test/u?${id}`,
      },
    );
    expect(html).toContain('<a href="https://app.test/u?f1" style="font-size:12px;color:#6b7280">Unfollow</a>');
    expect(html).toContain('<a href="https://app.test">Manage my subscriptions</a>');
    expect(html).toContain('<a href="https://app.test/u?all">Stop receiving these emails</a>');
  });

  it('adds the one-click unsubscribe headers when given a URL', async () => {
    const sendMail = jest.spyOn((service as any).transporter, 'sendMail').mockResolvedValue({});
    await service.send('to@example.test', 's', 'h', 'https://api.test/api/unsubscribe?token=t');
    expect(sendMail.mock.lastCall?.[0]).toMatchObject({
      headers: {
        'List-Unsubscribe': '<https://api.test/api/unsubscribe?token=t>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
  });
});
