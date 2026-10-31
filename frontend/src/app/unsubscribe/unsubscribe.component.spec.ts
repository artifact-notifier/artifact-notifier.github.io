import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { PreferencesService } from '../preferences/preferences.service';
import { UnsubscribeComponent } from './unsubscribe.component';

describe('UnsubscribeComponent', () => {
  let fixture: ComponentFixture<UnsubscribeComponent>;
  let fetchMock: ReturnType<typeof vi.fn>;
  const json = (body: object, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

  async function render(token: string | null) {
    TestBed.configureTestingModule({
      imports: [UnsubscribeComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap(token ? { token } : {})) },
        },
        { provide: PreferencesService, useValue: { resource: { value: () => undefined, hasValue: () => false } } },
      ],
    });
    fixture = TestBed.createComponent(UnsubscribeComponent);
    fixture.detectChanges();
    await settle();
  }

  async function settle() {
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent!;
  const confirmButton = () =>
    (fixture.nativeElement as HTMLElement).querySelector('button.danger') as HTMLButtonElement;

  beforeEach(() => {
    localStorage.setItem('locale', 'en');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fixture?.destroy();
  });

  it('asks before unfollowing one artifact, then confirms it', async () => {
    fetchMock
      .mockReturnValueOnce(json({ scope: 'artifact', active: true, ecosystem: 'NPM', coordinates: 'react' }))
      .mockReturnValueOnce(json({ scope: 'artifact', active: false }));
    await render('tok.sig');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/unsubscribe?token=tok.sig');
    expect(text()).toContain('Unfollow react?');

    confirmButton().click();
    await settle();
    expect(fetchMock.mock.calls[1]).toEqual(['/api/unsubscribe?token=tok.sig', { method: 'POST' }]);
    expect(text()).toContain('react is no longer followed.');
  });

  it('stops every mail', async () => {
    fetchMock
      .mockReturnValueOnce(json({ scope: 'all', active: true }))
      .mockReturnValueOnce(json({ scope: 'all', active: false }));
    await render('tok.sig');
    expect(text()).toContain('Stop receiving notification emails?');
    confirmButton().click();
    await settle();
    expect(text()).toContain('you will no longer receive notification emails');
    expect(text()).toContain('turn them back on');
  });

  it('says when it is already done', async () => {
    fetchMock.mockReturnValueOnce(json({ scope: 'all', active: false }));
    await render('tok.sig');
    expect(text()).toContain('You already no longer receive');
    expect(confirmButton()).toBeNull();
  });

  it('rejects a missing or invalid token', async () => {
    await render(null);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text()).toContain('This unsubscribe link is not valid.');
    fixture.destroy();
    TestBed.resetTestingModule();

    fetchMock.mockReturnValueOnce(json({ message: 'Invalid unsubscribe link' }, 404));
    await render('bad');
    expect(text()).toContain('This unsubscribe link is not valid.');
  });
});
