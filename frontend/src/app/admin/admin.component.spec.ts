import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../core/auth.service';
import { AdminComponent, AdminStats, AdminUser } from './admin.component';

const STATS: AdminStats = {
  users: {
    total: 3,
    new7d: 2,
    new30d: 2,
    byProvider: { google: 2, github: 1 },
    byChannel: { email: 2, telegram: 1 },
    byMode: { DIGEST: 2, IMMEDIATE: 1 },
    telegramLinked: 1,
    withPrereleases: 1,
  },
  artifacts: {
    follows: 5,
    distinct: 4,
    byEcosystem: { MAVEN: 3, NPM: 2 },
    top: [{ ecosystem: 'MAVEN', coordinates: 'org.springframework.boot:spring-boot', followers: 2 }],
    knownVersions: 1234,
  },
  notifications: {
    deliveriesByChannel: { email: { SENT: 4, FAILED: 1 } },
    sent24h: 1,
    sent7d: 4,
    failed7d: 1,
    events7d: 6,
  },
  listeners: { NPM: { lastSync: '2026-10-23T18:00:00Z' }, MAVEN: { lastSync: null } },
  system: { version: '0123456789abcdef', uptimeSeconds: 90_061, databaseBytes: 204_800 },
};

const user = (id: string, over: Partial<AdminUser> = {}): AdminUser => ({
  id,
  email: `${id}@example.test`,
  name: id.toUpperCase(),
  createdAt: '2026-10-01T00:00:00Z',
  providers: ['google'],
  follows: 0,
  channel: 'email',
  mode: 'DIGEST',
  telegramLinked: false,
  includePrereleases: false,
  lastNotifiedAt: null,
  isAdmin: false,
  ...over,
});

const USERS = [
  user('alice', { follows: 3, createdAt: '2026-10-20T00:00:00Z', lastNotifiedAt: '2026-10-22T10:00:00Z' }),
  user('bob', { follows: 1, createdAt: '2026-09-01T00:00:00Z', providers: ['github'], telegramLinked: true }),
  user('admin', { follows: 1, createdAt: '2026-10-10T00:00:00Z', isAdmin: true }),
];

describe('AdminComponent', () => {
  let fixture: ComponentFixture<AdminComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function render(stats: object | null = STATS, users: object | null = USERS) {
    TestBed.configureTestingModule({
      imports: [AdminComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        // no session-related requests: only the admin API is under test
        { provide: AuthService, useValue: { user: signal(null), authHeaders: () => ({}) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdminComponent);
    fixture.detectChanges();
    const answer = (url: string, body: object | null) =>
      body ? http.expectOne(url).flush(body) : http.expectOne(url).flush({}, { status: 403, statusText: 'Forbidden' });
    answer('/api/admin/stats', stats);
    answer('/api/admin/users', users);
    await fixture.whenStable();
    el = fixture.nativeElement;
  }

  const rows = () => [...el.querySelectorAll('tbody tr')].map((r) => r.querySelector('td')!.textContent!);
  const tileValues = () => [...el.querySelectorAll('.tile .value')].map((v) => v.textContent!.trim());

  afterEach(() => http.verify());

  it('shows the key figures', async () => {
    await render();
    expect(tileValues()).toEqual(['3', '5', '4', '1']);
    expect(el.querySelector('.tile.alert')).not.toBeNull(); // failures > 0
    expect(el.textContent).toContain('google 2 · github 1');
    expect(el.textContent).toContain('org.springframework.boot:spring-boot');
    expect(el.textContent).toContain('0123456');
    expect(el.textContent).toMatch(/1 (j|d) 1 h/); // 90 061 s, day unit depends on the language
  });

  it('lists users newest first', async () => {
    await render();
    expect(rows().map((r) => r.match(/(ALICE|BOB|ADMIN)/)![1])).toEqual(['ALICE', 'ADMIN', 'BOB']);
    expect(el.querySelector('.badge')!.textContent).toContain('admin');
  });

  it('filters by email, name, id or provider', async () => {
    await render();
    const input = el.querySelector('input[type=search]') as HTMLInputElement;
    input.value = 'github';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('BOB');
  });

  it('sorts by follows, toggling the direction', async () => {
    await render();
    // headers: follows, last sent, signed up
    const followsHeader = el.querySelectorAll('button.sort')[0];
    (followsHeader as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(rows()[0]).toContain('ALICE');
    (followsHeader as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(rows().at(-1)).toContain('ALICE');
    expect(followsHeader.textContent).toContain('▲');
  });

  it('reports an error when the API refuses', async () => {
    await render(null, null);
    expect(el.querySelector('.card.error')).not.toBeNull();
    expect(rows()).toHaveLength(0);
  });
});
