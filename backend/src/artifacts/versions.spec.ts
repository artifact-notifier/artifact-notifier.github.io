import { compareVersions, isPrerelease, pickCurrentVersion } from './versions';

describe('compareVersions', () => {
  it.each([
    ['4.1.2', '4.2.0-M2'],
    ['4.2.0-M1', '4.2.0-M2'],
    ['4.2.0-M2', '4.2.0-RC1'],
    ['4.2.0-RC1', '4.2.0'],
    ['4.0.9', '4.1.0-M1'],
    ['1.0-SNAPSHOT', '1.0'],
    ['1.0.0-alpha', '1.0.0-alpha.1'],
    ['1.0.0-beta.2', '1.0.0-beta.10'],
    ['1.0.0-rc.1', '1.0.0'],
    ['5.3.0.RELEASE', '5.3.1'],
    ['6.4.0.CR1', '6.4.0.Final'],
    ['1.0', '1.0-sp1'],
    ['1.0-sp1', '1.0.1'],
    ['1.0.dev1', '1.0a1'],
    ['1.0a1', '1.0b1'],
    ['1.0rc1', '1.0'],
    ['1.0', '1.0.post1'],
    ['2.9', '2.10'],
    ['1.0.0', '1.0.0.1'],
  ])('%s < %s', (a, b) => {
    expect(compareVersions(a, b)).toBe(-1);
    expect(compareVersions(b, a)).toBe(1);
  });

  it.each([
    ['1.0', '1.0.0'],
    ['1.0-ga', '1.0'],
    ['1.0.0+build.5', '1.0.0'],
    ['v1.2.3', '1.2.3'],
  ])('%s == %s', (a, b) => {
    expect(compareVersions(a, b)).toBe(0);
  });
});

describe('isPrerelease', () => {
  it.each([
    '4.2.0-M2',
    '4.2.0-RC1',
    '1.0-SNAPSHOT',
    '2.0.0-beta.1',
    '1.0a1',
    '1.0.dev3',
    '6.4.0.CR1',
    '3.0.0-preview2',
    '1.0.0-next.3',
    '2.0.0-alpha01',
    '1.0.0-RC.1',
    '19.0.0-canary-abc',
  ])('%s is a prerelease', (v) => {
    expect(isPrerelease(v)).toBe(true);
  });

  it.each([
    '4.1.2',
    '5.3.0.RELEASE',
    '6.4.0.Final',
    '33.0.0-jre',
    '33.0.0-android',
    '1.0.0+build.5',
    '1.0.post1',
    '1.2.3-sp1',
  ])('%s is stable', (v) => {
    expect(isPrerelease(v)).toBe(false);
  });
});

describe('pickCurrentVersion', () => {
  const springBoot = ['4.0.9', '4.1.0-M1', '4.1.0', '4.1.2', '4.2.0-M1', '4.2.0-M2', '4.2.0-RC1'];

  it('returns the highest stable version by default', () => {
    expect(pickCurrentVersion(springBoot, false)).toBe('4.1.2');
  });

  it('includes prereleases when asked', () => {
    expect(pickCurrentVersion(springBoot, true)).toBe('4.2.0-RC1');
  });

  it('falls back to prereleases when nothing is stable', () => {
    expect(pickCurrentVersion(['1.0-rc1', '1.0-rc2'], false)).toBe('1.0-rc2');
  });

  it('returns null for no versions', () => {
    expect(pickCurrentVersion([], false)).toBeNull();
  });
});
