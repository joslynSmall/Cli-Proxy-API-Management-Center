import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select, type SelectOption } from '@/components/ui/Select';
import { IconSlidersHorizontal, IconX } from '@/components/ui/icons';
import { useErrorEventsData, type ErrorEventFilters } from '@/hooks/useErrorEventsData';
import { logsApi } from '@/services/api/logs';
import { useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import styles from './ErrorEventsInsightsContent.module.scss';

export interface ErrorEventsInsightsContentProps {
  fixedFilters?: Partial<ErrorEventFilters>;
  initialFilters?: Partial<ErrorEventFilters>;
  pageSize?: number;
  summaryLimit?: number;
  onRefreshReady?: (refresh: () => Promise<void>) => void;
  refreshDisabled?: boolean;
}

const formatTime = (value?: string): string => {
  if (!value) {
    return '-';
  }
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toLocaleString();
  }
  return value;
};

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : '');

const formatProgressRatio = (label: string, current?: number, threshold?: number): string => {
  const safeCurrent = typeof current === 'number' ? current : 0;
  const safeThreshold = typeof threshold === 'number' ? threshold : 0;
  return `${label} ${safeCurrent}/${safeThreshold}`;
};

const normalizeDeletionStatus = (value?: string): string => {
  if (!value) {
    return '';
  }
  return value.trim().toLowerCase();
};

const normalizeFixedFilters = (source?: Partial<ErrorEventFilters>): Partial<ErrorEventFilters> => ({
  start: source?.start?.trim(),
  end: source?.end?.trim(),
  provider: source?.provider?.trim(),
  authId: source?.authId?.trim(),
  model: source?.model?.trim(),
  failureStage: source?.failureStage?.trim(),
  errorCode: source?.errorCode?.trim(),
  statusCode: source?.statusCode?.trim(),
  requestId: source?.requestId?.trim(),
});

const normalizeScope = (
  progressScopeKey?: string
): { provider: string; authId: string; normalizedModel: string } => {
  const parts = typeof progressScopeKey === 'string' ? progressScopeKey.split('|') : [];
  if (parts.length !== 3) {
    return { provider: '', authId: '', normalizedModel: '' };
  }
  return {
    provider: parts[0]?.trim() || '',
    authId: parts[1]?.trim() || '',
    normalizedModel: parts[2]?.trim() || '',
  };
};

interface FilterOptionSeed {
  value?: string | number | null;
  total?: number;
}

interface FilterSelectProps {
  label: string;
  value: string;
  options: ReadonlyArray<SelectOption>;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const normalizeOptionValue = (value?: string | number | null): string => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
};

const buildFilterOptions = (
  allLabel: string,
  seeds: ReadonlyArray<FilterOptionSeed>,
  currentValue: string
): SelectOption[] => {
  const optionsByValue = new Map<string, SelectOption>();
  seeds.forEach((seed) => {
    const value = normalizeOptionValue(seed.value);
    if (!value || optionsByValue.has(value)) {
      return;
    }
    const total = typeof seed.total === 'number' && seed.total > 0 ? seed.total : undefined;
    optionsByValue.set(value, {
      value,
      label: total ? `${value} (${total.toLocaleString()})` : value,
    });
  });

  const current = normalizeOptionValue(currentValue);
  if (current && !optionsByValue.has(current)) {
    optionsByValue.set(current, { value: current, label: current });
  }

  return [{ value: '', label: allLabel }, ...Array.from(optionsByValue.values())];
};

function FilterSelect({ label, value, options, onChange, disabled = false }: FilterSelectProps) {
  const labelId = useId();
  return (
    <div className={styles.filterField}>
      <label id={labelId} className={styles.filterLabel}>
        {label}
      </label>
      <Select
        value={value}
        options={options}
        onChange={onChange}
        disabled={disabled}
        ariaLabelledBy={labelId}
      />
    </div>
  );
}

type ErrorEventsViewMode = 'detail' | 'scope';

interface ScopeAggregateRow {
  key: string;
  provider: string;
  authId: string;
  model: string;
  displayProvider: string;
  displayAuthId: string;
  displayModel: string;
  total: number;
  circuitCountableTotal: number;
  latestOccurredAt: string;
  progressScopeKey: string;
}

