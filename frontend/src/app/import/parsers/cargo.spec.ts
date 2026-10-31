import { parseCargoLock, parseCargoToml } from './cargo';

const CARGO_TOML = `
[package]
name = "Shop-Api"
version = "0.1.0"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = "1.50"
log = "=0.4.22"
Rand = { version = "0.9", optional = true }
json = { package = "serde_json", version = "1" }
shop-core = { path = "../core" }
private = { git = "https://example.com/private.git" }
anyhow = { workspace = true }

[dev-dependencies]
insta = "1.40"

[build-dependencies]
cc = "1.2"

[target.'cfg(unix)'.dependencies]
nix = "0.29"
`;

describe('parseCargoToml', () => {
  it('reads every dependency group with its scope', () => {
    const r = parseCargoToml(CARGO_TOML, 'api/Cargo.toml');
    expect(r.self).toBe('shop-api');
    expect(r.dependencies.map((d) => [d.coordinates, d.scope, d.declared, d.version])).toEqual([
      ['serde', 'prod', '1.0', undefined],
      ['tokio', 'prod', '1.50', undefined],
      ['log', 'prod', '=0.4.22', '0.4.22'],
      ['rand', 'optional', '0.9', undefined],
      ['serde_json', 'prod', '1', undefined],
      ['shop-core', 'module', undefined, undefined],
      ['anyhow', 'prod', undefined, undefined],
      ['insta', 'dev', '1.40', undefined],
      ['cc', 'dev', '1.2', undefined],
      ['nix', 'prod', '0.29', undefined],
    ]);
    expect(r.warnings).toEqual(['api/Cargo.toml: private comes from git, skipped']);
  });

  it('reads the shared dependencies of a workspace root', () => {
    const r = parseCargoToml(
      '[workspace]\nmembers = ["api"]\n[workspace.dependencies]\nanyhow = "1.0"\n',
      'Cargo.toml',
    );
    expect(r.self).toBeUndefined();
    expect(r.dependencies).toEqual([{ ecosystem: 'CARGO', coordinates: 'anyhow', declared: '1.0', scope: 'prod' }]);
  });
});

describe('parseCargoLock', () => {
  const lock = parseCargoLock(`
version = 4

[[package]]
name = "serde"
version = "1.0.229"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "rand"
version = "0.8.5"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "rand"
version = "0.9.2"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "shop-core"
version = "0.1.0"
`);
  const dep = (coordinates: string, declared?: string) =>
    ({ ecosystem: 'CARGO', coordinates, declared, scope: 'prod' }) as const;

  it('gives the locked version of registry crates', () => {
    expect(lock.versionFor(dep('serde', '1'))).toBe('1.0.229');
    expect(lock.versionFor(dep('shop-core'))).toBeUndefined();
  });

  it('picks the version compatible with the requirement when a crate is locked twice', () => {
    expect(lock.versionFor(dep('rand', '0.9'))).toBe('0.9.2');
    expect(lock.versionFor(dep('rand', '^0.8.1'))).toBe('0.8.5');
    expect(lock.versionFor(dep('rand'))).toBeUndefined();
  });
});
