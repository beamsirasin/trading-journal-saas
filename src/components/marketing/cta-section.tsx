import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { TRIAL_DAYS } from '@/config/plans';
import { Container } from '@/components/shell/container';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * Closing call to action.
 *
 * Both destinations are real routes that do what the label says. The demo
 * link goes to a working demo dashboard, and the trial link goes to a
 * registration form that visibly does not submit yet — neither promises
 * something the visitor will not find.
 */
export function CtaSection() {
  const t = useTranslations('cta');

  return (
    <section aria-labelledby="cta-title" className="py-16 sm:py-20">
      <Container>
        <div className="border-border bg-card relative isolate overflow-hidden rounded-xl border px-6 py-12 sm:px-10 sm:py-16">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
            <div className="bg-primary/10 absolute -top-24 left-1/3 size-96 rounded-full blur-3xl" />
          </div>

          <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
            <h2 id="cta-title" className="text-section-title text-balance">
              {t('title')}
            </h2>

            <p className="text-muted-foreground leading-relaxed text-pretty">{t('description')}</p>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="min-h-11">
                <Link href="/register">
                  {t('ctaPrimary')}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="min-h-11">
                <Link href="/demo" prefetch={false}>
                  {t('ctaSecondary')}
                </Link>
              </Button>
            </div>

            <p className="text-muted-foreground text-sm">
              {t('trialNote', { trialDays: TRIAL_DAYS })}
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}
