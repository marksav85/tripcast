import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

function unexpectedRequest() {
  throw new Error('Unexpected network request in a baseline test');
}

// Guard both transports used by this app and potential future tests.
vi.mock('axios', () => ({ default: { get: vi.fn(unexpectedRequest) } }));
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(unexpectedRequest));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
