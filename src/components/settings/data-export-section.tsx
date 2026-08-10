import { Braces, FileArchive, LockKeyhole } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import type { WorkspaceRole } from '@/server/auth/dal';
import { Button } from '@/components/ui/button';

export async function DataExportSection({ role }: { role: WorkspaceRole }) {
  const t = await getTranslations('settings.dataExport');
  const owner = role === 'owner';

  return (
    <div className="bg-card border-border flex min-w-0 flex-col gap-6 rounded-lg border p-5 sm:p-6">
      {owner ? (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <article className="border-border flex min-w-0 flex-col items-start gap-4 rounded-lg border p-4">
            <div className="min-w-0">
              <h3 className="text-foreground flex items-center gap-2 font-semibold">
                <Braces className="text-primary size-5 shrink-0" aria-hidden="true" />
                {t('json.title')}
              </h3>
              <p id="json-export-description" className="text-muted-foreground mt-2 text-sm">
                {t('json.description')}
              </p>
            </div>
            <Button asChild className="mt-auto min-h-11 w-full sm:w-auto">
              <a
                href="/api/settings/export/workspace/json"
                aria-describedby="json-export-description export-scope-note"
                download
              >
                {t('json.download')}
              </a>
            </Button>
          </article>

          <article className="border-border flex min-w-0 flex-col items-start gap-4 rounded-lg border p-4">
            <div className="min-w-0">
              <h3 className="text-foreground flex items-center gap-2 font-semibold">
                <FileArchive className="text-primary size-5 shrink-0" aria-hidden="true" />
                {t('csv.title')}
              </h3>
              <p id="csv-export-description" className="text-muted-foreground mt-2 text-sm">
                {t('csv.description')}
              </p>
            </div>
            <Button asChild variant="outline" className="mt-auto min-h-11 w-full sm:w-auto">
              <a
                href="/api/settings/export/workspace/csv"
                aria-describedby="csv-export-description export-scope-note"
                download
              >
                {t('csv.download')}
              </a>
            </Button>
          </article>
        </div>
      ) : (
        <p className="text-muted-foreground flex items-start gap-2 text-sm">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('ownerOnly')}
        </p>
      )}

      <p
        id="export-scope-note"
        className="text-muted-foreground border-t pt-4 text-xs leading-relaxed"
      >
        {t('scopeNote')}
      </p>
    </div>
  );
}
