import { isSupportedFile, parseProjectFiles } from './index';
import { dedupe, normalizePypi, splitPath } from './model';

const PACKAGE_JSON = JSON.stringify({
  dependencies: { '@angular/core': '^22.2.0', rxjs: '~7.8.0' },
  devDependencies: { typescript: '~6.0.0' },
});
const PACKAGE_LOCK = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    '': { dependencies: { '@angular/core': '^22.2.0', rxjs: '~7.8.0' }, devDependencies: { typescript: '~6.0.0' } },
    'node_modules/@angular/core': { version: '22.2.3' },
    'node_modules/rxjs': { version: '7.8.2' },
  },
});
const POM = `<project xmlns="http://maven.apache.org/POM/4.0.0"><dependencies>
  <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId><version>4.1.2</version></dependency>
</dependencies></project>`;

describe('isSupportedFile', () => {
  it.each([
    'package.json',
    'front/package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'back\\pom.xml',
    'requirements.txt',
    'requirements-dev.txt',
    'pyproject.toml',
    'poetry.lock',
    'uv.lock',
    'Pipfile',
    'Pipfile.lock',
  ])('accepts %s', (path) => expect(isSupportedFile(path)).toBe(true));

  it.each(['README.md', 'build.gradle', 'package.json.bak', 'pom.xml/x'])('rejects %s', (path) =>
    expect(isSupportedFile(path)).toBe(false),
  );
});

