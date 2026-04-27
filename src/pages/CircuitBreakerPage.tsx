/**
 * Circuit Breaker management page
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import {
  type CircuitBreakerDeletionItem,
  type CircuitBreakerErrorInsightFilters,
  type CircuitBreakerDeletionStatus,
  circuitBreakerApi,
} from '@/services/api/circuitBreaker';
import { useAuthStore, useNotificationStore } from '@/stores';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ErrorEventsInsightsContent } from '@/components/usage';
import styles from './CircuitBreakerPage.module.scss';

interface CircuitItem {
  provider?: string;
  clientId: string;
  modelId: string;
  errorInsightFilters?: CircuitBreakerErrorInsightFilters;
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailure: string;
  recoveryAt?: string;
}

type BreakerFilter = 'all' | 'open' | 'half-open';
type BreakerGroupBy = 'model' | 'provider';
type DeletionFilter = CircuitBreakerDeletionStatus | 'all';
type CircuitBreakerTab = 'breaker' | 'deletion';
interface CircuitGroup {
  groupKey: string;
  groupLabel: string;
  items: CircuitItem[];
}

const DELETION_PAGE_SIZE = 20;

export function CircuitBreakerPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const { showNotification, showConfirmation } = useNotificationStore();

  const [breakerItems, setBreakerItems] = useState<CircuitItem[]>([]);
  const [breakerLoading, setBreakerLoading] = useState(true);
  const [breakerError, setBreakerError] = useState('');
  const [breakerActionLoading, setBreakerActionLoading] = useState<string | null>(null);
  const [breakerFilter, setBreakerFilter] = useState<BreakerFilter>('open');
  const [breakerGroupBy, setBreakerGroupBy] = useState<BreakerGroupBy>('model');
  const [activeTab, setActiveTab] = useState<CircuitBreakerTab>('breaker');

  const [deletionItems, setDeletionItems] = useState<CircuitBreakerDeletionItem[]>([]);
  const [deletionLoading, setDeletionLoading] = useState(true);
  const [deletionError, setDeletionError] = useState('');
  const [deletionActionLoading, setDeletionActionLoading] = useState<string | null>(null);
  const [deletionFilter, setDeletionFilter] = useState<DeletionFilter>('pending');
  const [deletionPage, setDeletionPage] = useState(1);
  const [deletionTotal, setDeletionTotal] = useState(0);
  const [deletionPageSize, setDeletionPageSize] = useState(DELETION_PAGE_SIZE);
  const [insightTarget, setInsightTarget] = useState<CircuitItem | null>(null);
  const errorInsightsRefreshRef = useRef<(() => Promise<void>) | null>(null);

  const disableControls = connectionStatus !== 'connected';

  const loadBreakers = useCallback(async () => {
    setBreakerLoading(true);
    setBreakerError('');
    try {
      const data = await circuitBreakerApi.list();
      const flat: CircuitItem[] = [];
      for (const [clientId, models] of Object.entries(data)) {
        for (const [modelId, status] of Object.entries(models)) {
          flat.push({ clientId, modelId, ...status });
        }
      }
      flat.sort((a, b) => {
        if (a.state === 'open' && b.state !== 'open') return -1;
        if (a.state !== 'open' && b.state === 'open') return 1;
        return a.clientId.localeCompare(b.clientId);
      });
      setBreakerItems(flat);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setBreakerError(errorMessage);
    } finally {
      setBreakerLoading(false);
    }
  }, [t]);

  const loadDeletionCandidates = useCallback(async () => {
    setDeletionLoading(true);
    setDeletionError('');
    try {
      const result = await circuitBreakerApi.listDeletions({
        status: deletionFilter === 'all' ? undefined : deletionFilter,
        page: deletionPage,
        pageSize: DELETION_PAGE_SIZE,
      });
      setDeletionItems(result.items ?? []);
      setDeletionTotal(result.total ?? 0);
      setDeletionPage(result.page ?? deletionPage);
      setDeletionPageSize(result.page_size ?? DELETION_PAGE_SIZE);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setDeletionError(errorMessage);
    } finally {
      setDeletionLoading(false);
    }
  }, [deletionFilter, deletionPage, t]);

  const handleHeaderRefresh = useCallback(async () => {
    const jobs: Array<Promise<void>> = [loadBreakers(), loadDeletionCandidates()];
    if (insightTarget && errorInsightsRefreshRef.current) {
      jobs.push(errorInsightsRefreshRef.current());
    }
    await Promise.allSettled(jobs);
  }, [insightTarget, loadBreakers, loadDeletionCandidates]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    void loadBreakers();
  }, [loadBreakers]);

  useEffect(() => {
    void loadDeletionCandidates();
  }, [loadDeletionCandidates]);

  const handleReset = useCallback(
    (item: CircuitItem) => {
      showConfirmation({
        title: t('circuit_breaker.reset_confirm_title'),
        message: t('circuit_breaker.reset_confirm_message', {
          clientId: item.clientId,
          modelId: item.modelId,
        }),
        variant: 'primary',
        onConfirm: async () => {
          const actionKey = `${item.clientId}:${item.modelId}:reset`;
          setBreakerActionLoading(actionKey);
          try {
            await circuitBreakerApi.reset({ clientId: item.clientId, modelId: item.modelId });
            showNotification(t('circuit_breaker.reset_success'), 'success');
            await loadBreakers();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t('notification.operation_failed');
            showNotification(msg, 'error');
          } finally {
            setBreakerActionLoading(null);
          }
        },
      });
    },
    [loadBreakers, showConfirmation, showNotification, t]
  );

  const handleOpen = useCallback(
    (item: CircuitItem) => {
      showConfirmation({
        title: t('circuit_breaker.open_confirm_title'),
        message: t('circuit_breaker.open_confirm_message', {
          clientId: item.clientId,
          modelId: item.modelId,
        }),
        variant: 'danger',
        onConfirm: async () => {
          const actionKey = `${item.clientId}:${item.modelId}:open`;
          setBreakerActionLoading(actionKey);
          try {
            await circuitBreakerApi.open({ clientId: item.clientId, modelId: item.modelId });
            showNotification(t('circuit_breaker.open_success'), 'success');
            await loadBreakers();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t('notification.operation_failed');
            showNotification(msg, 'error');
          } finally {
            setBreakerActionLoading(null);
          }
        },
      });
    },
    [loadBreakers, showConfirmation, showNotification, t]
  );

  const refreshAfterDeletionAction = useCallback(async () => {
    await Promise.allSettled([loadDeletionCandidates(), loadBreakers()]);
  }, [loadBreakers, loadDeletionCandidates]);

  const handleExecuteDeletion = useCallback(
    (item: CircuitBreakerDeletionItem) => {
      showConfirmation({
        title: t('circuit_breaker.deletion_execute_confirm_title'),
        message: t('circuit_breaker.deletion_execute_confirm_message', {
          provider: item.provider,
          authId: item.auth_id,
          model: item.model,
        }),
        variant: 'danger',
        onConfirm: async () => {
          const actionKey = `${item.id}:delete`;
          setDeletionActionLoading(actionKey);
          try {
            await circuitBreakerApi.executeDeletion(item.id);
            showNotification(t('circuit_breaker.deletion_execute_success'), 'success');
            await refreshAfterDeletionAction();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t('notification.operation_failed');
            showNotification(msg, 'error');
            await loadDeletionCandidates();
          } finally {
            setDeletionActionLoading(null);
          }
        },
      });
    },
    [loadDeletionCandidates, refreshAfterDeletionAction, showConfirmation, showNotification, t]
  );

  const handleDismissDeletion = useCallback(
    (item: CircuitBreakerDeletionItem) => {
      showConfirmation({
        title: t('circuit_breaker.deletion_dismiss_confirm_title'),
        message: t('circuit_breaker.deletion_dismiss_confirm_message', {
          provider: item.provider,
          authId: item.auth_id,
          model: item.model,
        }),
        variant: 'primary',
        onConfirm: async () => {
          const actionKey = `${item.id}:dismiss`;
          setDeletionActionLoading(actionKey);
          try {
            await circuitBreakerApi.dismissDeletion(item.id);
            showNotification(t('circuit_breaker.deletion_dismiss_success'), 'success');
            await refreshAfterDeletionAction();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t('notification.operation_failed');
            showNotification(msg, 'error');
            await loadDeletionCandidates();
          } finally {
            setDeletionActionLoading(null);
          }
        },
      });
    },
    [loadDeletionCandidates, refreshAfterDeletionAction, showConfirmation, showNotification, t]
  );

  const filteredBreakerItems = useMemo(
    () =>
      breakerItems.filter((item) => {
        if (breakerFilter === 'all') return true;
        return item.state === breakerFilter;
      }),
    [breakerFilter, breakerItems]
  );

  const openCount = breakerItems.filter((item) => item.state === 'open').length;
  const halfOpenCount = breakerItems.filter((item) => item.state === 'half-open').length;
  const deletionTotalPages = Math.max(1, Math.ceil(deletionTotal / Math.max(1, deletionPageSize)));
  const breakerGroups = useMemo<CircuitGroup[]>(() => {
    const groups = new Map<string, CircuitItem[]>();
    filteredBreakerItems.forEach((item) => {
      const rawKey = breakerGroupBy === 'provider' ? item.provider : item.modelId;
      const fallbackLabel =
        breakerGroupBy === 'provider'
          ? t('circuit_breaker.provider_unknown')
          : t('circuit_breaker.model_unknown');
      const groupKey = (rawKey || fallbackLabel).trim();
      const current = groups.get(groupKey) ?? [];
      current.push(item);
      groups.set(groupKey, current);
    });

    return Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([groupKey, items]) => ({
        groupKey,
        groupLabel: groupKey,
        items,
      }));
  }, [breakerGroupBy, filteredBreakerItems, t]);

  const breakerBadge = (state: CircuitItem['state']) => {
    const badges: Record<string, { label: string; className: string }> = {
      closed: { label: t('circuit_breaker.state_closed'), className: styles.badgeClosed },
      open: { label: t('circuit_breaker.state_open'), className: styles.badgeOpen },
      'half-open': { label: t('circuit_breaker.state_half_open'), className: styles.badgeHalfOpen },
    };
    return badges[state] ?? { label: state, className: '' };
  };

  const deletionBadge = (state: CircuitBreakerDeletionStatus) => {
    const badges: Record<CircuitBreakerDeletionStatus, { label: string; className: string }> = {
      pending: { label: t('circuit_breaker.deletion_status_pending'), className: styles.badgePending },
      deleted: { label: t('circuit_breaker.deletion_status_deleted'), className: styles.badgeDeleted },
      failed: { label: t('circuit_breaker.deletion_status_failed'), className: styles.badgeFailed },
      dismissed: {
        label: t('circuit_breaker.deletion_status_dismissed'),
        className: styles.badgeDismissed,
      },
    };
    return badges[state];
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '-';
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return isoString;
    }
  };

  const renderDeletionTime = (item: CircuitBreakerDeletionItem) =>
    formatTime(item.action_at || item.updated_at || item.opened_at || item.created_at);

  const getInsightFilters = useCallback(
    (item: CircuitItem): Required<Pick<CircuitBreakerErrorInsightFilters, 'provider' | 'authId' | 'model'>> => ({
      provider: item.errorInsightFilters?.provider || item.provider || '',
      authId: item.errorInsightFilters?.authId || item.clientId,
      model: item.errorInsightFilters?.model || item.modelId,
    }),
    []
  );

  const closeErrorInsights = useCallback(() => {
    setInsightTarget(null);
  }, []);
  const handleErrorInsightsRefreshReady = useCallback((refresh: () => Promise<void>) => {
    errorInsightsRefreshRef.current = refresh;
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('circuit_breaker.title')}</h1>
        <p className={styles.description}>{t('circuit_breaker.description')}</p>
      </div>

      <div className={styles.pageTabs} role="tablist" aria-label={t('circuit_breaker.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'breaker'}
          className={`${styles.pageTab} ${activeTab === 'breaker' ? styles.pageTabActive : ''}`}
          onClick={() => setActiveTab('breaker')}
        >
          {t('circuit_breaker.tab_breaker')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'deletion'}
          className={`${styles.pageTab} ${activeTab === 'deletion' ? styles.pageTabActive : ''}`}
          onClick={() => setActiveTab('deletion')}
        >
          {t('circuit_breaker.tab_deletion')}
        </button>
      </div>

      {activeTab === 'breaker' && (
        <>
          <div className={styles.statsRow}>
            <div className={styles.statCard}>
              <span className={styles.statValue}>{breakerItems.length}</span>
              <span className={styles.statLabel}>{t('circuit_breaker.stat_total')}</span>
            </div>
            <div className={`${styles.statCard} ${styles.statOpen}`}>
              <span className={styles.statValue}>{openCount}</span>
              <span className={styles.statLabel}>{t('circuit_breaker.stat_open')}</span>
            </div>
            <div className={`${styles.statCard} ${styles.statHalfOpen}`}>
              <span className={styles.statValue}>{halfOpenCount}</span>
              <span className={styles.statLabel}>{t('circuit_breaker.stat_half_open')}</span>
            </div>
          </div>
          <Card
            title={t('circuit_breaker.card_title')}
            extra={
              <div className={styles.cardActions}>
                <div className={styles.filterTabs}>
                  <button
                    type="button"
                    className={`${styles.filterTab} ${breakerFilter === 'all' ? styles.filterTabActive : ''}`}
                    onClick={() => setBreakerFilter('all')}
                  >
                    {t('circuit_breaker.filter_all')}
                  </button>
                  <button
                    type="button"
                    className={`${styles.filterTab} ${breakerFilter === 'open' ? styles.filterTabActive : ''}`}
                    onClick={() => setBreakerFilter('open')}
                  >
                    {t('circuit_breaker.filter_open')}
                  </button>
                  <button
                    type="button"
                    className={`${styles.filterTab} ${breakerFilter === 'half-open' ? styles.filterTabActive : ''}`}
                    onClick={() => setBreakerFilter('half-open')}
                  >
                    {t('circuit_breaker.filter_half_open')}
                  </button>
                </div>
                <div className={styles.filterTabs} aria-label={t('circuit_breaker.group_by_label')}>
                  <button
                    type="button"
                    aria-pressed={breakerGroupBy === 'model'}
                    className={`${styles.filterTab} ${breakerGroupBy === 'model' ? styles.filterTabActive : ''}`}
                    onClick={() => setBreakerGroupBy('model')}
                  >
                    {t('circuit_breaker.group_by_model')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={breakerGroupBy === 'provider'}
                    className={`${styles.filterTab} ${breakerGroupBy === 'provider' ? styles.filterTabActive : ''}`}
                    onClick={() => setBreakerGroupBy('provider')}
                  >
                    {t('circuit_breaker.group_by_provider')}
                  </button>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={breakerLoading}
                  onClick={loadBreakers}
                  disabled={disableControls}
                >
                  {t('circuit_breaker.refresh')}
                </Button>
              </div>
            }
          >
            {breakerError && <div className={styles.errorBox}>{breakerError}</div>}

            {breakerLoading && breakerItems.length === 0 ? (
              <div className={styles.loading}>{t('circuit_breaker.loading')}</div>
            ) : breakerGroups.length === 0 ? (
              <div className={styles.empty}>{t('circuit_breaker.empty')}</div>
            ) : (
              <div className={styles.groupList}>
                {breakerGroups.map((group) => (
                  <section key={group.groupKey} className={styles.groupSection}>
                    <div className={styles.groupHeader}>
                      <div className={styles.groupHeaderMain}>
                        <div className={styles.groupTitleRow}>
                          <h2 className={styles.groupTitle}>{group.groupLabel}</h2>
                          <span className={styles.groupCount}>
                            {t('circuit_breaker.group_count', { count: group.items.length })}
                          </span>
                        </div>
                      </div>
                      <div className={styles.groupMeta}>
                        {group.items.some((item) => item.state === 'open') && (
                          <span className={`${styles.badge} ${styles.badgeOpen} ${styles.groupStateChip}`}>
                            {t('circuit_breaker.state_open')} {group.items.filter((item) => item.state === 'open').length}
                          </span>
                        )}
                        {group.items.some((item) => item.state === 'half-open') && (
                          <span className={`${styles.badge} ${styles.badgeHalfOpen} ${styles.groupStateChip}`}>
                            {t('circuit_breaker.state_half_open')}{' '}
                            {group.items.filter((item) => item.state === 'half-open').length}
                          </span>
                        )}
                        {group.items.some((item) => item.state === 'closed') && (
                          <span className={`${styles.badge} ${styles.badgeClosed} ${styles.groupStateChip}`}>
                            {t('circuit_breaker.state_closed')}{' '}
                            {group.items.filter((item) => item.state === 'closed').length}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={styles.groupBody}>
                      <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>{t('circuit_breaker.col_client')}</th>
                              <th>{t('circuit_breaker.col_provider')}</th>
                              <th>{t('circuit_breaker.col_model')}</th>
                              <th>{t('circuit_breaker.col_state')}</th>
                              <th>{t('circuit_breaker.col_failure_count')}</th>
                              <th>{t('circuit_breaker.col_last_failure')}</th>
                              <th>{t('circuit_breaker.col_recovery_at')}</th>
                              <th>{t('circuit_breaker.col_actions')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.items.map((item) => {
                              const badge = breakerBadge(item.state);
                              const resetActionKey = `${item.clientId}:${item.modelId}:reset`;
                              const openActionKey = `${item.clientId}:${item.modelId}:open`;
                              return (
                                <tr
                                  key={`${group.groupKey}:${item.clientId}:${item.modelId}`}
                                  className={item.state === 'open' ? styles.rowOpen : ''}
                                >
                                  <td className={styles.cellClient}>
                                    <code>{item.clientId}</code>
                                  </td>
                                  <td className={styles.cellProvider}>
                                    <code>{item.provider || t('circuit_breaker.provider_unknown')}</code>
                                  </td>
                                  <td className={styles.cellModel}>
                                    <code>{item.modelId}</code>
                                  </td>
                                  <td>
                                    <span className={`${styles.badge} ${badge.className}`}>{badge.label}</span>
                                  </td>
                                  <td>{item.failureCount}</td>
                                  <td className={styles.cellTime}>{formatTime(item.lastFailure)}</td>
                                  <td className={styles.cellTime}>{formatTime(item.recoveryAt)}</td>
                                  <td>
                                    <div className={styles.actionButtons}>
                                      <Button
                                        variant="primary"
                                        size="sm"
                                        loading={breakerActionLoading === resetActionKey}
                                        disabled={disableControls || item.state === 'closed'}
                                        onClick={() => handleReset(item)}
                                      >
                                        {t('circuit_breaker.btn_reset')}
                                      </Button>
                                      <Button
                                        variant="danger"
                                        size="sm"
                                        loading={breakerActionLoading === openActionKey}
                                        disabled={disableControls}
                                        onClick={() => handleOpen(item)}
                                      >
                                        {t('circuit_breaker.btn_open')}
                                      </Button>
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setInsightTarget(item)}
                                      >
                                        {t('circuit_breaker.btn_error_insights')}
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {activeTab === 'deletion' && (
        <Card
          title={t('circuit_breaker.deletion_card_title')}
          extra={
            <div className={styles.cardActions}>
              <div className={styles.filterTabs}>
                <button
                  className={`${styles.filterTab} ${deletionFilter === 'pending' ? styles.filterTabActive : ''}`}
                  onClick={() => {
                    setDeletionFilter('pending');
                    setDeletionPage(1);
                  }}
                >
                  {t('circuit_breaker.deletion_filter_pending')}
                </button>
                <button
                  type="button"
                  className={`${styles.filterTab} ${deletionFilter === 'deleted' ? styles.filterTabActive : ''}`}
                  onClick={() => {
                    setDeletionFilter('deleted');
                    setDeletionPage(1);
                  }}
                >
                  {t('circuit_breaker.deletion_filter_deleted')}
                </button>
                <button
                  className={`${styles.filterTab} ${deletionFilter === 'failed' ? styles.filterTabActive : ''}`}
                  onClick={() => {
                    setDeletionFilter('failed');
                    setDeletionPage(1);
                  }}
                >
                  {t('circuit_breaker.deletion_filter_failed')}
                </button>
                <button
                  className={`${styles.filterTab} ${deletionFilter === 'dismissed' ? styles.filterTabActive : ''}`}
                  onClick={() => {
                    setDeletionFilter('dismissed');
                    setDeletionPage(1);
                  }}
                >
                  {t('circuit_breaker.deletion_filter_dismissed')}
                </button>
                <button
                  className={`${styles.filterTab} ${deletionFilter === 'all' ? styles.filterTabActive : ''}`}
                  onClick={() => {
                    setDeletionFilter('all');
                    setDeletionPage(1);
                  }}
                >
                  {t('circuit_breaker.deletion_filter_all')}
                </button>
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={deletionLoading}
                onClick={loadDeletionCandidates}
                disabled={disableControls}
              >
                {t('circuit_breaker.refresh')}
              </Button>
            </div>
          }
        >
          {deletionError && <div className={styles.errorBox}>{deletionError}</div>}

          {deletionLoading && deletionItems.length === 0 ? (
            <div className={styles.loading}>{t('circuit_breaker.loading')}</div>
          ) : deletionItems.length === 0 ? (
            <div className={styles.empty}>{t('circuit_breaker.deletion_empty')}</div>
          ) : (
            <>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{t('circuit_breaker.deletion_col_provider')}</th>
                      <th>{t('circuit_breaker.deletion_col_auth')}</th>
                      <th>{t('circuit_breaker.deletion_col_model')}</th>
                      <th>{t('circuit_breaker.deletion_col_status')}</th>
                      <th>{t('circuit_breaker.deletion_col_time')}</th>
                      <th>{t('circuit_breaker.col_actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deletionItems.map((item) => {
                      const badge = deletionBadge(item.status);
                      const isPending = item.status === 'pending';
                      const normalizedModel =
                        item.normalized_model && item.normalized_model !== item.model
                          ? item.normalized_model
                          : '';
                      const isDeleting = deletionActionLoading === `${item.id}:delete`;
                      const isDismissing = deletionActionLoading === `${item.id}:dismiss`;
                      const isRowActionLoading = deletionActionLoading?.startsWith(`${item.id}:`) ?? false;

                      return (
                        <tr key={item.id} className={item.status === 'failed' ? styles.rowFailed : ''}>
                          <td>
                            <code>{item.provider}</code>
                          </td>
                          <td className={styles.cellClient}>
                            <code>{item.auth_id}</code>
                          </td>
                          <td className={styles.cellStack}>
                            <code>{item.model}</code>
                            {normalizedModel && <span className={styles.secondaryText}>{normalizedModel}</span>}
                          </td>
                          <td className={styles.cellStack}>
                            <span className={`${styles.badge} ${badge.className}`}>{badge.label}</span>
                            {item.status === 'failed' && item.action_error && (
                              <span className={styles.errorText}>{item.action_error}</span>
                            )}
                          </td>
                          <td className={styles.cellTime}>{renderDeletionTime(item)}</td>
                          <td>
                            {isPending ? (
                              <div className={styles.actionButtons}>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  loading={isDeleting}
                                  disabled={disableControls || isRowActionLoading}
                                  onClick={() => handleExecuteDeletion(item)}
                                >
                                  {t('circuit_breaker.deletion_btn_execute')}
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  loading={isDismissing}
                                  disabled={disableControls || isRowActionLoading}
                                  onClick={() => handleDismissDeletion(item)}
                                >
                                  {t('circuit_breaker.deletion_btn_dismiss')}
                                </Button>
                              </div>
                            ) : (
                              <span className={styles.readOnlyText}>{t('circuit_breaker.deletion_read_only')}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {deletionTotalPages > 1 && (
                <div className={styles.pagination}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setDeletionPage((current) => Math.max(1, current - 1))}
                    disabled={deletionPage <= 1}
                  >
                    {t('auth_files.pagination_prev')}
                  </Button>
                  <div className={styles.pageInfo}>
                    {t('auth_files.pagination_info', {
                      current: deletionPage,
                      total: deletionTotalPages,
                      count: deletionTotal,
                    })}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setDeletionPage((current) => Math.min(deletionTotalPages, current + 1))}
                    disabled={deletionPage >= deletionTotalPages}
                  >
                    {t('auth_files.pagination_next')}
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      <Modal
        open={Boolean(insightTarget)}
        onClose={closeErrorInsights}
        title={
          insightTarget
            ? t('circuit_breaker.error_insights_title', {
                provider: getInsightFilters(insightTarget).provider || t('circuit_breaker.provider_unknown'),
                authId: getInsightFilters(insightTarget).authId,
                model: getInsightFilters(insightTarget).model,
              })
            : t('circuit_breaker.error_insights_title_empty')
        }
        width={1240}
      >
        {insightTarget && (
          <div className={styles.errorInsightsModalBody}>
            <ErrorEventsInsightsContent
              fixedFilters={getInsightFilters(insightTarget)}
              onRefreshReady={handleErrorInsightsRefreshReady}
              refreshDisabled={disableControls}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
