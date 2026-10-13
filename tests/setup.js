import '@testing-library/jest-dom/vitest';
import axios from 'axios';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

function unexpectedRequest() {
  throw new Error('Unexpected network request in a baseline test');
}

// Guard both transports used by this app and potential future tests.
vi.mock('axios', () => ({ default: { get: vi.fn(unexpectedRequest) } }));
beforeEach(() => {
  axios.get.mockReset();
  axios.get.mockImplementation(unexpectedRequest);
  vi.stubGlobal('fetch', vi.fn(unexpectedRequest));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Animation rendering depends on canvas, which jsdom does not implement.
// Keep the loading/motion branch observable without testing Lottie internals.
vi.mock('lottie-react', async () => {
  const { createElement } = await import('react');
  return { default: () => createElement('div', { 'data-testid': 'loading-animation' }) };
});
