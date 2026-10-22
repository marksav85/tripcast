import '@testing-library/jest-dom/vitest';
import { fetchMock } from './fixtures/api';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

function unexpectedRequest() {
  throw new Error('Unexpected network request in a baseline test');
}

// Guard both transports used by this app and potential future tests.
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(unexpectedRequest);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
