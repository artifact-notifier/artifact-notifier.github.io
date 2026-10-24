import { provideZonelessChangeDetection, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ArtifactsService, FollowedArtifact } from '../artifacts/artifacts.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { PreferencesService } from '../preferences/preferences.service';
import { DashboardComponent } from './dashboard.component';

/** Minimal stand-in for an httpResource (value() + hasValue()). */
function fakeResource<T>(value: WritableSignal<T>) {
  return { value, hasValue: () => value() !== undefined, reload: vi.fn() };
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const ARTIFACTS: FollowedArtifact[] = [
  {
    id: 'a1',
    ecosystem: 'MAVEN',
    coordinates: 'org.springframework.boot:spring-boot',
    currentVersion: '4.1.2',
    events: [
      {
        version: '4.1.2',
        publishedAt: minutesAgo(90),
        deliveries: [
          { channel: 'email', status: 'SENT', sentAt: minutesAgo(5) },
          { channel: 'telegram', status: 'PENDING', sentAt: null },
        ],
      },
      { version: '4.0.9', publishedAt: '2026-01-01T10:00:00Z', deliveries: [] },
    ],
  },
  { id: 'a2', ecosystem: 'NPM', coordinates: '@angular/core', currentVersion: '22.2.3', events: [] },
  { id: 'a3', ecosystem: 'PYPI', coordinates: 'django', currentVersion: '6.1.2', events: [] },
];

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let el: HTMLElement;
  let http: HttpTestingController;
  const artifactsSvc = {
    follow: vi.fn(),
    unfollow: vi.fn(),
    simulateTestVersion: vi.fn(),
    bumpTestVersion: vi.fn(),
  };

  async function settle() {
    TestBed.tick();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }

  /** Answers every pending GET of `url` (path only: the search carries its query in the URL). */
  function answer(url: string, body: object) {
    http.match((r) => r.url.split('?')[0] === url).forEach((r) => r.flush(body));
  }

  async function render(
    ecosystems: string[] = ['NPM', 'MAVEN', 'PYPI'],
    artifacts = ARTIFACTS,
    projects: object[] = [],
  ) {
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }), authHeaders: () => ({}) } },
        { provide: ArtifactsService, useValue: artifactsSvc },
        { provide: PreferencesService, useValue: { resource: fakeResource(signal(undefined)), update: vi.fn() } },
      ],
    });
    fixture = TestBed.createComponent(DashboardComponent);
    el = fixture.nativeElement;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    TestBed.tick();
    answer('/api/artifacts/ecosystems', ecosystems);
    answer('/api/artifacts', artifacts);
    answer('/api/projects', projects);
    answer('/api/artifacts/sync-status', {
      NPM: { lastSync: minutesAgo(0.2) },
      MAVEN: { lastSync: minutesAgo(3.5) },
      PYPI: { lastSync: '2026-01-01T10:00:00Z' },
    });
    await settle();
  }

  const rows = () => [...el.querySelectorAll('.coords-cell')].map((c) => c.textContent?.trim());
  const toasts = () => TestBed.inject(ToastService).toasts();
  const button = (text: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('locale', 'en');
    Object.values(artifactsSvc).forEach((f) => f.mockReset());
  });

  afterEach(() => fixture?.destroy());

  describe('projects', () => {
    const dep = (coordinates: string) => ({
      coordinates,
      declared: null,
      version: null,
      scope: 'prod',
      followedArtifactId: null,
      latestVersion: null,
      outdated: coordinates === '@angular/core',
    });
    const PROJECTS = [
      {
        id: 'p1',
        name: 'shop',
        createdAt: '2026-10-01T00:00:00Z',
        sources: [
          {
            id: 's1',
            label: 'front/package.json',
            kind: 'package.json',
            ecosystem: 'NPM',
            updatedAt: '',
            dependencies: [dep('@angular/core')],
          },
          {
            id: 's2',
            label: 'back/pom.xml',
            kind: 'pom.xml',
            ecosystem: 'MAVEN',
            updatedAt: '',
            dependencies: [dep('org.springframework.boot:spring-boot')],
          },
        ],
      },
    ];

    it('links each project with its number of followed artifacts', async () => {
      await render(undefined, undefined, PROJECTS);
      const link = el.querySelector('.projects-card a.chip') as HTMLAnchorElement;
      expect(link.textContent?.replace(/\s+/g, ' ').trim()).toBe('shop (2) ⬆1');
      expect(link.getAttribute('href')).toBe('/projects/p1');
      expect(el.querySelector('.projects-card a[href="/import"]')).not.toBeNull();
    });

    it('invites to import when there is no project yet', async () => {
      await render();
      expect(el.querySelector('.projects-card a.chip')).toBeNull();
      expect(el.querySelector('select[aria-label]')).toBeNull();
    });

    it('filters the list by project, or outside any project', async () => {
      await render(undefined, undefined, PROJECTS);
      const select = el.querySelector('.toolbar-right select') as HTMLSelectElement;
      select.value = 'p1';
      select.dispatchEvent(new Event('change'));
      await settle();
      expect(rows()).toEqual(['@angular/core', 'org.springframework.boot:spring-boot']);
      select.value = 'NONE';
      select.dispatchEvent(new Event('change'));
      await settle();
      expect(rows()).toEqual(['django']);
    });
  });

  describe('pagination', () => {
    // 60 artifacts named pkg-00 … pkg-59 (sorted by name)
    const MANY: FollowedArtifact[] = Array.from({ length: 60 }, (_, i) => ({
      id: `m${i}`,
      ecosystem: 'NPM',
      coordinates: `pkg-${String(i).padStart(2, '0')}`,
      currentVersion: '1.0.0',
      events: [],
    }));
    const pager = () => el.querySelector('nav.pager') as HTMLElement;
    const pagerButton = (label: string) => pager().querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
    const range = () => pager().querySelector('.range')!.textContent!.trim();

    it('shows 25 artifacts per page and moves between pages', async () => {
      await render(undefined, MANY);
      expect(rows()).toHaveLength(25);
      expect(rows()[0]).toBe('pkg-00');
      expect(range()).toBe('1–25 of 60');
      expect(pagerButton('Previous page').disabled).toBe(true);

      pagerButton('Next page').click();
      await settle();
      expect(rows()[0]).toBe('pkg-25');
      expect(range()).toBe('26–50 of 60');

      pagerButton('Last page').click();
      await settle();
      expect(rows()).toHaveLength(10);
      expect(range()).toBe('51–60 of 60');
      expect(pagerButton('Next page').disabled).toBe(true);

      pagerButton('First page').click();
      await settle();
      expect(rows()[0]).toBe('pkg-00');
    });

    it('remembers the page size', async () => {
      await render(undefined, MANY);
      const size = pager().querySelector('select') as HTMLSelectElement;
      size.value = '50';
      size.dispatchEvent(new Event('change'));
      await settle();
      expect(rows()).toHaveLength(50);
      expect(localStorage.getItem('artifact-notifier.pageSize')).toBe('50');
    });

    it('goes back to the first page when the filter changes', async () => {
      await render(undefined, MANY);
      pagerButton('Last page').click();
      await settle();
      const filter = el.querySelector('.filter-input') as HTMLInputElement;
      filter.value = 'pkg-3';
      filter.dispatchEvent(new Event('input'));
      await settle();
      expect(rows()).toEqual([
        'pkg-30',
        'pkg-31',
        'pkg-32',
        'pkg-33',
        'pkg-34',
        'pkg-35',
        'pkg-36',
        'pkg-37',
        'pkg-38',
        'pkg-39',
      ]);
      // a single page: no pager
      expect(pager()).toBeNull();
    });

    it('has no pager for a short list', async () => {
      await render();
      expect(pager()).toBeNull();
    });
  });

  describe('list', () => {
    it('shows the followed artifacts sorted by name, with the sync status', async () => {
      await render();
      expect(rows()).toEqual(['@angular/core', 'django', 'org.springframework.boot:spring-boot']);
      expect(el.textContent).toContain('3 artifact(s)');
      const sync = el.querySelector('.sync-card')!.textContent!;
      expect(sync).toMatch(/seconds? ago|now/);
      expect(sync).toContain('3 minutes ago');
      expect(sync).toContain('01/01/2026');
    });

    it('filters by ecosystem and by text', async () => {
      await render();
      (el.querySelectorAll('.chip')[3] as HTMLButtonElement).click(); // All, npm, Maven, PyPI
      fixture.detectChanges();
      expect(rows()).toEqual(['django']);

      (el.querySelector('.chip') as HTMLButtonElement).click(); // All
      const filter = el.querySelector('.filter-input') as HTMLInputElement;
      filter.value = 'SPRING';
      filter.dispatchEvent(new Event('input'));
      await settle();
      expect(rows()).toEqual(['org.springframework.boot:spring-boot']);

      filter.value = 'nothing-matches';
      filter.dispatchEvent(new Event('input'));
      await settle();
      expect(el.textContent).toContain('No results');
    });

    it('sorts by name and by ecosystem (mouse and keyboard)', async () => {
      await render();
      const [typeSort, nameSort] = [...el.querySelectorAll('.sortable')] as HTMLElement[];
      nameSort.click();
      fixture.detectChanges();
      expect(rows()[0]).toBe('org.springframework.boot:spring-boot');
      expect(nameSort.getAttribute('aria-sort')).toBe('descending');

      typeSort.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();
      expect(rows()).toEqual(['org.springframework.boot:spring-boot', '@angular/core', 'django']);
      typeSort.click();
      fixture.detectChanges();
      expect(rows()).toEqual(['django', '@angular/core', 'org.springframework.boot:spring-boot']);
      expect(typeSort.textContent).toContain('▼');
    });

    it('expands the notification history of an artifact', async () => {
      await render();
      button('+ 2').click();
      fixture.detectChanges();
      const detail = el.querySelector('.events-detail')!;
      expect(detail.textContent).toContain('v4.1.2');
      expect(detail.querySelector('.delivery-pill.sent')?.textContent).toContain('email');
      expect(detail.querySelector('.delivery-pill.pending')?.textContent).toContain('PENDING');
      button('− 2').click();
      fixture.detectChanges();
      expect(el.querySelector('.events-detail')).toBeNull();
    });

    it('explains an empty list', async () => {
      await render(undefined, []);
      expect(el.textContent).toContain('You are not following any artifact yet.');
    });
  });

  describe('unfollow', () => {
    it('asks for confirmation, then unfollows', async () => {
      await render();
      artifactsSvc.unfollow.mockResolvedValue(undefined);
      (el.querySelector('.dense-row .btn.danger') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el.querySelector('[role=dialog]')?.textContent).toContain('@angular/core');

      button('Confirm').click();
      await settle();
      expect(artifactsSvc.unfollow).toHaveBeenCalledWith('a2');
      expect(el.querySelector('[role=dialog]')).toBeNull();
      expect(toasts().at(-1)).toMatchObject({ kind: 'success', message: 'No longer following @angular/core' });
    });

    it('reports a failure', async () => {
      await render();
      artifactsSvc.unfollow.mockRejectedValue({ error: { message: 'Not found' } });
      (el.querySelector('.dense-row .btn.danger') as HTMLButtonElement).click();
      fixture.detectChanges();
      button('Confirm').click();
      await settle();
      expect(toasts().at(-1)).toMatchObject({ kind: 'error', message: 'Not found' });
    });

    it('can be cancelled (button, Escape or backdrop)', async () => {
      await render();
      const open = () => {
        (el.querySelector('.dense-row .btn.danger') as HTMLButtonElement).click();
        fixture.detectChanges();
        return el.querySelector('.overlay') as HTMLElement;
      };
      open().querySelector<HTMLButtonElement>('.btn.secondary')!.click();
      fixture.detectChanges();
      expect(el.querySelector('[role=dialog]')).toBeNull();

      open().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(el.querySelector('[role=dialog]')).toBeNull();

      // a click inside the dialog keeps it open, on the backdrop closes it
      const overlay = open();
      (overlay.querySelector('[role=dialog]') as HTMLElement).click();
      fixture.detectChanges();
      expect(el.querySelector('[role=dialog]')).not.toBeNull();
      overlay.click();
      fixture.detectChanges();
      expect(el.querySelector('[role=dialog]')).toBeNull();
      expect(artifactsSvc.unfollow).not.toHaveBeenCalled();
    });
  });

  describe('search and follow', () => {
    async function search(q: string, results: object[]) {
      const input = el.querySelector('.search-input') as HTMLInputElement;
      input.value = q;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r, 400)); // debounce
      TestBed.tick();
      answer('/api/artifacts/search', results);
      await settle();
      return input;
    }
    const key = (input: HTMLInputElement, k: string) => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true }));
      fixture.detectChanges();
    };
    const options = () => [...el.querySelectorAll('[role=option]')];

    it('suggests matches after a debounce and follows the highlighted one with Enter', async () => {
      await render();
      artifactsSvc.follow.mockResolvedValue({});
      const input = await search('rea', [
        { coordinates: 'react', description: 'UI library' },
        { coordinates: 'react-dom' },
      ]);
      expect(http.match(() => true)).toEqual([]);
      expect(options().map((o) => o.querySelector('.coords')?.textContent)).toEqual(['react', 'react-dom']);
      expect(options()[0].getAttribute('aria-selected')).toBe('true');

      key(input, 'ArrowDown');
      key(input, 'ArrowDown'); // stays on the last one
      expect(options()[1].getAttribute('aria-selected')).toBe('true');
      key(input, 'ArrowUp');
      key(input, 'ArrowDown');
      key(input, 'Enter');
      await settle();

      expect(artifactsSvc.follow).toHaveBeenCalledWith('NPM', 'react-dom');
      expect(toasts().at(-1)).toMatchObject({ kind: 'success', message: 'Now following react-dom' });
      expect(input.value).toBe('');
    });

    it('preselects the exact match and follows on click', async () => {
      await render();
      artifactsSvc.follow.mockResolvedValue({});
      await search('react', [{ coordinates: 'react-dom' }, { coordinates: 'react' }]);
      expect(options()[1].getAttribute('aria-selected')).toBe('true');
      expect(options()[1].querySelector('.badge')?.textContent).toBe('exact');

      options()[0].dispatchEvent(new MouseEvent('mouseenter'));
      options()[0].dispatchEvent(new MouseEvent('mousedown'));
      await settle();
      expect(artifactsSvc.follow).toHaveBeenCalledWith('NPM', 'react-dom');
    });

    it('says when nothing matches, and closes with Escape', async () => {
      await render();
      const input = await search('zzz', []);
      expect(el.querySelector('.suggest .empty')?.textContent).toContain('No results');
      key(input, 'ArrowDown'); // nothing to move to
      key(input, 'Enter'); // nothing to follow
      key(input, 'Escape');
      expect(el.querySelector('.suggest')).toBeNull();
      expect(artifactsSvc.follow).not.toHaveBeenCalled();
    });

    it('reports a follow error', async () => {
      await render();
      artifactsSvc.follow.mockRejectedValue({ error: { message: 'Unknown artifact' } });
      const input = await search('react', [{ coordinates: 'react' }]);
      key(input, 'Enter');
      await settle();
      expect(toasts().at(-1)).toMatchObject({ kind: 'error', message: 'Unknown artifact' });
    });

    it('closes the suggestions shortly after leaving the field', async () => {
      await render();
      const input = await search('react', [{ coordinates: 'react' }]);
      input.dispatchEvent(new Event('blur'));
      await new Promise((r) => setTimeout(r, 200));
      fixture.detectChanges();
      expect(el.querySelector('.suggest')).toBeNull();
    });

    it('searches in the selected ecosystem', async () => {
      await render(['MAVEN', 'PYPI']);
      // NPM is not offered by the backend: the first available one is selected
      expect(el.querySelector('.eco-trigger')?.textContent).toContain('Maven');
      const input = el.querySelector('.search-input') as HTMLInputElement;
      input.value = 'spring';
      input.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 400));
      TestBed.tick();
      const req = http.expectOne((r) => r.url.startsWith('/api/artifacts/search'));
      expect(req.request.url).toBe('/api/artifacts/search?ecosystem=MAVEN&q=spring');
      req.flush([]);
    });
  });

  describe('test mode', () => {
    const testArtifact: FollowedArtifact = {
      id: 't1',
      ecosystem: 'TEST',
      coordinates: 'my/pkg',
      currentVersion: '1.0.0',
      events: [],
    };

    it('is hidden unless the backend exposes the TEST ecosystem', async () => {
      await render();
      expect(el.querySelector('.test-card')).toBeNull();
    });

    it('simulates a version for an artifact', async () => {
      await render(['NPM', 'TEST'], [testArtifact]);
      artifactsSvc.simulateTestVersion.mockResolvedValue({});
      (el.querySelector('.test-card .btn') as HTMLButtonElement).click();
      expect(toasts().at(-1)).toMatchObject({ kind: 'error' }); // coordinates required

      const coords = el.querySelector('#test-coords') as HTMLInputElement;
      coords.value = 'my/pkg';
      coords.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      (el.querySelector('.test-card .btn') as HTMLButtonElement).click();
      await settle();
      expect(artifactsSvc.simulateTestVersion).toHaveBeenCalledWith('my/pkg', '1.1.0');
      expect(toasts().at(-1)).toMatchObject({ kind: 'success' });

      artifactsSvc.simulateTestVersion.mockRejectedValue({ error: { message: 'disabled' } });
      (el.querySelector('.test-card .btn') as HTMLButtonElement).click();
      await settle();
      expect(toasts().at(-1)).toMatchObject({ kind: 'error', message: 'disabled' });
    });

    it('bumps a TEST artifact to the typed version', async () => {
      await render(['NPM', 'TEST'], [testArtifact]);
      artifactsSvc.bumpTestVersion.mockResolvedValue({});
      const bumpInput = el.querySelector('.dense-row input') as HTMLInputElement;
      bumpInput.value = '2.0.0';
      bumpInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      (el.querySelector('.dense-row .btn.small:not(.danger)') as HTMLButtonElement).click();
      await settle();
      expect(artifactsSvc.bumpTestVersion).toHaveBeenCalledWith('t1', '2.0.0');
      expect(bumpInput.value).toBe('');

      artifactsSvc.bumpTestVersion.mockRejectedValue(new Error('boom'));
      (el.querySelector('.dense-row .btn.small:not(.danger)') as HTMLButtonElement).click();
      await settle();
      // falls back to the simulate version field
      expect(artifactsSvc.bumpTestVersion).toHaveBeenLastCalledWith('t1', '1.1.0');
      expect(toasts().at(-1)).toMatchObject({ kind: 'error', message: 'boom' });
    });
  });
});
