import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { vi } from 'vitest';
import i18n from '@/i18n';

beforeEach(async () => {
  window.scrollTo = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  await i18n.changeLanguage('zh-CN');
});

afterEach(() => {
  cleanup();
});
