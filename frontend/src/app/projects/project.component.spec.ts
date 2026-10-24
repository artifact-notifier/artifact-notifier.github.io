import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { ToastService } from '../core/toast.service';
import { AuthService } from '../core/auth.service';
import { PreferencesService } from '../preferences/preferences.service';
import { ProjectComponent } from './project.component';
import { Project, ProjectsService } from './projects.service';

const PROJECT: Project = {
  id: 'p1',
  name: 'shop',
  notifyNewerOnly: false,
  createdAt: '2026-10-01T00:00:00Z',
  sources: [
    {
      id: 's1',
      label: 'front/package.json',
      kind: 'package.json',
      ecosystem: 'NPM',
      updatedAt: '2026-10-20T00:00:00Z',
      dependencies: [
        {
          coordinates: '@angular/core',
          declared: '^22.2.0',
          version: '22.2.3',
          scope: 'prod',
          followedArtifactId: 'f1',
          latestVersion: '22.3.0',
          outdated: true,
        },
        {
          coordinates: 'vitest',
          declared: '^5.0.0',
          version: null,
          scope: 'dev',
          followedArtifactId: null,
          latestVersion: null,
          outdated: false,
        },
      ],
    },
  ],
};

describe('ProjectComponent', () => {
  let fixture: ComponentFixture<ProjectComponent>;
  let el: HTMLElement;
  const projects = signal<Project[]>([PROJECT]);
  const projectsSvc = {
    projects,
    resource: { reload: vi.fn(), isLoading: () => false },
    update: vi.fn(),
    remove: vi.fn(),
    removeSource: vi.fn(),
  };
  const artifacts = { follow: vi.fn(), unfollow: vi.fn() };

  async function render(id = 'p1') {
    TestBed.configureTestingModule({
      imports: [ProjectComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ProjectsService, useValue: projectsSvc },
        { provide: ArtifactsService, useValue: artifacts },
        { provide: AuthService, useValue: { user: signal(null) } },
        { provide: PreferencesService, useValue: { resource: { value: signal(undefined), hasValue: () => false } } },
      ],
    });
    fixture = TestBed.createComponent(ProjectComponent);
    fixture.componentRef.setInput('id', id);
    await fixture.whenStable();
    el = fixture.nativeElement;
  }
  const cells = () =>
    [...el.querySelectorAll('tbody tr')].map((r) =>
      [...r.querySelectorAll('td')].slice(1).map((c) => c.textContent!.trim()),
    );
  const checkboxes = () => [...el.querySelectorAll<HTMLInputElement>('tbody input[type=checkbox]')];
  const button = (text: RegExp) =>
    [...el.querySelectorAll('button')].find((b) => text.test(b.textContent!)) as HTMLButtonElement;

  beforeEach(() => {
    localStorage.setItem('locale', 'en');
    projects.set([PROJECT]);
    Object.values(artifacts).forEach((f) => f.mockReset());
    [projectsSvc.update, projectsSvc.remove, projectsSvc.removeSource, projectsSvc.resource.reload].forEach((f) =>
      f.mockReset(),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('lists each source with its dependencies, used and latest versions', async () => {
    await render();
    expect(el.querySelector('h1')!.textContent).toContain('shop');
    expect(el.textContent).toContain('1 source(s) · 1 followed artifact(s)');
    expect(el.querySelector('.outdated-count')!.textContent).toContain('1 behind');
    expect(cells()).toEqual([
      ['@angular/core', 'prod', '22.2.3', '22.3.0 ⬆'],
      ['vitest', 'dev', '^5.0.0', '—'],
    ]);
    expect(checkboxes().map((c) => c.checked)).toEqual([true, false]);
    expect(projectsSvc.resource.reload).toHaveBeenCalled();
    expect(el.querySelector('a[href="/import?project=p1"]')).not.toBeNull();
  });

  it('follows and unfollows from the checkboxes', async () => {
    await render();
    checkboxes()[1].dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(artifacts.follow).toHaveBeenCalledWith('NPM', 'vitest');
    checkboxes()[0].dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(artifacts.unfollow).toHaveBeenCalledWith('f1');
  });

  it('reports a follow error', async () => {
    artifacts.follow.mockRejectedValue({ error: { message: 'At most 500 followed artifacts' } });
    await render();
    checkboxes()[1].dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toContain('500');
    expect(checkboxes()[1].disabled).toBe(false);
  });

  it('renames the project', async () => {
    await render();
    button(/Rename/).click();
    await fixture.whenStable();
    const input = el.querySelector('form input') as HTMLInputElement;
    input.value = ' boutique ';
    input.dispatchEvent(new Event('input'));
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(projectsSvc.update).toHaveBeenCalledWith('p1', { name: 'boutique' });
  });

  it('removes a source and the project after confirmation', async () => {
    projectsSvc.removeSource.mockResolvedValue({ orphans: [] });
    projectsSvc.remove.mockResolvedValue({ orphans: [] });
    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    button(/^\s*Remove\s*$/).click();
    await fixture.whenStable();
    expect(projectsSvc.removeSource).toHaveBeenCalledWith('p1', 's1');
    button(/Delete project/).click();
    await fixture.whenStable();
    expect(projectsSvc.remove).toHaveBeenCalledWith('p1');
    expect(navigate).toHaveBeenCalledWith(['/']);
  });

  it('does nothing when the deletion is not confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await render();
    button(/Delete project/).click();
    expect(projectsSvc.remove).not.toHaveBeenCalled();
  });

  it('says when the project does not exist', async () => {
    await render('nope');
    expect(el.textContent).toContain('Project not found');
  });

  it('toggles the newer-only option', async () => {
    await render();
    const option = el.querySelector('.option input') as HTMLInputElement;
    option.checked = true;
    option.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(projectsSvc.update).toHaveBeenCalledWith('p1', { notifyNewerOnly: true });
  });

  it('offers to unfollow what a deleted project leaves unused, then leaves', async () => {
    projectsSvc.remove.mockResolvedValue({
      orphans: [{ followedArtifactId: 'f1', ecosystem: 'NPM', coordinates: '@angular/core' }],
    });
    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    button(/Delete project/).click();
    await fixture.whenStable();
    expect(el.querySelector('app-orphans-dialog')!.textContent).toContain('@angular/core');
    expect(navigate).not.toHaveBeenCalled();
    button(/Keep them/).click();
    await fixture.whenStable();
    expect(el.querySelector('app-orphans-dialog')).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/']);
  });
});
