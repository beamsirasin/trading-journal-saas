'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';

import { isCanonicalMistakeKey } from '@/config/mistakes';
import { RULE_CHECK_STATUSES } from '@/lib/trades/constants';
import {
  attachTradeMistakeAction,
  removeTradeMistakeAction,
  updateTradeRuleCheckAction,
} from '@/server/actions/trades';
import type {
  TradeMistakeDetail,
  TradeMistakeOption,
  TradeRuleCheckDetail,
} from '@/server/dal/trades';
import {
  actionErrorCode,
  ActionFeedback,
  FormTextarea,
  NativeSelect,
  TradeField,
} from '@/components/trades/trade-action-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';

export function TradeRulesEditor({
  tradeId,
  rules,
  canWrite,
}: {
  tradeId: string;
  rules: readonly TradeRuleCheckDetail[];
  canWrite: boolean;
}) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [pendingRule, setPendingRule] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const groups = {
    strategy: rules.filter((rule) => rule.scope === 'strategy'),
    setup: rules.filter((rule) => rule.scope === 'setup'),
  };

  function update(ruleKey: string, checkStatus: string) {
    setFeedback(null);
    setPendingRule(ruleKey);
    startTransition(async () => {
      const result = await updateTradeRuleCheckAction({ tradeId, ruleKey, checkStatus });
      const code = actionErrorCode(result);
      if (code !== null) setFeedback(t(`errors.${code}`));
      else router.refresh();
      setPendingRule(null);
    });
  }

  if (rules.length === 0)
    return <p className="text-muted-foreground text-sm">{t('detail.noRules')}</p>;
  return (
    <div className="grid gap-5">
      {(['strategy', 'setup'] as const).map((scope) =>
        groups[scope].length === 0 ? null : (
          <div key={scope}>
            <h4 className="mb-2 font-semibold">{t(`detail.ruleGroups.${scope}`)}</h4>
            <ul className="grid gap-2">
              {groups[scope].map((rule) => (
                <li key={rule.ruleKey} className="bg-muted/30 rounded-md p-3">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-center">
                    <div>
                      <p className="font-medium">{rule.title}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {rule.category}
                        {rule.isRequired ? ` · ${t('detail.required')}` : ''}
                        {rule.isPreTradeCheck ? ` · ${t('detail.preTrade')}` : ''}
                      </p>
                    </div>
                    {canWrite ? (
                      <NativeSelect
                        aria-label={t('lifecycle.rules.statusFor', { title: rule.title })}
                        defaultValue={rule.checkStatus}
                        disabled={pendingRule === rule.ruleKey}
                        onChange={(event) => update(rule.ruleKey, event.target.value)}
                      >
                        {RULE_CHECK_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {t(`ruleStatus.${status}`)}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Badge className="w-fit sm:justify-self-end">
                        {t(`ruleStatus.${rule.checkStatus}`)}
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
      <ActionFeedback message={feedback} />
    </div>
  );
}

export function TradeMistakesEditor({
  tradeId,
  mistakes,
  catalog,
  canWrite,
}: {
  tradeId: string;
  mistakes: readonly TradeMistakeDetail[];
  catalog: readonly TradeMistakeOption[];
  canWrite: boolean;
}) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const available = useMemo(
    () =>
      catalog.filter(
        (option) => !mistakes.some((mistake) => mistake.mistakeTypeId === option.mistakeTypeId),
      ),
    [catalog, mistakes],
  );

  function attach(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const data = new FormData(event.currentTarget);
    const mistakeTypeId = String(data.get('mistakeTypeId') ?? '');
    if (mistakeTypeId === '') return setFeedback(t('lifecycle.mistakes.choose'));
    const note = String(data.get('note') ?? '').trim();
    startTransition(async () => {
      const result = await attachTradeMistakeAction({
        tradeId,
        mistakeTypeId,
        ...(note === '' ? {} : { note }),
      });
      const code = actionErrorCode(result);
      if (code !== null) return setFeedback(t(`errors.${code}`));
      router.refresh();
    });
  }

  function remove(mistakeTypeId: string) {
    setFeedback(null);
    setRemoving(mistakeTypeId);
    startTransition(async () => {
      const result = await removeTradeMistakeAction({ tradeId, mistakeTypeId });
      const code = actionErrorCode(result);
      if (code !== null) setFeedback(t(`errors.${code}`));
      else router.refresh();
      setRemoving(null);
    });
  }

  return (
    <div className="grid gap-4">
      {mistakes.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('detail.noMistakes')}</p>
      ) : (
        <ul className="grid gap-2">
          {mistakes.map((mistake) => (
            <li key={mistake.mistakeTypeId} className="bg-muted/30 rounded-md p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {isCanonicalMistakeKey(mistake.key) ? t(`mistake.${mistake.key}`) : mistake.label}
                </span>
                {canWrite ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending && removing === mistake.mistakeTypeId}
                    onClick={() => remove(mistake.mistakeTypeId)}
                  >
                    {t('lifecycle.mistakes.remove')}
                  </Button>
                ) : null}
              </div>
              {mistake.note === null ? null : (
                <p className="text-muted-foreground mt-2 text-sm">{mistake.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && available.length > 0 ? (
        <form className="grid gap-3 rounded-md border p-3" onSubmit={attach}>
          <TradeField id="mistake-type" label={t('lifecycle.mistakes.type')}>
            <NativeSelect id="mistake-type" name="mistakeTypeId" defaultValue="">
              <option value="">{t('lifecycle.mistakes.select')}</option>
              {available.map((option) => (
                <option key={option.mistakeTypeId} value={option.mistakeTypeId}>
                  {isCanonicalMistakeKey(option.key) ? t(`mistake.${option.key}`) : option.label}
                </option>
              ))}
            </NativeSelect>
          </TradeField>
          <TradeField
            id="mistake-note"
            label={`${t('lifecycle.mistakes.note')} ${t('common.optional')}`}
          >
            <FormTextarea id="mistake-note" name="note" maxLength={1000} />
          </TradeField>
          <Button type="submit" className="w-fit" disabled={pending}>
            {pending ? t('lifecycle.common.saving') : t('lifecycle.mistakes.attach')}
          </Button>
        </form>
      ) : null}
      <ActionFeedback message={feedback} />
    </div>
  );
}
