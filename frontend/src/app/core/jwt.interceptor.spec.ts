import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { jwtInterceptor } from './jwt.interceptor';

describe('jwtInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  const auth = { handleUnauthorized: vi.fn() };

  beforeEach(() => {
    localStorage.clear();
    auth.handleUnauthorized.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withInterceptors([jwtInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('sends credentials and the stored Bearer token', async () => {
    localStorage.setItem('artifact-notifier.accessToken', 'tok');
    const done = firstValueFrom(http.get('/api/artifacts'));
    const req = backend.expectOne('/api/artifacts');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok');
    req.flush([]);
    await done;
  });

  it('keeps an explicit Authorization header', async () => {
    localStorage.setItem('artifact-notifier.accessToken', 'tok');
    const done = firstValueFrom(http.get('/api/x', { headers: { Authorization: 'Bearer other' } }));
    const req = backend.expectOne('/api/x');
    expect(req.request.headers.get('Authorization')).toBe('Bearer other');
    req.flush({});
    await done;
  });

  it('sends no Authorization header without a token', async () => {
    const done = firstValueFrom(http.get('/api/x'));
    const req = backend.expectOne('/api/x');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
    await done;
  });

  it('sends the user back to login on a 401 from a protected endpoint', async () => {
    const done = firstValueFrom(http.get('/api/artifacts'));
    backend.expectOne('/api/artifacts').flush({}, { status: 401, statusText: 'Unauthorized' });
    await expect(done).rejects.toMatchObject({ status: 401 });
    expect(auth.handleUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('ignores 401s from the public auth endpoints (no redirect loop)', async () => {
    const done = firstValueFrom(http.get('/api/auth/me'));
    backend.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    await expect(done).rejects.toMatchObject({ status: 401 });
    expect(auth.handleUnauthorized).not.toHaveBeenCalled();
  });

  it('lets other errors through untouched', async () => {
    const done = firstValueFrom(http.get('/api/artifacts'));
    backend.expectOne('/api/artifacts').flush({}, { status: 500, statusText: 'Server Error' });
    await expect(done).rejects.toMatchObject({ status: 500 });
    expect(auth.handleUnauthorized).not.toHaveBeenCalled();
  });
});
