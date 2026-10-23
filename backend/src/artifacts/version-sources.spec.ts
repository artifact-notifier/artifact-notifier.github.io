import { Ecosystem } from '@prisma/client';
import { fetchAllVersions, fetchMavenVersions, fetchNpmVersions, fetchPypiVersions } from './version-sources';

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
