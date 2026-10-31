import { Ecosystem } from '@prisma/client';
import {
  crateIndexPath,
  escapeGoModulePath,
  fetchAllVersions,
  fetchCargoVersions,
  fetchGoVersions,
  fetchMavenVersions,
  fetchNpmVersions,
  fetchPypiVersions,
  isGoPseudoVersion,
} from './version-sources';

function mockFetch(body: string | object, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return jest.spyOn(global, 'fetch').mockResolvedValue(new Response(text, { status }));
}

afterEach(() => jest.restoreAllMocks());

describe('fetchMavenVersions', () => {
  it('lists the versions of maven-metadata.xml', async () => {
    const fetch = mockFetch(
      `<metadata><versioning><versions>
         <version>4.0.9</version><version> 4.1.2 </version><version>4.2.0-RC1</version>
       </versions></versioning></metadata>`,
    );
    const versions = await fetchMavenVersions('org.springframework.boot:spring-boot');
    expect(versions?.map((v) => v.version)).toEqual(['4.0.9', '4.1.2', '4.2.0-RC1']);
    expect(fetch.mock.calls[0][0]).toBe(
      'https://repo1.maven.org/maven2/org/springframework/boot/spring-boot/maven-metadata.xml',
    );
  });

  it('rejects coordinates without artifact id', async () => {
    expect(await fetchMavenVersions('org.example')).toBeNull();
  });

  it('throws on HTTP errors', async () => {
    mockFetch('not found', 404);
    await expect(fetchMavenVersions('g:a')).rejects.toThrow('404');
  });
});

describe('fetchNpmVersions', () => {
  it('asks for the abbreviated metadata and lists versions', async () => {
    const fetch = mockFetch({ versions: { '1.0.0': {}, '2.0.0-beta.1': {} } });
    const versions = await fetchNpmVersions('@angular/core');
    expect(versions?.map((v) => v.version)).toEqual(['1.0.0', '2.0.0-beta.1']);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://registry.npmjs.org/%40angular%2Fcore');
    expect((init?.headers as Record<string, string>).Accept).toBe('application/vnd.npm.install-v1+json');
  });
});

describe('fetchPypiVersions', () => {
  it('lists releases with their upload date', async () => {
    mockFetch({ releases: { '6.1.2': [{ upload_time_iso_8601: '2026-10-01T10:00:00Z' }], '6.2a1': [] } });
    const versions = await fetchPypiVersions('django');
    expect(versions).toEqual([
      { version: '6.1.2', publishedAt: new Date('2026-10-01T10:00:00Z') },
      { version: '6.2a1', publishedAt: undefined },
    ]);
  });
});

describe('fetchAllVersions', () => {
  it('has no source for the TEST ecosystem', async () => {
    expect(await fetchAllVersions(Ecosystem.TEST, 'x')).toBeNull();
  });
});

describe('Go modules', () => {
  it('spots pseudo-versions', () => {
    expect(isGoPseudoVersion('v0.0.0-20261031123147-a9c2fd94bbbd')).toBe(true);
    expect(isGoPseudoVersion('v1.5.7-0.20230504103430-4f160b9bf995')).toBe(true);
    expect(isGoPseudoVersion('v2.1.0-rc.1.0.20230504103430-4f160b9bf995+incompatible')).toBe(true);
    expect(isGoPseudoVersion('v1.10.0')).toBe(false);
    expect(isGoPseudoVersion('v1.10.0-rc.1')).toBe(false);
  });

  it('escapes uppercase letters in module paths', () => {
    expect(escapeGoModulePath('github.com/BurntSushi/toml')).toBe('github.com/!burnt!sushi/toml');
  });

  it('lists tagged versions plus the dated @latest', async () => {
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockImplementation((input) =>
        Promise.resolve(
          String(input).endsWith('/@v/list')
            ? new Response('v1.9.0\nv1.10.0\nv0.0.0-20200101000000-abcdefabcdef\n')
            : new Response(JSON.stringify({ Version: 'v1.11.0', Time: '2026-10-30T10:00:00Z' })),
        ),
      );
    const versions = await fetchGoVersions('github.com/Gin-Gonic/gin');
    expect(versions).toEqual([
      { version: 'v1.9.0' },
      { version: 'v1.10.0' },
      { version: 'v1.11.0', publishedAt: new Date('2026-10-30T10:00:00Z') },
    ]);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      'https://proxy.golang.org/github.com/!gin-!gonic/gin/@v/list',
      'https://proxy.golang.org/github.com/!gin-!gonic/gin/@latest',
    ]);
  });

  it('throws when the module is unknown', async () => {
    mockFetch('not found', 404);
    await expect(fetchGoVersions('example.com/nope')).rejects.toThrow('404');
  });
});

describe('crates', () => {
  it('computes sparse index paths', () => {
    expect(['a', 'ab', 'syn', 'Serde', 'tokio'].map(crateIndexPath)).toEqual([
      '1/a',
      '2/ab',
      '3/s/syn',
      'se/rd/serde',
      'to/ki/tokio',
    ]);
  });

  it('lists the non-yanked versions with their date, identifying itself', async () => {
    const fetch = mockFetch(
      [
        { name: 'serde', vers: '1.0.0', yanked: false },
        { name: 'serde', vers: '1.0.1', yanked: true },
        { name: 'serde', vers: '1.0.2', yanked: false, pubtime: '2026-10-30T10:00:00Z' },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n') + '\n',
    );
    expect(await fetchCargoVersions('serde')).toEqual([
      { version: '1.0.0', publishedAt: undefined },
      { version: '1.0.2', publishedAt: new Date('2026-10-30T10:00:00Z') },
    ]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://index.crates.io/se/rd/serde');
    expect((init?.headers as Record<string, string>)['User-Agent']).toMatch(/^artifact-notifier/);
  });

  it('is what fetchAllVersions uses for both ecosystems', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(new Response('')));
    expect(await fetchAllVersions(Ecosystem.CARGO, 'x')).toEqual([]);
    expect(await fetchAllVersions(Ecosystem.GO, 'example.com/x')).toEqual([]);
  });
});
