import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../core/auth.service';
import { artifactKey, ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  let svc: ProjectsService;
  let http: HttpTestingController;
  const user = signal<object | null>(null);

  beforeEach(() => {
    user.set(null);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user, authHeaders: () => ({ Authorization: 'Bearer t' }) } },
      ],
    });
    svc = TestBed.inject(ProjectsService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => vi.restoreAllMocks());

  it('loads the projects once logged in and indexes their artifacts', async () => {
    TestBed.tick();
    expect(http.match('/api/projects')).toHaveLength(0);
    user.set({ id: 'u1' });
    TestBed.tick();
    http.expectOne('/api/projects').flush([
      {
        id: 'p1',
        name: 'shop',
        sources: [{ ecosystem: 'NPM', dependencies: [{ coordinates: 'rxjs' }, { coordinates: 'zone.js' }] }],
      },
    ]);
    await new Promise((r) => setTimeout(r));
    expect(svc.projects().map((p) => p.name)).toEqual(['shop']);
    expect([...svc.keysByProject().get('p1')!]).toEqual([artifactKey('NPM', 'rxjs'), artifactKey('NPM', 'zone.js')]);
  });

  it('sends the import, rename and deletions with the session, then reloads', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"projectId":"p1"}'));
    const reload = vi.spyOn(svc.resource, 'reload');
    await svc.importProject({ projectName: 'x', sources: [], follow: [] });
    await svc.rename('p1', 'y');
    await svc.removeSource('p1', 's1');
    await svc.remove('p1');
    expect(fetchSpy.mock.calls.map(([url, init]) => `${init!.method} ${url}`)).toEqual([
      'POST /api/projects/import',
      'PATCH /api/projects/p1',
      'DELETE /api/projects/p1/sources/s1',
      'DELETE /api/projects/p1',
    ]);
    expect((fetchSpy.mock.calls[0][1]!.headers as Record<string, string>)['Authorization']).toBe('Bearer t');
    expect(reload).toHaveBeenCalledTimes(4);
  });

  it('surfaces the API error message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'A project with this name already exists' }), { status: 409 }),
    );
    await expect(svc.rename('p1', 'dup')).rejects.toEqual({ message: 'A project with this name already exists' });
  });
});
