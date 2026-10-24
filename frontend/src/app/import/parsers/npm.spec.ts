import { ParsedDependency } from './model';
import { parsePackageJson, parsePackageLock, parsePnpmLock, parseYarnLock } from './npm';

const ANGULAR_PACKAGE_JSON = `\uFEFF{
  "name": "my-front",
  "dependencies": {
    "@angular/core": "^22.2.0",
    "rxjs": "~7.8.0",
    "tslib": "2.8.1",
    "my-lib": "workspace:*",
    "local": "file:../local",
    "from-git": "git+https://github.com/a/b.git",
    "shorthand": "user/repo#main",
    "aliased": "npm:@scope/real@^3.0.0"
  },
  "devDependencies": { "typescript": "~6.0.0", "@angular/core": "^22.2.0" },
  "peerDependencies": { "react": ">=18" },
  "optionalDependencies": { "fsevents": "*" }
}`;

const npmDep = (coordinates: string, declared?: string): ParsedDependency => ({
  ecosystem: 'NPM',
  coordinates,
  declared,
  scope: 'prod',
});

describe('parsePackageJson', () => {
  const { dependencies, warnings } = parsePackageJson(ANGULAR_PACKAGE_JSON, 'front/package.json');
  const byName = Object.fromEntries(dependencies.map((d) => [`${d.scope}:${d.coordinates}`, d]));

  it('reads every dependency group with its scope', () => {
    expect(Object.keys(byName).sort()).toEqual([
      'dev:@angular/core',
      'dev:typescript',
      'optional:fsevents',
      'peer:react',
      'prod:@angular/core',
      'prod:@scope/real',
      'prod:rxjs',
      'prod:tslib',
    ]);
  });

  it('keeps ranges as declared and exact versions as version', () => {
    expect(byName['prod:rxjs']).toEqual({ ecosystem: 'NPM', coordinates: 'rxjs', declared: '~7.8.0', scope: 'prod' });
    expect(byName['prod:tslib'].version).toBe('2.8.1');
    expect(byName['prod:rxjs'].version).toBeUndefined();
  });

  it('follows npm aliases to the real package', () => {
    expect(byName['prod:@scope/real'].declared).toBe('^3.0.0');
  });

  it('skips non-registry specs with a warning', () => {
    expect(warnings).toHaveLength(4);
    expect(warnings.join('\n')).toContain('my-lib is not a registry package (workspace:*)');
    expect(warnings.join('\n')).toContain('shorthand');
  });

  it('rejects invalid JSON', () => {
    expect(() => parsePackageJson('{ nope', 'package.json')).toThrow();
  });

  it('defaults an empty spec to *', () => {
    expect(parsePackageJson('{"dependencies":{"x":""}}', 'package.json').dependencies[0].declared).toBe('*');
  });
});

describe('parsePackageLock', () => {
  const V3 = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': {
        dependencies: { '@angular/core': '^22.2.0', rxjs: '~7.8.0' },
        devDependencies: { typescript: '~6.0.0' },
      },
      'node_modules/@angular/core': { version: '22.2.3' },
      'node_modules/rxjs': { version: '7.8.2' },
      'node_modules/typescript': { version: '6.0.3' },
      'node_modules/zone.js': { version: '0.15.1' }, // transitive: ignored
    },
  });

  it('knows the direct deps and their installed versions (v2/v3)', () => {
    const lock = parsePackageLock(V3, 'package-lock.json');
    expect(lock.standalone?.dependencies).toEqual([
      { ecosystem: 'NPM', coordinates: '@angular/core', declared: '^22.2.0', version: '22.2.3', scope: 'prod' },
      { ecosystem: 'NPM', coordinates: 'rxjs', declared: '~7.8.0', version: '7.8.2', scope: 'prod' },
      { ecosystem: 'NPM', coordinates: 'typescript', declared: '~6.0.0', version: '6.0.3', scope: 'dev' },
    ]);
    expect(lock.versionFor(npmDep('zone.js'))).toBe('0.15.1');
    expect(lock.versionFor(npmDep('missing'))).toBeUndefined();
  });

  it('only gives versions for v1 (no direct deps)', () => {
    const v1 = JSON.stringify({ lockfileVersion: 1, dependencies: { rxjs: { version: '6.6.7' }, odd: {} } });
    const lock = parsePackageLock(v1, 'package-lock.json');
    expect(lock.standalone).toBeUndefined();
    expect(lock.versionFor(npmDep('rxjs'))).toBe('6.6.7');
    expect(lock.versionFor(npmDep('odd'))).toBeUndefined();
  });
});

