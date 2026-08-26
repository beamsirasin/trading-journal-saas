'use client';

import { CreditCard, LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { signOut } from '@/lib/auth/client';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link, useRouter } from '@/i18n/navigation';

import { LanguageSwitcher } from './language-switcher';
import { SETTINGS_NAV_ITEM } from './nav-items';

export interface AccountMenuUser {
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
}

/**
 * The authenticated identity in the app shell, replacing Phase 1.1's
 * static demo placeholder. Never renders a database ID, session token, or
 * any OAuth-provider field — only the safe DTO fields `SessionUser` already
 * narrowed to (`src/server/auth/dal.ts`).
 *
 * THE SHAPE, top to bottom:
 *
 *   who you are          name, email
 *   ─────────────
 *   where you can go     Plan & billing, Settings
 *   ─────────────
 *   what you can set     Language, Theme
 *   ─────────────
 *   leaving              Log out
 *
 * Four bands, three rules, no headings. It used to carry a "WORKSPACE"
 * heading with the workspace's name under it, and a "PREFERENCES" heading
 * over the two controls. Both are gone: the active workspace is already named
 * by the account switcher standing directly beside this trigger, so repeating
 * it here was the same fact twice a few pixels apart, and a heading over two
 * rows that are visibly a language control and a theme control was labelling
 * the self-evident. Removing them took four elements out of a menu that has
 * six things to say.
 */
export function AccountMenu({ user }: { user: AccountMenuUser }) {
  const t = useTranslations('appNav.account');
  const tAppNav = useTranslations('appNav');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function handleLogout() {
    setOpen(false);
    startTransition(async () => {
      await signOut();
      router.push('/login');
      router.refresh();
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {/*
          Deliberately matched to `AccountSwitcher` beside it — same height,
          same radius, same gap, same horizontal padding — so the two header
          controls read as one family rather than two unrelated widgets. This
          one stays unfilled at rest: the switcher is showing a current VALUE
          and earns a chip, whereas this is a plain menu trigger, and giving
          both a fill would leave the header with two competing blocks.
        */}
        <Button
          variant="ghost"
          className="h-11 gap-2 rounded-md px-2.5"
          aria-label={t('menuLabel')}
          disabled={isPending}
        >
          <Avatar name={user.name} image={user.image} />
          <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
            {user.name}
          </span>
        </Button>
      </DropdownMenuTrigger>
      {/*
        Sized to the preference rows, which are the widest things in here: a
        label plus a two- or three-segment track. `min-w` sets the floor and
        the menu grows past it on its own, so a longer translation is not
        clipped — Thai's "ตามระบบ / สว่าง / มืด" is wider than "System /
        Light / Dark". The cap is what keeps that growth honest on a 320px
        phone, where an auto-width menu would otherwise run off the screen.
      */}
      <DropdownMenuContent
        align="end"
        className="max-w-[calc(100vw-1.5rem)] min-w-60 overflow-x-hidden p-1.5"
      >
        <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-1.5 font-normal">
          <span className="text-foreground truncate text-sm font-medium">{user.name}</span>
          <span className="text-muted-foreground truncate text-xs">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/*
          DESTINATIONS. Two ordinary navigation rows, styled identically,
          because they are the same kind of thing: pages about your account
          rather than pages about your trading.

          Settings arrived here from the sidebar's utility band. It is
          reachable from this menu at EVERY width, which is what made removing
          it from the mobile drawer safe — a phone reaches it through the same
          header control a desktop does, one tap from anywhere in the app,
          rather than through a navigation surface it never belonged in.
        */}
        <DropdownMenuItem asChild className="gap-2">
          <Link href="/app/plan">
            <CreditCard className="size-4" aria-hidden="true" />
            {t('planAndBilling')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="gap-2">
          <Link href={SETTINGS_NAV_ITEM.href}>
            <SETTINGS_NAV_ITEM.Icon className="size-4" aria-hidden="true" />
            {tAppNav(`items.${SETTINGS_NAV_ITEM.key}`)}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/*
          Preferences, at EVERY width.

          These were two standing icon buttons in the desktop header and a
          labelled band inside the mobile drawer — two different homes, two
          different presentations, and neither was where a user goes looking
          for their own settings. They are set-once choices, so they belong
          with the account rather than in a toolbar the user stares at all
          day.

          INLINE, not submenus. Each was a `DropdownMenuSub`, which stated its
          value on the trigger but needed a second surface to change it — two
          extra interactions for a choice between a handful of fixed values.
          Inline, each row does both jobs in the space the trigger already
          occupied, and no nested menu remains anywhere in here. The band lost
          its "PREFERENCES" heading with them: a row reading
          "Language [English][ไทย]" does not need to be told it is a preference.

          TWO DIFFERENT CONTROLS, deliberately. Language is a small SET you
          choose from, so it keeps a segmented row. Theme is a BINARY since
          System was removed, and a binary wants a toggle — a two-segment
          picker would spend a picker's worth of width restating on/off. Same
          band, same density, different shapes, because they are different
          kinds of question.
        */}
        <LanguageSwitcher variant="menu" />
        <ThemeToggle variant="menu" />
        <DropdownMenuSeparator />
        {/*
          The primitive's own `destructive` variant rather than hand-rolled
          colour classes: it already carries the restrained treatment this
          needs — destructive text AND icon on the menu's normal surface, with
          a 10%/20% tint (not a filled red band) reserved for hover and
          keyboard focus alike, tuned separately for light and dark.

          Restrained is the right register here. Logging out is reversible, so
          it should be unmistakably distinct from "Plan & billing" and never
          hit by accident — but it is not a delete, and styling it like one
          would spend the alarm this palette needs to keep for real data loss.
        */}
        <DropdownMenuItem
          variant="destructive"
          onSelect={handleLogout}
          disabled={isPending}
          className="gap-2"
        >
          <LogOut className="size-4" aria-hidden="true" />
          {t('logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Initials fallback — never a broken image icon, and never a default silhouette that implies a photo exists when none was provided. */
function Avatar({ name, image }: { name: string; image: string | null }) {
  if (image !== null) {
    // eslint-disable-next-line @next/next/no-img-element -- a user-supplied OAuth avatar URL is not a local asset next/image can optimize meaningfully here
    return <img src={image} alt="" className="size-7 shrink-0 rounded-full" />;
  }

  const initials = name
    .split(' ')
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <span
      aria-hidden="true"
      className="bg-accent text-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
    >
      {initials || '?'}
    </span>
  );
}
