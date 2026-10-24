import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { PreferencesService } from '../preferences/preferences.service';
import { OrphansDialogComponent } from './orphans-dialog.component';

const ORPHANS = [
  { followedArtifactId: 'f1', ecosystem: 'NPM' as const, coordinates: 'rxjs' },
  { followedArtifactId: 'f2', ecosystem: 'MAVEN' as const, coordinates: 'org.example:lib' },
];

describe('OrphansDialogComponent', () => {
  let fixture: ComponentFixture<OrphansDialogComponent>;
  let el: HTMLElement;
  const artifacts = { unfollow: vi.fn() };
  let done: () => void;

  async function render() {
    TestBed.configureTestingModule({
      imports: [OrphansDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ArtifactsService, useValue: artifacts },
        { provide: AuthService, useValue: { user: signal(null) } },
        { provide: PreferencesService, useValue: { resource: { value: signal(undefined), hasValue: () => false } } },
      ],
    });
    fixture = TestBed.createComponent(OrphansDialogComponent);
    fixture.componentRef.setInput('orphans', ORPHANS);
    done = vi.fn<() => void>();
    fixture.componentInstance.done.subscribe(done);
    await fixture.whenStable();
    el = fixture.nativeElement;
  }
  const button = (text: RegExp) =>
    [...el.querySelectorAll('button')].find((b) => text.test(b.textContent!)) as HTMLButtonElement;

  beforeEach(() => {
    localStorage.setItem('locale', 'en');
    artifacts.unfollow.mockReset();
  });

  it('unfollows the checked artifacts (all by default)', async () => {
    await render();
    el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1].dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(button(/Unfollow/).textContent).toContain('(1)');
    button(/Unfollow/).click();
    await fixture.whenStable();
    expect(artifacts.unfollow.mock.calls).toEqual([['f1']]);
    expect(TestBed.inject(ToastService).toasts()[0].message).toContain('1 follow(s) removed');
    expect(done).toHaveBeenCalled();
  });

  it('keeps everything', async () => {
    await render();
    button(/Keep them/).click();
    expect(artifacts.unfollow).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalled();
  });

  it('reports an unfollow error and still closes', async () => {
    artifacts.unfollow.mockRejectedValue({ error: { message: 'boom' } });
    await render();
    button(/Unfollow/).click();
    await fixture.whenStable();
    expect(TestBed.inject(ToastService).toasts()[0]).toMatchObject({ kind: 'error', message: 'boom' });
    expect(done).toHaveBeenCalled();
  });
});
