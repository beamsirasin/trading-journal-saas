'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { signOut } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRouter } from '@/i18n/navigation';

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
 */
export function AccountMenu({
  user,
  workspaceName,
}: {
  user: AccountMenuUser;
  workspaceName: string;
}) {
  const t = useTranslations('appNav.account');
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
        <Button
          variant="ghost"
          className="min-h-11 gap-2 px-2"
          aria-label={t('menuLabel')}
          disabled={isPending}
        >
          <Avatar name={user.name} image={user.image} />
          <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
            {user.name}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="text-foreground truncate text-sm font-medium">{user.name}</span>
          <span className="text-muted-foreground truncate text-xs">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-label font-normal uppercase">
          {t('workspace')}
        </DropdownMenuLabel>
        <div className="text-foreground px-2 pb-2 text-sm">{workspaceName}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleLogout} disabled={isPending} className="gap-2">
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
