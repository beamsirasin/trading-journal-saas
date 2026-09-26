import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import th from '../../../messages/th.json';
import { RequirementBadge } from './requirement-badge';

afterEach(cleanup);

describe('RequirementBadge (decision 59)', () => {
  it.each([
    ['en', en, ['Required', 'Recommended', 'Optional', 'Depends on target']],
    ['th', th, ['จำเป็น', 'แนะนำ', 'ไม่บังคับ', 'ขึ้นกับเป้าหมาย']],
  ] as const)('renders every level in %s, never as an error', (locale, messages, words) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <RequirementBadge level="required" />
        <RequirementBadge level="recommended" />
        <RequirementBadge level="optional" />
        <RequirementBadge level="conditional" />
      </NextIntlClientProvider>,
    );
    for (const word of words) expect(screen.getByText(word)).toBeInTheDocument();
    for (const badge of document.querySelectorAll('[data-requirement]')) {
      expect(badge.className).not.toMatch(/destructive|negative|warning/);
    }
  });
});
