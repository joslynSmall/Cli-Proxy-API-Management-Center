/**
 * Circuit Breaker management page
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useNotificationStore } from '@/stores';
import { circuitBreakerApi } from '@/services/api/circuitBreaker';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import styles from './CircuitBreakerPage.module.scss';

interface CircuitItem {
  clientId: string;
  modelId: string;
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailure: string;
  recoveryAt?: string;
}

export function CircuitBreakerPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const { showNotification, showConfirmation } = useNotificationStore();

  const [items, setItems] = useState<CircuitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'half-open'>('all');

  const disableControls = connectionStatus !== 'connected';

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
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
      setItems(flat);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleHeaderRefresh = useCallback(async () => {
    await loadData();
  }, [loadData]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
          setActionLoading(`${item.clientId}:${item.modelId}`);
          try {
            await circuitBreakerApi.reset({ clientId: item.clientId, modelId: item.modelId });
            showNotification(t('circuit_breaker.reset_success'), 'success');
            await loadData();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t('notification.operation_failed');
            showNotification(msg, 'error');
          } finally {
            setActionLoading(null);
          }
        },
      });
    },
    [t, loadData, showNotification, showConfirmation]
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
          setActionLoading(`${item.clientId}:${item.modelId}`);
          try {
            await circuitBreakerApi.open({ clientId: item.clientId, modelId: item.modelId });
            showNotification(t('circuit_breaker.open_success'), 'success');
            await loadData();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t('notification.operation_failed');
            showNotification(msg, 'error');
          } finally {
            setActionLoading(null);
          }
        },
      });
    },
    [t, loadData, showNotification, showConfirmation]
  );

  const filteredItems = items.filter((item) => {
    if (filter === 'all') return true;
    return item.state === filter;
  });

  const openCount = items.filter((i) => i.state === 'open').length;
  const halfOpenCount = items.filter((i) => i.state === 'half-open').length;

  const getStateBadge = (state: CircuitItem['state']) => {
    const badges: Record<string, { label: string; className: string }> = {
      closed: { label: t('circuit_breaker.state_closed'), className: styles.badgeClosed },
      open: { label: t('circuit_breaker.state_open'), className: styles.badgeOpen },
      'half-open': { label: t('circuit_breaker.state_half_open'), className: styles.badgeHalfOpen },
    };
    return badges[state] ?? { label: state, className: '' };
  };

  const formatTime = (isoString: string) => {
    if (!isoString) return '-';
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return isoString;
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('circuit_breaker.title')}</h1>
        <p className={styles.description}>{t('circuit_breaker.description')}</p>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{items.length}</span>
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
                className={`${styles.filterTab} ${filter === 'all' ? styles.filterTabActive : ''}`}
                onClick={() => setFilter('all')}
              >
                {t('circuit_breaker.filter_all')}
              </button>
              <button
                className={`${styles.filterTab} ${filter === 'open' ? styles.filterTabActive : ''}`}
                onClick={() => setFilter('open')}
              >
                {t('circuit_breaker.filter_open')}
              </button>
              <button
                className={`${styles.filterTab} ${filter === 'half-open' ? styles.filterTabActive : ''}`}
                onClick={() => setFilter('half-open')}
              >
                {t('circuit_breaker.filter_half_open')}
              </button>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={loading}
              onClick={loadData}
              disabled={disableControls}
            >
              {t('circuit_breaker.refresh')}
            </Button>
          </div>
        }
      >
        {loading && items.length === 0 ? (
          <div className={styles.loading}>{t('circuit_breaker.loading')}</div>
        ) : filteredItems.length === 0 ? (
          <div className={styles.empty}>{t('circuit_breaker.empty')}</div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('circuit_breaker.col_client')}</th>
                  <th>{t('circuit_breaker.col_model')}</th>
                  <th>{t('circuit_breaker.col_state')}</th>
                  <th>{t('circuit_breaker.col_failure_count')}</th>
                  <th>{t('circuit_breaker.col_last_failure')}</th>
                  <th>{t('circuit_breaker.col_recovery_at')}</th>
                  <th>{t('circuit_breaker.col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const badge = getStateBadge(item.state);
                  const actionKey = `${item.clientId}:${item.modelId}`;
                  return (
                    <tr key={actionKey} className={item.state === 'open' ? styles.rowOpen : ''}>
                      <td className={styles.cellClient}>
                        <code>{item.clientId}</code>
                      </td>
                      <td>
                        <code>{item.modelId}</code>
                      </td>
                      <td>
                        <span className={`${styles.badge} ${badge.className}`}>{badge.label}</span>
                      </td>
                      <td>{item.failureCount}</td>
                      <td className={styles.cellTime}>{formatTime(item.lastFailure)}</td>
                      <td className={styles.cellTime}>{formatTime(item.recoveryAt || '')}</td>
                      <td>
                        <div className={styles.actionButtons}>
                          <Button
                            variant="primary"
                            size="sm"
                            loading={actionLoading === actionKey}
                            disabled={disableControls || item.state === 'closed'}
                            onClick={() => handleReset(item)}
                          >
                            {t('circuit_breaker.btn_reset')}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={actionLoading === actionKey}
                            disabled={disableControls}
                            onClick={() => handleOpen(item)}
                          >
                            {t('circuit_breaker.btn_open')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
