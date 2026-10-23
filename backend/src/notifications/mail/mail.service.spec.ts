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

  it('renders a digest with one line per version', () => {
    const html = service.renderDigest(
      [
        { ecosystem: 'NPM', coordinates: 'a', version: '1' },
        { ecosystem: 'MAVEN', coordinates: 'g:b', version: '2' },
      ],
      'fr',
    );
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain('g:b');
  });
});
