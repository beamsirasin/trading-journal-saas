/**
 * Plain, EN-only internal-operator copy — deliberately NOT `next-intl`
 * (Phase 11's locked contract: `/admin` is EN-only, and admin copy must not
 * expand the customer EN/TH parity burden with operator-only strings).
 */
export const adminCopy = {
  shell: {
    brand: 'Trading OS',
    badge: 'Admin',
    backToApp: 'Back to app',
    signOut: 'Sign out',
    nav: {
      overview: 'Overview',
    },
  },
  overview: {
    title: 'Platform Overview',
    generatedAtPrefix: 'Data as of',
    totals: {
      users: 'Total users',
      workspaces: 'Total workspaces',
      usersHint: 'Canonical user records',
      workspacesHint: 'Canonical workspace records',
    },
    subscriptions: {
      sectionTitle: 'Subscriptions',
      statusTitle: 'Subscription status',
      statusCaption:
        'Effective subscription state, resolved the same way every workspace access check resolves it — not the raw stored status.',
      planTitle: 'Plan distribution',
      planCaption:
        'Workspaces by effective plan. Includes complimentary grants — see the source breakdown for which plans were actually paid for.',
      sourceTitle: 'Entitlement source',
      sourceCaption:
        'How each workspace reached its current plan. Complimentary access is never counted as revenue.',
      statusColumn: 'Status',
      planColumn: 'Plan',
      sourceColumn: 'Source',
      countColumn: 'Count',
      statusLabels: {
        trialing: 'Trialing',
        active: 'Active',
        expired: 'Expired',
        canceled: 'Canceled',
      },
      planLabels: {
        starter: 'Starter',
        trader: 'Trader',
        professional: 'Professional',
        none: 'No plan (trial)',
      },
      sourceLabels: {
        trial: 'Trial',
        paid: 'Paid',
        complimentary: 'Complimentary',
      },
    },
    activity: {
      sectionTitle: 'Activity',
      windowLabel: 'Last 30 days · UTC',
      newUsersTitle: 'New users',
      newUsersCaption: 'Users created per UTC calendar day, including days with zero signups.',
      newUsersDescription: 'Daily new user registrations for the last 30 UTC calendar days.',
      tradesTitle: 'Trades logged',
      tradesCaption:
        'Trade records created per UTC calendar day, including soft-deleted trades — this counts journal activity, not current holdings.',
      tradesDescription: 'Daily Trade records created for the last 30 UTC calendar days.',
      dateColumn: 'Date (UTC)',
      countColumn: 'Count',
    },
  },
  errors: {
    title: 'Something went wrong',
    description: 'The operator dashboard could not load its data. This has been logged.',
    retry: 'Try again',
    reference: 'Reference',
  },
  loading: {
    label: 'Loading platform overview…',
  },
  notFound: {
    title: 'Not found',
    description: "This page doesn't exist, or you don't have access to it.",
    backHome: 'Go to sign in',
  },
} as const;
