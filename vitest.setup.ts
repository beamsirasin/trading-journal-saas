import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// React Testing Library does not auto-cleanup when `globals: true` is combined
// with a custom setup file, so unmount explicitly between tests.
afterEach(() => {
  cleanup();
});

// jsdom does not implement matchMedia. Components that read
// `prefers-reduced-motion` or theme queries need it to exist.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// jsdom does not implement URL.createObjectURL/revokeObjectURL. The Trade
// Chart-upload preview (`trade-create-form.tsx`) uses these to preview a
// locally-selected File without ever needing a fetchable remote URL (the
// uploaded Blob itself is private) — a fixed, distinguishable stub value is
// enough for component tests to assert against.
Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: vi.fn(() => 'blob:mock-object-url'),
});
Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: vi.fn(),
});
