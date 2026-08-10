import { render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { DataExportSection } from './data-export-section';

vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: 'en', messages: en, namespace: namespace as never }),
}));

describe('DataExportSection', () => {
  it.each(['owner'] as const)('enables both normal download links for an %s', async (role) => {
    render(await DataExportSection({ role }));
    expect(screen.getByRole('heading', { name: 'Structured JSON' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CSV ZIP' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download JSON' })).toHaveAttribute(
      'href',
      '/api/settings/export/workspace/json',
    );
    expect(screen.getByRole('link', { name: 'Download CSV ZIP' })).toHaveAttribute(
      'href',
      '/api/settings/export/workspace/csv',
    );
  });

  it('keeps export available regardless of writable/read-only/over-limit presentation state', async () => {
    render(await DataExportSection({ role: 'owner' }));
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText(/including archived and soft-deleted records/i)).toBeInTheDocument();
  });

  it('blocks members without implying credential, Audit Log, or account archive export', async () => {
    render(await DataExportSection({ role: 'member' }));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Only a workspace owner can export workspace data.')).toBeVisible();
    expect(document.body.textContent).not.toMatch(
      /credential backup|account archive|account deletion/i,
    );
    expect(document.body.textContent).toMatch(/excludes.*Audit Logs/i);
  });
});
