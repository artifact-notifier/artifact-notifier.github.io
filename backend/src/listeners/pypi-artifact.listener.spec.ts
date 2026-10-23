import { parseFeedTitle } from './pypi-artifact.listener';

describe('parseFeedTitle', () => {
  it('splits "<name> <version>"', () => {
    expect(parseFeedTitle('django 6.1.2')).toEqual({ name: 'django', version: '6.1.2' });
  });

  it('tolerates extra whitespace', () => {
    expect(parseFeedTitle('  my-pkg   1.0a1 ')).toEqual({ name: 'my-pkg', version: '1.0a1' });
  });

  it.each([undefined, '', 'lonely'])('rejects %p', (title) => {
    expect(parseFeedTitle(title)).toBeNull();
  });
});
