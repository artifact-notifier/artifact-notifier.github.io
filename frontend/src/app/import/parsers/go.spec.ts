import { parseGoMod } from './go';

const GO_MOD = `module example.com/shop

go 1.24

require github.com/gin-gonic/gin v1.12.0

require (
	"golang.org/x/text" v0.21.0
	github.com/BurntSushi/toml v1.6.0 // indirect
	example.com/shop/internal v0.0.0-00010101000000-000000000000
	github.com/old/lib v1.0.0
)

replace example.com/shop/internal => ./internal

replace (
	github.com/old/lib v1.0.0 => github.com/new/lib v1.1.0
)

tool golang.org/x/tools/cmd/stringer
`;

describe('parseGoMod', () => {
  it('reads the direct requirements with their version, and the module path', () => {
    const r = parseGoMod(GO_MOD, 'go.mod');
    expect(r.self).toBe('example.com/shop');
    expect(r.dependencies).toEqual([
      {
        ecosystem: 'GO',
        coordinates: 'github.com/gin-gonic/gin',
        declared: 'v1.12.0',
        version: 'v1.12.0',
        scope: 'prod',
      },
      { ecosystem: 'GO', coordinates: 'golang.org/x/text', declared: 'v0.21.0', version: 'v0.21.0', scope: 'prod' },
      {
        ecosystem: 'GO',
        coordinates: 'example.com/shop/internal',
        declared: 'v0.0.0-00010101000000-000000000000',
        version: 'v0.0.0-00010101000000-000000000000',
        scope: 'module',
      },
      { ecosystem: 'GO', coordinates: 'github.com/old/lib', declared: 'v1.0.0', version: 'v1.0.0', scope: 'prod' },
    ]);
    expect(r.warnings).toEqual(['go.mod: github.com/old/lib is replaced by github.com/new/lib, still followed as is']);
  });

  it('handles CRLF and an empty file', () => {
    expect(parseGoMod('module a.com/x\r\nrequire b.com/y v1.0.0\r\n', 'go.mod').dependencies).toHaveLength(1);
    expect(parseGoMod('', 'go.mod')).toEqual({ dependencies: [], warnings: [], self: undefined });
  });
});
