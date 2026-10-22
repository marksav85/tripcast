import { expect, it, vi } from 'vitest';
const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('@photostructure/tz-lookup', () => ({ default: lookup }));
import { resolveTimeZone } from '../src/client/lib/timeZone.js';
it('does not send malformed coordinates to the lookup', () => {
  expect(resolveTimeZone('48', 2).reason).toBe('invalidCoordinates');
  expect(lookup).not.toHaveBeenCalled();
});
it('returns explicit unresolved on lookup failure without exposing error details', () => {
  lookup.mockImplementationOnce(() => {
    throw new Error('internal details');
  });
  expect(resolveTimeZone(48, 2)).toEqual({
    status: 'unresolved',
    timeZone: null,
    reason: 'lookupFailed',
  });
});
it.each(['Invalid/Zone', 'PST', '+02:00', null, 42])(
  'rejects unsupported identifier %j without inventing UTC',
  (value) => {
    lookup.mockReturnValueOnce(value);
    expect(resolveTimeZone(48, 2)).toEqual({
      status: 'unresolved',
      timeZone: null,
      reason: 'unsupportedTimeZone',
    });
  },
);
