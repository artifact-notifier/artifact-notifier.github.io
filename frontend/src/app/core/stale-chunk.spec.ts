import { isChunkLoadError, reloadOnStaleChunk } from './stale-chunk';

function fakeWindow() {
  const store = new Map<string, string>();
  return {
    location: { hash: '', reload: vi.fn() },
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  } as unknown as Window & { location: { hash: string; reload: ReturnType<typeof vi.fn> } };
}

const chunkError = new TypeError(
  'Failed to fetch dynamically imported module: https://artifact-notifier.github.io/chunk-EZNOZJD4.js',
);

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x/chunk-A.js',
    'error loading dynamically imported module: https://x/chunk-A.js',
    'Importing a module script failed.',
    'ChunkLoadError: Loading chunk 42 failed.',
  ])('recognizes "%s"', (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it('ignores other navigation errors', () => {
    expect(isChunkLoadError(new Error('NG04002: Cannot match any routes'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('reloadOnStaleChunk', () => {
  it('reloads the app on the requested page', () => {
    const win = fakeWindow();
    expect(reloadOnStaleChunk({ error: chunkError, url: '/import?project=p1' }, win, 1_000)).toBe(true);
    expect(win.location.hash).toBe('/import?project=p1');
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('does not loop when the chunk is still missing right after reloading', () => {
    const win = fakeWindow();
    reloadOnStaleChunk({ error: chunkError, url: '/import' }, win, 1_000);
    expect(reloadOnStaleChunk({ error: chunkError, url: '/import' }, win, 5_000)).toBe(false);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    // a later deployment can reload again
    expect(reloadOnStaleChunk({ error: chunkError, url: '/import' }, win, 60_000)).toBe(true);
  });

  it('leaves other navigation errors alone', () => {
    const win = fakeWindow();
    expect(reloadOnStaleChunk({ error: new Error('boom'), url: '/import' }, win)).toBe(false);
    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it('still reloads when session storage is unavailable', () => {
    const win = fakeWindow();
    win.sessionStorage.getItem = () => {
      throw new Error('SecurityError');
    };
    expect(reloadOnStaleChunk({ error: chunkError, url: '/import' }, win)).toBe(true);
  });
});
