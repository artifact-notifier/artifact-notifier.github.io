import { ParsedDependency } from './model';
import {
  parsePipfile,
  parsePipfileLock,
  parsePoetryLock,
  parsePyproject,
  parseRequirements,
  parseUvLock,
} from './pypi';

const pyDep = (coordinates: string): ParsedDependency => ({ ecosystem: 'PYPI', coordinates, scope: 'prod' });
const summary = (deps: ParsedDependency[]) =>
  deps.map((d) => `${d.scope} ${d.coordinates} ${d.declared ?? '-'} ${d.version ?? '-'}`);

describe('parseRequirements', () => {
  const content = [
    '# production deps',
    'Django==5.1.4',
    'requests[security,socks] >=2.31,<3 ; python_version >= "3.10"  # http',
    'Flask_Login',
    'celery \\',
    '  ~=5.4',
    'pydantic (>=2)',
    '-r base.txt',
    '--index-url https://pypi.org/simple',
    '-e ./local-pkg',
    'git+https://github.com/org/repo.git#egg=repo',
    'mypkg @ https://example.com/mypkg-1.0.tar.gz',
    '',
  ].join('\r\n');

  it('reads PEP 508 lines, normalizing names', () => {
    const { dependencies } = parseRequirements(content, 'requirements.txt');
    expect(summary(dependencies)).toEqual([
      'prod django ==5.1.4 5.1.4',
      'prod requests >=2.31,<3 -',
      'prod flask-login - -',
      'prod celery ~=5.4 -',
      'prod pydantic >=2 -',
    ]);
  });

  it('warns about includes, editables, VCS and URL references', () => {
    const { warnings } = parseRequirements(content, 'requirements.txt');
    expect(warnings).toEqual([
      'requirements.txt: included file not followed (-r base.txt)',
      'requirements.txt: -e ./local-pkg is not a registry package, skipped',
      'requirements.txt: git+https://github.com/org/repo.git#egg=repo is not a registry package, skipped',
      'requirements.txt: mypkg is a direct URL reference, skipped',
    ]);
  });

  it('uses the dev scope for dev/test requirement files', () => {
    expect(parseRequirements('pytest', 'requirements-dev.txt').dependencies[0].scope).toBe('dev');
    expect(parseRequirements('pytest', 'ci/requirements_test.txt').dependencies[0].scope).toBe('dev');
  });

  it('ignores lines that are not requirements', () => {
    expect(parseRequirements('!!!', 'requirements.txt').dependencies).toEqual([]);
  });
});

describe('parsePyproject', () => {
  it('reads PEP 621 dependencies, optional groups and PEP 735 dependency groups', () => {
    const { dependencies, warnings } = parsePyproject(
      `[project]
name = "demo"
dependencies = [
  "fastapi>=0.115",
  "SQLAlchemy[asyncio]==2.0.36",
  "local @ file:///tmp/local",
]

[project.optional-dependencies]
redis = ["redis>=5"]

[dependency-groups]
dev = ["pytest>=8", { include-group = "lint" }]
lint = ["ruff"]
`,
      'pyproject.toml',
    );
    expect(summary(dependencies)).toEqual([
      'prod fastapi >=0.115 -',
      'prod sqlalchemy ==2.0.36 2.0.36',
      'optional redis >=5 -',
      'dev pytest >=8 -',
      'dev ruff - -',
    ]);
    expect(warnings).toEqual(['pyproject.toml: local is a direct URL reference, skipped']);
  });

  it('reads Poetry tables (bare versions are exact pins)', () => {
    const { dependencies, warnings } = parsePyproject(
      `[tool.poetry.dependencies]
python = "^3.12"
django = "^5.1"
pillow = "11.0.0"
celery = { version = "^5.4", extras = ["redis"] }
internal = { git = "https://example.com/internal.git" }
weird = { markers = "sys_platform == 'linux'" }

[tool.poetry.dev-dependencies]
black = "*"

[tool.poetry.group.test.dependencies]
pytest = "^8.0"
`,
      'pyproject.toml',
    );
    expect(summary(dependencies)).toEqual([
      'prod django ^5.1 -',
      'prod pillow 11.0.0 11.0.0',
      'prod celery ^5.4 -',
      'prod weird - -',
      'dev black * -',
      'dev pytest ^8.0 -',
    ]);
    expect(warnings).toEqual(['pyproject.toml: internal is not a registry package, skipped']);
  });

  it('rejects invalid TOML', () => {
    expect(() => parsePyproject('[project', 'pyproject.toml')).toThrow();
  });
});

