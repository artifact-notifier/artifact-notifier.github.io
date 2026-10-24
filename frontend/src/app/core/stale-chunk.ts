import { NavigationError } from '@angular/router';

// What browsers report when a lazy chunk can no longer be fetched
// (Chrome/Edge, Firefox, Safari, and webpack-style bundles).
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk [\w-]+ failed/i;
const GUARD_KEY = 'artifact-notifier.staleChunkReload';
// a second failure on the same page this soon means the chunk is really missing
const GUARD_MS = 10_000;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return CHUNK_ERROR.test(message);
}

/**
 * After a deployment, a tab still running the previous build asks for lazy
 * chunks that no longer exist (their names change with every build): reload
 * the app on the requested page to pick up the new build. Returns whether it
 * reloaded (only once per page within a few seconds, to never loop).
 */
export function reloadOnStaleChunk(
  event: Pick<NavigationError, 'error' | 'url'>,
  win: Pick<Window, 'location' | 'sessionStorage'> = window,
  now = Date.now(),
): boolean {
  if (!isChunkLoadError(event.error)) return false;
  try {
    const last = JSON.parse(win.sessionStorage.getItem(GUARD_KEY) ?? 'null') as { url: string; at: number } | null;
    if (last?.url === event.url && now - last.at < GUARD_MS) return false;
    win.sessionStorage.setItem(GUARD_KEY, JSON.stringify({ url: event.url, at: now }));
  } catch {
    // storage unavailable (private mode): reload anyway, the guard is best effort
  }
  // hash routing: land on the page that was requested
  win.location.hash = event.url;
  win.location.reload();
  return true;
}