export function ErrorEventsInsightsContent({
  fixedFilters,
  initialFilters,
  pageSize = 20,
  summaryLimit = 20,
  onRefreshReady,
  refreshDisabled = false,
}: ErrorEventsInsightsContentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showNotification } = useNotificationStore();
  const normalizedFixedFilters = useMemo(() => normalizeFixedFilters(fixedFilters), [fixedFilters]);
  const {
    effectiveFilters,
    items,
    total,
    page,
    loading,
    error,
    summaryLoading,
    summaryError,
    summary,
    metrics,
    progressByScope,
    setFilter,
    setFilters,
    setPage,
    resetFilters: resetAllFilters,
    refresh,
    lastRefreshedAt,
  } = useErrorEventsData({
    fixedFilters: normalizedFixedFilters,
    initialFilters,
    pageSize,
    summaryLimit,
    autoLoad: true,
  });

  const [activeRequestLogId, setActiveRequestLogId] = useState<string | null>(null);
  const [requestLogContent, setRequestLogContent] = useState('');
  const [requestLogLoading, setRequestLogLoading] = useState(false);
  const [requestLogError, setRequestLogError] = useState('');
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ErrorEventsViewMode>('detail');
  const [advancedDraft, setAdvancedDraft] = useState({
    requestId: effectiveFilters.requestId,
    start: effectiveFilters.start,
    end: effectiveFilters.end,
  });

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const hasRows = items.length > 0;
  const allFilterLabel = t('error_events.filter_all');

  const activeFilterPills = useMemo(() => {
    const pills: Array<{ key: keyof ErrorEventFilters; label: string; value: string }> = [];
    if (effectiveFilters.provider) {
      pills.push({ key: 'provider', label: t('error_events.filter_provider'), value: effectiveFilters.provider });
    }
    if (effectiveFilters.authId) {
      pills.push({ key: 'authId', label: t('error_events.filter_auth'), value: effectiveFilters.authId });
    }
    if (effectiveFilters.model) {
      pills.push({ key: 'model', label: t('error_events.filter_model'), value: effectiveFilters.model });
    }
    if (effectiveFilters.failureStage) {
      pills.push({
        key: 'failureStage',
        label: t('error_events.filter_failure_stage'),
        value: effectiveFilters.failureStage,
      });
    }
    if (effectiveFilters.errorCode) {
      pills.push({ key: 'errorCode', label: t('error_events.filter_error_code'), value: effectiveFilters.errorCode });
    }
    if (effectiveFilters.statusCode) {
      pills.push({ key: 'statusCode', label: t('error_events.filter_status_code'), value: effectiveFilters.statusCode });
    }
    if (effectiveFilters.requestId) {
      pills.push({ key: 'requestId', label: t('error_events.filter_request_id'), value: effectiveFilters.requestId });
    }
    if (effectiveFilters.start) {
      pills.push({ key: 'start', label: t('error_events.filter_start'), value: effectiveFilters.start });
    }
    if (effectiveFilters.end) {
      pills.push({ key: 'end', label: t('error_events.filter_end'), value: effectiveFilters.end });
    }
    return pills;
  }, [effectiveFilters, t]);

  const hasActiveFilters = activeFilterPills.length > 0;

  const filterOptions = useMemo(
    () => ({
      provider: buildFilterOptions(
        allFilterLabel,
        [
          ...summary.byProvider.map((item) => ({ value: item.provider, total: item.total })),
          ...summary.byRiskScope.map((item) => ({
            value: item.provider || normalizeScope(item.progress_scope_key).provider,
            total: item.total,
          })),
          ...items.map((item) => ({ value: item.provider })),
        ],
        effectiveFilters.provider
      ),
      authId: buildFilterOptions(
        allFilterLabel,
        [
          ...summary.byAuth.map((item) => ({ value: item.auth_id, total: item.total })),
          ...summary.byRiskScope.map((item) => ({
            value: item.auth_id || normalizeScope(item.progress_scope_key).authId,
            total: item.total,
          })),
          ...items.map((item) => ({ value: item.auth_id })),
        ],
        effectiveFilters.authId
      ),
      model: buildFilterOptions(
        allFilterLabel,
        [
          ...summary.byModel.map((item) => ({ value: item.normalized_model || item.model, total: item.total })),
          ...summary.byRiskScope.map((item) => ({
            value:
              item.normalized_model || item.model || normalizeScope(item.progress_scope_key).normalizedModel,
            total: item.total,
          })),
          ...items.flatMap((item) => [{ value: item.normalized_model }, { value: item.model }]),
        ],
        effectiveFilters.model
      ),
      failureStage: buildFilterOptions(
        allFilterLabel,
        [
          ...summary.byFailureStage.map((item) => ({ value: item.failure_stage, total: item.total })),
          ...items.map((item) => ({ value: item.failure_stage })),
        ],
        effectiveFilters.failureStage
      ),
      errorCode: buildFilterOptions(
        allFilterLabel,
        [
          ...summary.byErrorCode.map((item) => ({ value: item.error_code, total: item.total })),
          ...items.map((item) => ({ value: item.error_code })),
        ],
        effectiveFilters.errorCode
      ),
      statusCode: buildFilterOptions(
        allFilterLabel,
        [
          ...summary.byStatusCode.map((item) => ({ value: item.status_code, total: item.total })),
          ...items.map((item) => ({ value: item.status_code })),
        ],
        effectiveFilters.statusCode
      ),
    }),
    [allFilterLabel, effectiveFilters, items, summary]
  );

  const scopeRows = useMemo<ScopeAggregateRow[]>(
    () =>
      summary.byRiskScope.map((item, index) => {
        const scope = normalizeScope(item.progress_scope_key);
        const provider = (item.provider || scope.provider).trim();
        const authId = (item.auth_id || scope.authId).trim();
        const model = (item.normalized_model || item.model || scope.normalizedModel).trim();
        return {
          key: item.progress_scope_key || `${provider}|${authId}|${model}|${index}`,
          provider,
          authId,
          model,
          displayProvider: provider || '-',
          displayAuthId: authId || '-',
          displayModel: model || '-',
          total: item.total || 0,
          circuitCountableTotal: item.circuit_countable_total || 0,
          latestOccurredAt: item.latest_occurred_at || '',
          progressScopeKey: item.progress_scope_key || '',
        };
      }),
    [summary.byRiskScope]
  );

  const hasScopeRows = scopeRows.length > 0;
  const hasSummaryMetrics = metrics.total > 0 || total > 0 || hasScopeRows;

  useEffect(() => {
    onRefreshReady?.(refresh);
  }, [onRefreshReady, refresh]);

  useEffect(() => {
    if (!activeRequestLogId) {
      return;
    }

    let cancelled = false;

    logsApi
      .fetchRequestLogTextById(activeRequestLogId)
      .then((content) => {
        if (cancelled) {
          return;
        }
        setRequestLogContent(content);
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setRequestLogError(getErrorMessage(loadError) || t('error_events.request_log_modal_load_error'));
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setRequestLogLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeRequestLogId, t]);

  const openRequestLogModal = (requestLogId: string) => {
    if (!requestLogId) {
      return;
    }
    setRequestLogLoading(true);
    setRequestLogContent('');
    setRequestLogError('');
    setActiveRequestLogId(requestLogId);
  };

  const closeRequestLogModal = () => {
    setActiveRequestLogId(null);
    setRequestLogContent('');
    setRequestLogLoading(false);
    setRequestLogError('');
  };

  const copyRequestLog = async () => {
    if (!requestLogContent) {
      return;
    }
    const copied = await copyToClipboard(requestLogContent);
    if (copied) {
      showNotification(t('logs.copy_success', { defaultValue: 'Log copied to clipboard' }), 'success');
      return;
    }
    showNotification(t('logs.copy_failed', { defaultValue: 'Copy failed' }), 'error');
  };

  const canCopyRequestLog = !requestLogLoading && !requestLogError && Boolean(requestLogContent);
  const hasFixedFilters = Object.values(normalizedFixedFilters).some(Boolean);

  const deletionStatusClassName = (status?: string): string => {
    switch (normalizeDeletionStatus(status)) {
      case 'pending':
        return `${styles.statusBadge} ${styles.statusPending}`;
      case 'deleted':
        return `${styles.statusBadge} ${styles.statusDeleted}`;
      case 'failed':
        return `${styles.statusBadge} ${styles.statusFailed}`;
      case 'dismissed':
        return `${styles.statusBadge} ${styles.statusDismissed}`;
      default:
        return styles.statusBadge;
    }
  };

  const applyAdvancedFilters = () => {
    setFilters({
      requestId: advancedDraft.requestId,
      start: advancedDraft.start,
      end: advancedDraft.end,
    });
  };

  const clearAdvancedFilters = () => {
    setAdvancedDraft({ requestId: '', start: '', end: '' });
    setFilters({ requestId: '', start: '', end: '' });
  };

  const switchViewMode = (nextMode: ErrorEventsViewMode) => {
    setViewMode(nextMode);
  };

  const openScopeDetails = (scopeRow: ScopeAggregateRow) => {
    setFilters({
      provider: scopeRow.provider,
      authId: scopeRow.authId,
      model: scopeRow.model,
    });
    setViewMode('detail');
  };

  const jumpToCircuitBreaker = () => {
    navigate('/circuit-breaker');
  };

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.filterBarCompact}>
          <button
            type="button"
            className={`${styles.filterToggleBtn} ${isFilterPanelOpen || hasActiveFilters ? styles.filterToggleActive : ''}`}
            onClick={() =>
              setIsFilterPanelOpen((prev) => {
                const next = !prev;
                if (next) {
                  setAdvancedDraft({
                    requestId: effectiveFilters.requestId,
                    start: effectiveFilters.start,
                    end: effectiveFilters.end,
                  });
                }
                return next;
              })
            }
            aria-expanded={isFilterPanelOpen}
          >
            <IconSlidersHorizontal size={14} />
            {t('error_events.filters')}
            {hasActiveFilters && <span className={styles.filterToggleBadge}>{activeFilterPills.length}</span>}
            <span className={`${styles.filterToggleIcon} ${isFilterPanelOpen ? styles.filterToggleIconRotated : ''}`}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </button>

          <div className={styles.filterPills}>
            {activeFilterPills.map((pill) => (
              <span key={pill.key} className={styles.filterPill}>
                <span title={`${pill.label}: ${pill.value}`}>
                  {pill.label}: {pill.value}
                </span>
                <button
                  type="button"
                  className={styles.filterPillClear}
                  onClick={() => setFilter(pill.key, '')}
                  aria-label={t('error_events.clear_filter', { label: pill.label })}
                >
                  <IconX size={12} />
                </button>
              </span>
            ))}
          </div>

          <div className={styles.actions}>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={resetAllFilters} disabled={refreshDisabled}>
                {t('error_events.clear_filters')}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refresh()}
              loading={loading}
              disabled={refreshDisabled}
            >
              {t('error_events.refresh')}
            </Button>
          </div>
        </div>

        {isFilterPanelOpen && (
          <div className={styles.filterPanel}>
            <FilterSelect
              label={t('error_events.filter_provider')}
              value={effectiveFilters.provider}
              options={filterOptions.provider}
              onChange={(value) => setFilter('provider', value)}
              disabled={Boolean(normalizedFixedFilters.provider)}
            />
            <FilterSelect
              label={t('error_events.filter_auth')}
              value={effectiveFilters.authId}
              options={filterOptions.authId}
              onChange={(value) => setFilter('authId', value)}
              disabled={Boolean(normalizedFixedFilters.authId)}
            />
            <FilterSelect
              label={t('error_events.filter_model')}
              value={effectiveFilters.model}
              options={filterOptions.model}
              onChange={(value) => setFilter('model', value)}
              disabled={Boolean(normalizedFixedFilters.model)}
            />
            <FilterSelect
              label={t('error_events.filter_failure_stage')}
              value={effectiveFilters.failureStage}
              options={filterOptions.failureStage}
              onChange={(value) => setFilter('failureStage', value)}
              disabled={Boolean(normalizedFixedFilters.failureStage)}
            />
            <FilterSelect
              label={t('error_events.filter_error_code')}
              value={effectiveFilters.errorCode}
              options={filterOptions.errorCode}
              onChange={(value) => setFilter('errorCode', value)}
              disabled={Boolean(normalizedFixedFilters.errorCode)}
            />
            <FilterSelect
              label={t('error_events.filter_status_code')}
              value={effectiveFilters.statusCode}
              options={filterOptions.statusCode}
              onChange={(value) => setFilter('statusCode', value)}
              disabled={Boolean(normalizedFixedFilters.statusCode)}
            />
            <Input
              label={t('error_events.filter_request_id')}
              value={advancedDraft.requestId}
              onChange={(event) =>
                setAdvancedDraft((prev) => ({
                  ...prev,
                  requestId: event.target.value,
                }))
              }
              placeholder={t('error_events.filter_request_id_placeholder')}
              disabled={Boolean(normalizedFixedFilters.requestId)}
            />
            <Input
              label={t('error_events.filter_start')}
              value={advancedDraft.start}
              onChange={(event) =>
                setAdvancedDraft((prev) => ({
                  ...prev,
                  start: event.target.value,
                }))
              }
              placeholder={t('error_events.filter_time_placeholder')}
              disabled={Boolean(normalizedFixedFilters.start)}
            />
            <Input
              label={t('error_events.filter_end')}
              value={advancedDraft.end}
              onChange={(event) =>
                setAdvancedDraft((prev) => ({
                  ...prev,
                  end: event.target.value,
                }))
              }
              placeholder={t('error_events.filter_time_placeholder')}
              disabled={Boolean(normalizedFixedFilters.end)}
            />
            <div className={styles.actions}>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAdvancedFilters}
                disabled={refreshDisabled}
              >
                {t('error_events.clear_filters')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={applyAdvancedFilters}
                disabled={refreshDisabled}
              >
                {t('error_events.apply_filters')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {hasFixedFilters && <div className={styles.fixedHint}>{t('error_events.fixed_filters_hint')}</div>}
      {lastRefreshedAt && (
        <div className={styles.metaText}>
          {t('error_events.last_updated')}: {lastRefreshedAt.toLocaleTimeString()}
        </div>
      )}

      {summaryError && <div className={styles.errorBox}>{summaryError}</div>}

      {!summaryLoading && hasSummaryMetrics && (
        <div className={styles.summaryStrip}>
          <div className={styles.summaryStripHeader}>
            <span className={styles.summaryStripTitle}>{t('error_events.summary_title')}</span>
            <span className={styles.summaryStripTotal}>
              {t('error_events.summary_total_events', { count: metrics.total || total })}
            </span>
            <span className={styles.summaryStripTotal}>
              {t('error_events.summary_scope_count', { count: metrics.scopeCount })}
            </span>
            <span className={styles.summaryStripTotal}>
              {t('error_events.summary_circuit_countable_total', {
                count: metrics.circuitCountableTotal,
              })}
            </span>
          </div>
        </div>
      )}

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.metaRow}>
        <span>
          {viewMode === 'detail'
            ? t('error_events.detail_count', { count: total })
            : t('error_events.scope_count', { count: scopeRows.length })}
        </span>
        <div
          className={styles.viewSwitch}
          role="tablist"
          aria-label={t('error_events.view_mode_label')}
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'detail'}
            className={`${styles.viewSwitchButton} ${viewMode === 'detail' ? styles.viewSwitchButtonActive : ''}`}
            onClick={() => switchViewMode('detail')}
          >
            {t('error_events.view_mode_detail')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'scope'}
            className={`${styles.viewSwitchButton} ${viewMode === 'scope' ? styles.viewSwitchButtonActive : ''}`}
            onClick={() => switchViewMode('scope')}
          >
            {t('error_events.view_mode_scope')}
          </button>
        </div>
      </div>

      {viewMode === 'scope' ? (
        summaryLoading ? (
          <div className={styles.metaText}>{t('common.loading')}</div>
        ) : !hasScopeRows ? (
          <EmptyState
            title={t('error_events.scope_empty_title')}
            description={t('error_events.scope_empty_description')}
          />
        ) : (
          <div className={styles.tableWrapper}>
            <table className={`${styles.table} ${styles.scopeTable}`}>
              <colgroup>
                <col className={styles.colScopeProvider} />
                <col className={styles.colScopeAuth} />
                <col className={styles.colScopeModel} />
                <col className={styles.colScopeTotal} />
                <col className={styles.colScopeCountable} />
                <col className={styles.colScopeProgress} />
                <col className={styles.colScopeLatest} />
                <col className={styles.colScopeAction} />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('error_events.col_provider')}</th>
                  <th>{t('error_events.col_auth')}</th>
                  <th>{t('error_events.col_model')}</th>
                  <th>{t('error_events.scope_col_total')}</th>
                  <th>{t('error_events.scope_col_circuit_countable')}</th>
                  <th>{t('error_events.col_progress')}</th>
                  <th>{t('error_events.scope_col_latest')}</th>
                  <th>{t('error_events.col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {scopeRows.map((scopeRow) => {
                  const progress = scopeRow.progressScopeKey
                    ? progressByScope[scopeRow.progressScopeKey]
                    : undefined;
                  const breakerText = progress?.breaker
                    ? formatProgressRatio(
                        t('error_events.progress_breaker'),
                        progress.breaker.current,
                        progress.breaker.threshold
                      )
                    : '-';
                  const deletionProgress = progress?.deletion;
                  let deletionText = '-';
                  if (deletionProgress) {
                    if (deletionProgress.enabled) {
                      deletionText = formatProgressRatio(
                        t('error_events.progress_deletion'),
                        deletionProgress.current,
                        deletionProgress.threshold
                      );
                    } else {
                      deletionText = `${t('error_events.progress_deletion')} ${t('error_events.progress_disabled')}`;
                    }
                  }

                  return (
                    <tr key={scopeRow.key}>
                      <td className={styles.codeCell}>{scopeRow.displayProvider}</td>
                      <td className={styles.codeCell}>{scopeRow.displayAuthId}</td>
                      <td className={styles.codeCell}>{scopeRow.displayModel}</td>
                      <td>{scopeRow.total.toLocaleString()}</td>
                      <td>{scopeRow.circuitCountableTotal.toLocaleString()}</td>
                      <td className={styles.progressCell}>
                        <div>{breakerText}</div>
                        {deletionProgress?.status ? (
                          <div className={styles.progressStatusRow}>
                            <span className={styles.subText}>{deletionText}</span>
                            <span className={deletionStatusClassName(deletionProgress.status)}>
                              {normalizeDeletionStatus(deletionProgress.status)}
                            </span>
                          </div>
                        ) : (
                          <div className={styles.subText}>{deletionText}</div>
                        )}
                      </td>
                      <td className={styles.cellTime}>{formatTime(scopeRow.latestOccurredAt)}</td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openScopeDetails(scopeRow)}
                        >
                          {t('error_events.scope_action_view_details')}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : loading && !hasRows ? (
        <div className={styles.metaText}>{t('common.loading')}</div>
      ) : !hasRows ? (
        <EmptyState
          title={t('error_events.empty_title')}
          description={t('error_events.empty_description')}
        />
      ) : (
        <>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <colgroup>
                <col className={styles.colTime} />
                <col className={styles.colProvider} />
                <col className={styles.colAuth} />
                <col className={styles.colModel} />
                <col className={styles.colFailure} />
                <col className={styles.colStatus} />
                <col className={styles.colMessage} />
                <col className={styles.colCircuit} />
                <col className={styles.colProgress} />
                <col className={styles.colRequest} />
                <col className={styles.colAttempt} />
                <col className={styles.colActions} />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('error_events.col_time')}</th>
                  <th>{t('error_events.col_provider')}</th>
                  <th>{t('error_events.col_auth')}</th>
                  <th>{t('error_events.col_model')}</th>
                  <th>{t('error_events.col_failure')}</th>
                  <th>{t('error_events.col_status')}</th>
                  <th>{t('error_events.col_message')}</th>
                  <th>{t('error_events.col_circuit')}</th>
                  <th>{t('error_events.col_progress')}</th>
                  <th>{t('error_events.col_request')}</th>
                  <th>{t('error_events.col_attempt')}</th>
                  <th className={styles.colActionsSticky}>{t('error_events.col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const requestTarget = (item.request_log_ref || item.request_id || '').trim();
                  const upstreamText = item.upstream_request_ids?.join(', ') || '-';
                  const modelText = item.normalized_model || item.model || '-';
                  const requestText = item.request_id || item.request_log_ref || '-';
                  const progress = item.progress_scope_key
                    ? progressByScope[item.progress_scope_key]
                    : undefined;
                  const breakerProgress = progress?.breaker;
                  const deletionProgress = progress?.deletion;
                  const breakerText =
                    breakerProgress && typeof breakerProgress.threshold === 'number'
                      ? formatProgressRatio(
                          t('error_events.progress_breaker'),
                          breakerProgress.current,
                          breakerProgress.threshold
                        )
                      : '-';
                  let deletionText = '-';
                  if (deletionProgress) {
                    if (deletionProgress.enabled) {
                      deletionText = formatProgressRatio(
                        t('error_events.progress_deletion'),
                        deletionProgress.current,
                        deletionProgress.threshold
                      );
                      if (deletionProgress.status) {
                        deletionText = `${deletionText} · ${deletionProgress.status}`;
                      }
                    } else {
                      deletionText = `${t('error_events.progress_deletion')} ${t('error_events.progress_disabled')}`;
                    }
                  }

                  return (
                    <tr key={item.id || `${requestText}-${index}`}>
                      <td className={styles.cellTime} title={item.occurred_at || '-'}>
                        {formatTime(item.occurred_at)}
                      </td>
                      <td className={styles.codeCell}>{item.provider || '-'}</td>
                      <td className={styles.codeCell}>{item.auth_id || '-'}</td>
                      <td className={styles.codeCell} title={modelText}>
                        {modelText}
                      </td>
                      <td className={styles.codeCell}>
                        {[item.failure_stage, item.error_code].filter(Boolean).join(' / ') || '-'}
                      </td>
                      <td>{item.status_code ? item.status_code : '-'}</td>
                      <td className={styles.messageCell} title={item.error_message_masked || '-'}>
                        {item.error_message_masked || '-'}
                      </td>
                      <td>
                        <span
                          className={
                            item.circuit_countable ? styles.circuitCountable : styles.circuitSkipped
                          }
                        >
                          {item.circuit_countable
                            ? t('error_events.circuit_countable')
                            : t('error_events.circuit_skipped')}
                        </span>
                        {!item.circuit_countable && item.circuit_skip_reason && (
                          <div className={styles.subText}>{item.circuit_skip_reason}</div>
                        )}
                      </td>
                      <td className={styles.progressCell}>
                        <div>{breakerText}</div>
                        {deletionProgress?.status ? (
                          <div className={styles.progressStatusRow}>
                            <span className={styles.subText}>
                              {formatProgressRatio(
                                t('error_events.progress_deletion'),
                                deletionProgress.current,
                                deletionProgress.threshold
                              )}
                            </span>
                            <span className={deletionStatusClassName(deletionProgress.status)}>
                              {normalizeDeletionStatus(deletionProgress.status)}
                            </span>
                          </div>
                        ) : (
                          <div className={styles.subText}>{deletionText}</div>
                        )}
                      </td>
                      <td className={styles.codeCell} title={requestText}>
                        {requestText}
                      </td>
                      <td className={styles.codeCell} title={upstreamText}>
                        <div>{item.attempt_count ? item.attempt_count : '-'}</div>
                        <div className={styles.subText}>{upstreamText}</div>
                      </td>
                      <td className={styles.colActionsSticky}>
                        <div className={styles.actionColumn}>
                          {requestTarget ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openRequestLogModal(requestTarget)}
                            >
                              {t('error_events.view_log')}
                            </Button>
                          ) : (
                            <span className={styles.subText}>-</span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={jumpToCircuitBreaker}
                          >
                            {t('error_events.view_circuit_breaker')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage(page - 1)}
                disabled={page <= 1 || loading}
              >
                {t('common.prev')}
              </Button>
              <span className={styles.metaText}>
                {t('error_events.page_info', {
                  current: page,
                  total: totalPages,
                  count: total,
                })}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages || loading}
              >
                {t('common.next')}
              </Button>
            </div>
          )}
        </>
      )}

      <Modal
        open={Boolean(activeRequestLogId)}
        onClose={closeRequestLogModal}
        title={
          activeRequestLogId
            ? t('error_events.request_log_modal_title_with_id', { id: activeRequestLogId })
            : t('error_events.request_log_modal_title')
        }
        width={980}
        footer={
          <>
            <Button variant="secondary" onClick={() => void copyRequestLog()} disabled={!canCopyRequestLog}>
              {t('common.copy')}
            </Button>
            <Button variant="secondary" onClick={closeRequestLogModal}>
              {t('common.close')}
            </Button>
          </>
        }
      >
        <div className={styles.requestLogModalBody}>
          {activeRequestLogId && (
            <div className={styles.requestLogMeta}>
              <span className={styles.requestLogMetaLabel}>{t('logs.trace_request_id')}</span>
              <span className={styles.requestLogMetaValue}>{activeRequestLogId}</span>
            </div>
          )}
          {requestLogLoading ? (
            <div className={styles.metaText}>{t('common.loading')}</div>
          ) : requestLogError ? (
            <div className={styles.errorBox}>{requestLogError}</div>
          ) : (
            <pre className={styles.requestLogPre}>{requestLogContent || '-'}</pre>
          )}
        </div>
      </Modal>
    </>
  );
}
