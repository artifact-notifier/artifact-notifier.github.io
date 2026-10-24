import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { PreferencesService } from '../preferences/preferences.service';
import { Project, ProjectsService } from '../projects/projects.service';
import { defaultProjectName, ImportComponent } from './import.component';

const PACKAGE_JSON = JSON.stringify({
  dependencies: { '@angular/core': '^22.2.0', rxjs: '~7.8.0' },
  devDependencies: { vitest: '^5.0.0' },
});
const POM = `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>4.1.2</version></parent>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
  </dependencies>
</project>`;

function file(path: string, content: string) {
  const name = path.split('/').pop()!;
  const f = new File([content], name);
  Object.defineProperty(f, 'webkitRelativePath', { value: path.includes('/') ? path : '' });
  return f;
}

describe('ImportComponent', () => {
  let fixture: ComponentFixture<ImportComponent>;
  let el: HTMLElement;
  let http: HttpTestingController;
  const projects = signal<Project[]>([]);
  const projectsSvc = { projects, importProject: vi.fn() };

  async function render(projectId?: string, followed: object[] = []) {
    TestBed.configureTestingModule({
      imports: [ImportComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ProjectsService, useValue: projectsSvc },
        { provide: AuthService, useValue: { user: signal(null), authHeaders: () => ({}) } },
        { provide: PreferencesService, useValue: { resource: { value: signal(undefined), hasValue: () => false } } },
      ],
    });
    fixture = TestBed.createComponent(ImportComponent);
    if (projectId) fixture.componentRef.setInput('project', projectId);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/artifacts').flush(followed);
    await fixture.whenStable();
    el = fixture.nativeElement;
  }

  async function pick(files: File[]) {
    const input = el.querySelector('input[type=file][multiple]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    // parsing is async (file reads)
    for (let i = 0; i < 20 && !el.querySelector('.source-head'); i++) {
      await new Promise((r) => setTimeout(r, 10));
      await fixture.whenStable();
    }
  }

  const sourceLabels = () => [...el.querySelectorAll<HTMLInputElement>('input.label')].map((i) => i.value);
  const checked = () =>
    [...el.querySelectorAll<HTMLInputElement>('.deps input[type=checkbox]')]
      .filter((c) => c.checked)
      .map((c) => c.closest('label')!.querySelector('.coords')!.textContent);
  const submitButton = () =>
    [...el.querySelectorAll('button')].find((b) => /Import/.test(b.textContent!)) as HTMLButtonElement;

  beforeEach(() => {
    localStorage.setItem('locale', 'en');
    projects.set([]);
    projectsSvc.importProject.mockReset();
  });

  it('parses dropped files into sources with the shipped dependencies checked', async () => {
    await render();
    await pick([file('shop/front/package.json', PACKAGE_JSON), file('shop/back/pom.xml', POM)]);
    expect(sourceLabels()).toEqual(['shop/back/pom.xml', 'shop/front/package.json']);
    expect(checked()).toEqual([
      'org.springframework.boot:spring-boot-starter-parent',
      'org.springframework.boot:spring-boot-starter-web',
      '@angular/core',
      'rxjs',
    ]);
    // project name defaults to the dropped folder
    expect((el.querySelector('#project-name') as HTMLInputElement).value).toBe('shop');
  });

  it('marks already followed dependencies and does not follow them again', async () => {
    await render(undefined, [{ id: 'f1', ecosystem: 'NPM', coordinates: 'rxjs', currentVersion: null, events: [] }]);
    await pick([file('package.json', PACKAGE_JSON)]);
    expect(el.textContent).toContain('already followed');
    projectsSvc.importProject.mockResolvedValue({ projectId: 'p9', followed: 1, failed: [] });
    const name = el.querySelector('#project-name') as HTMLInputElement;
    name.value = 'shop';
    name.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    submitButton().click();
    await fixture.whenStable();

    const body = projectsSvc.importProject.mock.calls[0][0];
    expect(body.projectName).toBe('shop');
    expect(body.follow).toEqual([{ ecosystem: 'NPM', coordinates: '@angular/core' }]);
    expect(body.sources[0]).toMatchObject({ label: 'package.json', kind: 'package.json', ecosystem: 'NPM' });
    expect(body.sources[0].dependencies.map((d: any) => d.coordinates)).toEqual(['@angular/core', 'rxjs', 'vitest']);
    expect(navigate).toHaveBeenCalledWith(['/projects', 'p9']);
    expect(TestBed.inject(ToastService).toasts()[0].message).toContain('1 new follow');
  });

  it('lets the user rename sources and toggle dependencies', async () => {
    await render();
    await pick([file('package.json', PACKAGE_JSON)]);
    const label = el.querySelector('input.label') as HTMLInputElement;
    label.value = 'front';
    label.dispatchEvent(new Event('input'));
    const none = [...el.querySelectorAll('button.link')].find((b) =>
      /Uncheck/.test(b.textContent!),
    ) as HTMLButtonElement;
    none.click();
    await fixture.whenStable();
    expect(checked()).toEqual([]);
    el.querySelectorAll<HTMLInputElement>('.deps input[type=checkbox]')[2].dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(checked()).toEqual(['vitest']);
    expect(sourceLabels()).toEqual(['front']);
  });

  it('refuses a name already used and an empty source name', async () => {
    projects.set([{ id: 'p1', name: 'shop', createdAt: '', sources: [] }]);
    await render();
    await pick([file('package.json', PACKAGE_JSON)]);
    const name = el.querySelector('#project-name') as HTMLInputElement;
    name.value = 'shop';
    name.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(el.textContent).toContain('already has this name');
    expect(submitButton().disabled).toBe(true);
  });

  it('adds to an existing project, flagging replaced sources', async () => {
    projects.set([
      {
        id: 'p1',
        name: 'shop',
        createdAt: '',
        sources: [
          { id: 's1', label: 'package.json', kind: 'package.json', ecosystem: 'NPM', updatedAt: '', dependencies: [] },
        ],
      },
    ]);
    await render('p1');
    await pick([file('package.json', PACKAGE_JSON)]);
    expect(el.textContent).toContain('Adding to project "shop"');
    expect(el.textContent).toContain('replaces the existing source');
    projectsSvc.importProject.mockResolvedValue({
      projectId: 'p1',
      followed: 0,
      failed: [{ coordinates: 'x', reason: 'limit' }],
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    submitButton().click();
    await fixture.whenStable();
    expect(projectsSvc.importProject.mock.calls[0][0].projectId).toBe('p1');
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .map((t) => t.kind),
    ).toContain('error');
  });

  it('reports parse errors and ignored files', async () => {
    await render();
    await pick([file('package.json', '{oops'), file('notes.txt', 'x'), file('pom.xml', POM)]);
    expect(el.querySelector('.error')!.textContent).toContain('package.json');
  });
});

describe('defaultProjectName', () => {
  it('uses the common top folder only', () => {
    expect(defaultProjectName(['repo/a/package.json', 'repo/pom.xml'])).toBe('repo');
    expect(defaultProjectName(['a/package.json', 'b/pom.xml'])).toBe('');
    expect(defaultProjectName(['package.json'])).toBe('');
  });
});