describe('parseYarnLock', () => {
  it('reads yarn classic entries, matching the declared range', () => {
    const lock = parseYarnLock(`# yarn lockfile v1\r
\r
"@babel/core@^7.0.0", "@babel/core@^7.20.0":\r
  version "7.26.0"\r
  resolved "https://registry.yarnpkg.com/@babel/core/-/core-7.26.0.tgz"\r
\r
lodash@^4.17.0:\r
  version "4.17.21"\r
\r
lodash@^3.0.0:\r
  version "3.10.1"\r
`);
    expect(lock.versionFor(npmDep('@babel/core', '^7.20.0'))).toBe('7.26.0');
    expect(lock.versionFor(npmDep('lodash', '^3.0.0'))).toBe('3.10.1');
    // several versions for the name and no matching range: unknown
    expect(lock.versionFor(npmDep('lodash', '^5.0.0'))).toBeUndefined();
    expect(lock.versionFor(npmDep('absent', '*'))).toBeUndefined();
  });

  it('reads yarn berry entries (npm: protocol)', () => {
    const lock = parseYarnLock(`__metadata:
  version: 8

"react@npm:^18.2.0, react@npm:^18.3.0":
  version: 18.3.1
  resolution: "react@npm:18.3.1"
  dependencies:
    loose-envify: "npm:^1.1.0"

"my-app@workspace:.":
  version: 0.0.0-use.local
`);
    expect(lock.versionFor(npmDep('react', '^18.3.0'))).toBe('18.3.1');
    // unique version for the name: used even if the range differs
    expect(lock.versionFor(npmDep('react', '18'))).toBe('18.3.1');
  });
});

describe('parsePnpmLock', () => {
  it('reads the root importer of a v9 lockfile', async () => {
    const lock = await parsePnpmLock(
      `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      react-dom:
        specifier: ^18.2.0
        version: 18.3.1(react@18.3.1)
      my-lib:
        specifier: workspace:*
        version: link:../lib
    devDependencies:
      vitest:
        specifier: ^3.0.0
        version: 3.2.4
  packages/other:
    dependencies:
      left-pad:
        specifier: ^1.0.0
        version: 1.3.0
`,
      'pnpm-lock.yaml',
    );
    expect(lock.standalone?.dependencies).toEqual([
      { ecosystem: 'NPM', coordinates: 'react-dom', declared: '^18.2.0', version: '18.3.1', scope: 'prod' },
      { ecosystem: 'NPM', coordinates: 'vitest', declared: '^3.0.0', version: '3.2.4', scope: 'dev' },
    ]);
    expect(lock.standalone?.warnings[0]).toContain('my-lib is not a registry package');
    expect(lock.versionFor(npmDep('vitest'))).toBe('3.2.4');
    expect(lock.versionFor(npmDep('left-pad'))).toBeUndefined();
  });

  it('reads a v5 lockfile (top-level maps and specifiers)', async () => {
    const lock = await parsePnpmLock(
      `lockfileVersion: 5.4
specifiers:
  react: ^17.0.0
dependencies:
  react: 17.0.2_scheduler@0.20.2
optionalDependencies:
  fsevents: 2.3.3
`,
      'pnpm-lock.yaml',
    );
    expect(lock.standalone?.dependencies).toEqual([
      { ecosystem: 'NPM', coordinates: 'react', declared: '^17.0.0', version: '17.0.2', scope: 'prod' },
      { ecosystem: 'NPM', coordinates: 'fsevents', declared: undefined, version: '2.3.3', scope: 'optional' },
    ]);
  });

  it('rejects invalid YAML', async () => {
    await expect(parsePnpmLock('a: [1, 2', 'pnpm-lock.yaml')).rejects.toThrow();
  });
});
