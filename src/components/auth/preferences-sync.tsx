'use client';

import { useLocale } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useRef } from 'react';

import { syncPreferences } from '@/server/actions/preferences';

/**
 * Keeps `user_preferences` in step with the two client-only preference
 * mechanisms Phase 1.1 already established — `next-themes`' `localStorage`
 * value and next-intl's locale — for as long as the authenticated app shell
 * is mounted (Phase 2 brief §13).
 *
 * Deliberately reactive rather than mount-once: a locale switch remounts
 * the whole shell under the new route (so mount-once would already catch
 * it), but a theme change does not navigate anywhere, so this has to watch
 * `theme` itself to catch it. Renders nothing — it exists only for the
 * effect.
 *
 * `initialDbTheme`/`initialDbLocale` are the values `user_preferences`
 * actually holds, read server-side and passed down once — the effect only
 * calls the server action when the client's own value has genuinely
 * diverged from that, so a fresh login whose pre-login `localStorage` theme
 * already matches the schema default never fires a redundant write.
 */
export function PreferencesSync({
  initialDbTheme,
  initialDbLocale,
}: {
  initialDbTheme: string;
  initialDbLocale: string;
}) {
  const { theme } = useTheme();
  const locale = useLocale();
  const lastSyncedTheme = useRef(initialDbTheme);
  const lastSyncedLocale = useRef(initialDbLocale);

  useEffect(() => {
    if (theme === undefined || theme === lastSyncedTheme.current) {
      return;
    }
    void syncPreferences({ theme: theme as 'light' | 'dark' | 'system' }).then((result) => {
      if (result.ok) lastSyncedTheme.current = theme;
    });
  }, [theme]);

  useEffect(() => {
    if (locale === lastSyncedLocale.current) {
      return;
    }
    void syncPreferences({ locale: locale as 'en' | 'th' }).then((result) => {
      if (result.ok) lastSyncedLocale.current = locale;
    });
  }, [locale]);

  return null;
}
