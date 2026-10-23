import { Resource } from '@angular/core';

/**
 * A resource's value, or undefined while it has none. Reading value() directly
 * throws when the request failed (401, 500…), which broke templates and computeds.
 */
export function valueOrUndefined<T>(res: Resource<T>): T | undefined {
  return res.hasValue() ? res.value() : undefined;
}