describe('parsePipfile', () => {
  it('reads packages and dev-packages', () => {
    const { dependencies } = parsePipfile(
      `[packages]
requests = "*"
Django = "==5.1.4"
rich = { version = ">=13", extras = ["jupyter"] }

[dev-packages]
pytest = "*"
`,
      'Pipfile',
    );
    expect(summary(dependencies)).toEqual([
      'prod requests * -',
      'prod django ==5.1.4 5.1.4',
      'prod rich >=13 -',
      'dev pytest * -',
    ]);
  });
});

describe('lockfiles', () => {
  it('poetry.lock gives versions by normalized name', () => {
    const lock = parsePoetryLock(`[[package]]
name = "Django"
version = "5.1.4"

[[package]]
name = "flask_login"
version = "0.6.3"
`);
    expect(lock.standalone).toBeUndefined();
    expect(lock.versionFor(pyDep('django'))).toBe('5.1.4');
    expect(lock.versionFor(pyDep('flask-login'))).toBe('0.6.3');
    expect(parsePoetryLock('').versionFor(pyDep('x'))).toBeUndefined();
  });

  it('Pipfile.lock gives versions from default and develop', () => {
    const lock = parsePipfileLock(
      JSON.stringify({
        _meta: {},
        default: { requests: { version: '==2.32.3' } },
        develop: { pytest: { version: '==8.3.4' }, odd: {} },
      }),
    );
    expect(lock.versionFor(pyDep('requests'))).toBe('2.32.3');
    expect(lock.versionFor(pyDep('pytest'))).toBe('8.3.4');
    expect(lock.versionFor(pyDep('odd'))).toBeUndefined();
  });

  it('uv.lock knows the direct deps of the root package', () => {
    const lock = parseUvLock(`version = 1

[[package]]
name = "demo"
version = "0.1.0"
source = { editable = "." }
dependencies = [{ name = "fastapi" }, { name = "SQLAlchemy" }]

[package.optional-dependencies]
redis = [{ name = "redis" }]

[package.dev-dependencies]
dev = [{ name = "pytest" }]

[[package]]
name = "fastapi"
version = "0.115.6"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "sqlalchemy"
version = "2.0.36"

[[package]]
name = "starlette"
version = "0.41.3"

[[package]]
name = "pytest"
version = "8.3.4"
`);
    expect(summary(lock.standalone!.dependencies)).toEqual([
      'prod fastapi - 0.115.6',
      'prod sqlalchemy - 2.0.36',
      'optional redis - -',
      'dev pytest - 8.3.4',
    ]);
    expect(lock.versionFor(pyDep('starlette'))).toBe('0.41.3');
  });

  it('uv.lock without a root package only gives versions', () => {
    const lock = parseUvLock(`[[package]]
name = "fastapi"
version = "0.115.6"
`);
    expect(lock.standalone).toBeUndefined();
    expect(lock.versionFor(pyDep('fastapi'))).toBe('0.115.6');
  });

  it('uv.lock root may be virtual', () => {
    const lock = parseUvLock(`[[package]]
name = "ws"
version = "0.0.0"
source = { virtual = "." }
dependencies = [{ name = "httpx" }, { nope = true }]
`);
    expect(summary(lock.standalone!.dependencies)).toEqual(['prod httpx - -']);
  });
});