describe('parseProjectFiles', () => {
  it('pairs a manifest and its lockfile from the same folder (versions from the lock)', async () => {
    const res = await parseProjectFiles([
      { path: 'front/package.json', content: PACKAGE_JSON },
      { path: 'front/package-lock.json', content: PACKAGE_LOCK },
    ]);
    expect(res.errors).toEqual([]);
    expect(res.sources).toHaveLength(1);
    const [src] = res.sources;
    expect(src).toMatchObject({
      label: 'front/package.json',
      dir: 'front',
      kind: 'package.json',
      ecosystem: 'NPM',
      files: ['front/package.json', 'front/package-lock.json'],
    });
    expect(src.dependencies.map((d) => `${d.coordinates}@${d.version ?? '?'}`)).toEqual([
      '@angular/core@22.2.3',
      'rxjs@7.8.2',
      'typescript@?',
    ]);
    expect(src.warnings).toEqual(['package-lock.json: no version found for typescript']);
  });

  it('handles a monorepo dropped as a folder: one source per manifest, sorted by path', async () => {
    const res = await parseProjectFiles([
      { path: 'repo/front-admin/package.json', content: PACKAGE_JSON },
      { path: 'repo/back/pom.xml', content: POM },
      { path: 'repo/front/package.json', content: PACKAGE_JSON },
      { path: 'repo/front/package-lock.json', content: PACKAGE_LOCK },
      { path: 'repo/README.md', content: '# hi' },
    ]);
    expect(res.sources.map((s) => [s.label, s.files.length])).toEqual([
      ['repo/back/pom.xml', 1],
      ['repo/front-admin/package.json', 1],
      ['repo/front/package.json', 2],
    ]);
    expect(res.ignored).toEqual(['repo/README.md']);
  });

  it('keeps a standalone-capable lockfile as its own source when the pairing is ambiguous', async () => {
    const res = await parseProjectFiles([
      { path: 'package.json', content: PACKAGE_JSON },
      { path: 'package.json', content: '{"dependencies":{"left-pad":"1.3.0"}}' },
      { path: 'package-lock.json', content: PACKAGE_LOCK },
    ]);
    expect(res.sources.map((s) => s.kind).sort()).toEqual(['package-lock.json', 'package.json', 'package.json']);
    const lock = res.sources.find((s) => s.kind === 'package-lock.json')!;
    expect(lock.dependencies.map((d) => d.coordinates)).toEqual(['@angular/core', 'rxjs', 'typescript']);
  });

  it('a standalone lockfile alone becomes a source', async () => {
    const res = await parseProjectFiles([{ path: 'package-lock.json', content: PACKAGE_LOCK }]);
    expect(res.sources).toHaveLength(1);
    expect(res.sources[0]).toMatchObject({ label: 'package-lock.json', kind: 'package-lock.json' });
  });

  it('refuses a versions-only lockfile without its manifest, or with several candidates', async () => {
    const res = await parseProjectFiles([
      { path: 'a/yarn.lock', content: 'x@^1:\n  version "1.0.0"\n' },
      { path: 'Pipfile', content: '[packages]\nrequests = "*"\n' },
      { path: 'Pipfile', content: '[packages]\nrich = "*"\n' },
      { path: 'Pipfile.lock', content: '{"default":{}}' },
    ]);
    // sorted by path, case-insensitively
    expect(res.errors).toEqual([
      { path: 'a/yarn.lock', message: 'yarn.lock only gives versions: add its package.json from the same folder' },
      { path: 'Pipfile.lock', message: 'cannot tell which manifest this lockfile belongs to' },
    ]);
    expect(res.sources).toHaveLength(2);
  });

  it('pairs pyproject.toml with poetry.lock and Pipfile with Pipfile.lock', async () => {
    const res = await parseProjectFiles([
      { path: 'api/pyproject.toml', content: '[tool.poetry.dependencies]\npython = "^3.12"\nDjango = "^5.1"\n' },
      { path: 'api/poetry.lock', content: '[[package]]\nname = "django"\nversion = "5.1.4"\n' },
      { path: 'worker/Pipfile', content: '[packages]\nrequests = "*"\n' },
      { path: 'worker/Pipfile.lock', content: '{"default":{"requests":{"version":"==2.32.3"}}}' },
    ]);
    expect(res.sources.map((s) => `${s.label}: ${s.dependencies.map((d) => `${d.coordinates}@${d.version}`)}`)).toEqual(
      ['api/pyproject.toml: django@5.1.4', 'worker/Pipfile: requests@2.32.3'],
    );
  });

  it('uses pnpm and uv lockfiles as sources on their own', async () => {
    const res = await parseProjectFiles([
      {
        path: 'pnpm-lock.yaml',
        content:
          "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      zod:\n        specifier: ^4.0.0\n        version: 4.1.0\n",
      },
      {
        path: 'py/uv.lock',
        content:
          '[[package]]\nname = "app"\nversion = "0"\nsource = { virtual = "." }\ndependencies = [{ name = "httpx" }]\n',
      },
    ]);
    expect(res.sources.map((s) => `${s.kind}: ${s.dependencies.map((d) => d.coordinates)}`)).toEqual([
      'pnpm-lock.yaml: zod',
      'uv.lock: httpx',
    ]);
  });

  it('marks dependencies on modules dropped together, whatever their version', async () => {
    const root = `<project><groupId>com.acme</groupId><artifactId>shop-parent</artifactId><version>2.0.0</version>
      <dependencies><dependency><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId><version>2.0.16</version></dependency></dependencies>
    </project>`;
    const api = `<project><parent><groupId>com.acme</groupId><artifactId>shop-parent</artifactId><version>2.0.0</version></parent>
      <groupId>com.acme.api</groupId><artifactId>shop-api</artifactId><version>1.4.0</version></project>`;
    const web = `<project><groupId>com.acme.web</groupId><artifactId>shop-web</artifactId><version>3.1.0</version>
      <dependencies>
        <dependency><groupId>com.acme.api</groupId><artifactId>shop-api</artifactId><version>1.4.0</version></dependency>
        <dependency><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId><version>2.0.16</version></dependency>
      </dependencies>
    </project>`;
    const res = await parseProjectFiles([
      { path: 'shop/pom.xml', content: root },
      { path: 'shop/api/pom.xml', content: api },
      { path: 'shop/web/pom.xml', content: web },
    ]);
    const webDeps = res.sources.find((s) => s.label === 'shop/web/pom.xml')!.dependencies;
    expect(webDeps.map((d) => `${d.coordinates}=${d.scope}`)).toEqual([
      'com.acme.api:shop-api=module',
      'org.slf4j:slf4j-api=prod',
    ]);
    // the reactor parent of a module, dropped too
    expect(res.sources.find((s) => s.label === 'shop/api/pom.xml')!.dependencies).toEqual([
      expect.objectContaining({ coordinates: 'com.acme:shop-parent', scope: 'module' }),
    ]);
  });

  it('reports parse errors per file without failing the others', async () => {
    const res = await parseProjectFiles([
      { path: 'package.json', content: '{ broken' },
      { path: 'pom.xml', content: '<project><unclosed>' },
      { path: 'requirements.txt', content: 'requests>=2' },
    ]);
    expect(res.errors.map((e) => e.path)).toEqual(['package.json', 'pom.xml']);
    expect(res.errors.every((e) => e.message.length > 0)).toBe(true);
    expect(res.sources.map((s) => s.kind)).toEqual(['requirements.txt']);
  });
});

describe('helpers', () => {
  it('splitPath handles bare names, ./ and backslashes', () => {
    expect(splitPath('package.json')).toEqual({ dir: '', name: 'package.json' });
    expect(splitPath('./a/b/pom.xml')).toEqual({ dir: 'a/b', name: 'pom.xml' });
    expect(splitPath('a\\pom.xml')).toEqual({ dir: 'a', name: 'pom.xml' });
  });

  it('normalizePypi follows PEP 503', () => {
    expect(normalizePypi('Flask__Login.Ext')).toBe('flask-login-ext');
  });

  it('dedupe keeps the most important scope and fills missing versions', () => {
    expect(
      dedupe([
        { ecosystem: 'NPM', coordinates: 'x', declared: '^1', scope: 'dev', version: '1.2.0' },
        { ecosystem: 'NPM', coordinates: 'x', scope: 'prod' },
        { ecosystem: 'NPM', coordinates: 'x', scope: 'test' },
      ]),
    ).toEqual([{ ecosystem: 'NPM', coordinates: 'x', declared: '^1', scope: 'prod', version: '1.2.0' }]);
  });
});
