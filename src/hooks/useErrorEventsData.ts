import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  errorEventsApi,
  type ErrorEventInsightsParams,
  type ErrorEventItemPayload,
  type ErrorEventProgressSnapshotPayload,
  type ErrorEventSummaryItemPayload,
} from '@/services/api/errorEvents';

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_SUMMARY_LIMIT = 8;

export interface ErrorEventFilters {
  start: string;
  end: string;
  provider: string;
  authId: string;
  model: string;
  failureStage: string;
  errorCode: string;
  statusCode: string;
  requestId: string;
}

export interface ErrorEventSummaryBuckets {
  byProvider: ErrorEventSummaryItemPayload[];
  byAuth: ErrorEventSummaryItemPayload[];
  byModel: ErrorEventSummaryItemPayload[];
  byRiskScope: ErrorEventSummaryItemPayload[];
  byErrorCode: ErrorEventSummaryItemPayload[];
  byFailureStage: ErrorEventSummaryItemPayload[];
  byStatusCode: ErrorEventSummaryItemPayload[];
}

export interface ErrorEventInsightsMetrics {
  total: number;
  scopeCount: number;
  circuitCountableTotal: number;
}

export interface UseErrorEventsDataOptions {
  initialFilters?: Partial<ErrorEventFilters>;
  fixedFilters?: Partial<ErrorEventFilters>;
  pageSize?: number;
  summaryLimit?: number;
  autoLoad?: boolean;
}

export interface UseErrorEventsDataReturn {
  items: ErrorEventItemPayload[];
  progressByScope: Record<string, ErrorEventProgressSnapshotPayload>;
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string;
  summaryLoading: boolean;
  summaryError: string;
  summary: ErrorEventSummaryBuckets;
  metrics: ErrorEventInsightsMetrics;
  filters: ErrorEventFilters;
  effectiveFilters: ErrorEventFilters;
  lastRefreshedAt: Date | null;
  setPage: (nextPage: number) => void;
  setFilter: (key: keyof ErrorEventFilters, value: string) => void;
  setFilters: (patch: Partial<ErrorEventFilters>) => void;
  resetFilters: () => void;
  refresh: () => Promise<void>;
}

const DEFAULT_FILTERS: ErrorEventFilters = {
  start: '',
  end: '',
  provider: '',
  authId: '',
  model: '',
  failureStage: '',
  errorCode: '',
  statusCode: '',
  requestId: '',
};

const EMPTY_SUMMARY: ErrorEventSummaryBuckets = {
  byProvider: [],
  byAuth: [],
  byModel: [],
  byRiskScope: [],
  byErrorCode: [],
  byFailureStage: [],
  byStatusCode: [],
};

const EMPTY_METRICS: ErrorEventInsightsMetrics = {
  total: 0,
  scopeCount: 0,
  circuitCountableTotal: 0,
};

const normalizeFilterText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const buildFilters = (source?: Partial<ErrorEventFilters>): ErrorEventFilters => ({
  start: normalizeFilterText(source?.start),
  end: normalizeFilterText(source?.end),
  provider: normalizeFilterText(source?.provider),
  authId: normalizeFilterText(source?.authId),
  model: normalizeFilterText(source?.model),
  failureStage: normalizeFilterText(source?.failureStage),
  errorCode: normalizeFilterText(source?.errorCode),
  statusCode: normalizeFilterText(source?.statusCode),
  requestId: normalizeFilterText(source?.requestId),
});

const parseStatusCode = (value: string): number | undefined => {
  const normalized = normalizeFilterText(value);
  if (!normalized) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildQueryParams = (
  filters: ErrorEventFilters,
  page: number,
  pageSize: number,
  summaryLimit: number
): ErrorEventInsightsParams => {
  const statusCode = parseStatusCode(filters.statusCode);
  return {
    start: filters.start || undefined,
    end: filters.end || undefined,
    provider: filters.provider || undefined,
    authId: filters.authId || undefined,
    model: filters.model || undefined,
    failureStage: filters.failureStage || undefined,
    errorCode: filters.errorCode || undefined,
    statusCode,
    requestId: filters.requestId || undefined,
    page,
    pageSize,
    summaryLimit,
  };
};

const combineFilters = (base: ErrorEventFilters, fixed: ErrorEventFilters): ErrorEventFilters => ({
  start: fixed.start || base.start,
  end: fixed.end || base.end,
  provider: fixed.provider || base.provider,
  authId: fixed.authId || base.authId,
  model: fixed.model || base.model,
  failureStage: fixed.failureStage || base.failureStage,
  errorCode: fixed.errorCode || base.errorCode,
  statusCode: fixed.statusCode || base.statusCode,
  requestId: fixed.requestId || base.requestId,
});

const errorMessage = (value: unknown): string => (value instanceof Error ? value.message : '');

const parseScopeKey = (
  value?: string
): { provider: string; authId: string; normalizedModel: string } => {
  const parts = typeof value === 'string' ? value.trim().split('|') : [];
  if (parts.length !== 3) {
    return { provider: '', authId: '', normalizedModel: '' };
  }
  return {
    provider: parts[0]?.trim() || '',
    authId: parts[1]?.trim() || '',
    normalizedModel: parts[2]?.trim() || '',
  };
};

const sortSummaryItems = (items: ErrorEventSummaryItemPayload[]): ErrorEventSummaryItemPayload[] =>
  [...items].sort((left, right) => {
    const rightTotal = right.total || 0;
    const leftTotal = left.total || 0;
    if (rightTotal !== leftTotal) {
      return rightTotal - leftTotal;
    }
    const rightLatest = Date.parse(right.latest_occurred_at || '');
    const leftLatest = Date.parse(left.latest_occurred_at || '');
    if (Number.isFinite(rightLatest) && Number.isFinite(leftLatest) && rightLatest !== leftLatest) {
      return rightLatest - leftLatest;
    }
    return 0;
  });

const buildGroupedBuckets = (
  scopes: ErrorEventSummaryItemPayload[],
  field: 'provider' | 'auth_id' | 'normalized_model'
): ErrorEventSummaryItemPayload[] => {
  const grouped = new Map<string, ErrorEventSummaryItemPayload>();
  scopes.forEach((item) => {
    const scope = parseScopeKey(item.progress_scope_key);
    const value =
      (field === 'provider'
        ? item.provider || scope.provider
        : field === 'auth_id'
          ? item.auth_id || scope.authId
          : item.normalized_model || item.model || scope.normalizedModel
      ).trim();
    if (!value) {
      return;
    }

    const current = grouped.get(value);
    if (!current) {
      grouped.set(value, {
        provider: field === 'provider' ? value : undefined,
        auth_id: field === 'auth_id' ? value : undefined,
        model: field === 'normalized_model' ? value : undefined,
        normalized_model: field === 'normalized_model' ? value : undefined,
        total: item.total || 0,
        circuit_countable_total: item.circuit_countable_total || 0,
        latest_occurred_at: item.latest_occurred_at,
      });
      return;
    }

    current.total = (current.total || 0) + (item.total || 0);
    current.circuit_countable_total =
      (current.circuit_countable_total || 0) + (item.circuit_countable_total || 0);

    const nextLatest = Date.parse(item.latest_occurred_at || '');
    const prevLatest = Date.parse(current.latest_occurred_at || '');
    if (!Number.isFinite(prevLatest) || (Number.isFinite(nextLatest) && nextLatest > prevLatest)) {
      current.latest_occurred_at = item.latest_occurred_at;
    }
  });
  return sortSummaryItems(Array.from(grouped.values()));
};

const buildSummaryBuckets = (
  scopeRanking: ErrorEventSummaryItemPayload[],
  summary: {
    by_error_code: ErrorEventSummaryItemPayload[];
    by_failure_stage: ErrorEventSummaryItemPayload[];
    by_status_code: ErrorEventSummaryItemPayload[];
  }
): ErrorEventSummaryBuckets => {
  const sortedScopes = sortSummaryItems(scopeRanking);
  return {
    byProvider: buildGroupedBuckets(sortedScopes, 'provider'),
    byAuth: buildGroupedBuckets(sortedScopes, 'auth_id'),
    byModel: buildGroupedBuckets(sortedScopes, 'normalized_model'),
    byRiskScope: sortedScopes,
    byErrorCode: sortSummaryItems(summary.by_error_code || []),
    byFailureStage: sortSummaryItems(summary.by_failure_stage || []),
    byStatusCode: sortSummaryItems(summary.by_status_code || []),
  };
};

const parseLastRefreshedAt = (value?: string): Date => {
  const parsed = Date.parse(value || '');
  if (Number.isNaN(parsed)) {
    return new Date();
  }
  return new Date(parsed);
};

export function useErrorEventsData(options: UseErrorEventsDataOptions = {}): UseErrorEventsDataReturn {
  const initialFiltersRef = useRef(buildFilters(options.initialFilters));
  const [filtersState, setFiltersState] = useState<ErrorEventFilters>(initialFiltersRef.current);
  const [items, setItems] = useState<ErrorEventItemPayload[]>([]);
  const [progressByScope, setProgressByScope] = useState<
    Record<string, ErrorEventProgressSnapshotPayload>
  >({});
  const [total, setTotal] = useState(0);
  const [page, setPageState] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [summary, setSummary] = useState<ErrorEventSummaryBuckets>(EMPTY_SUMMARY);
  const [metrics, setMetrics] = useState<ErrorEventInsightsMetrics>(EMPTY_METRICS);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
  const summaryLimit = Math.max(1, options.summaryLimit ?? DEFAULT_SUMMARY_LIMIT);
  const autoLoad = options.autoLoad !== false;

  const fixedFilters = useMemo(
    () =>
      buildFilters({
        start: options.fixedFilters?.start,
        end: options.fixedFilters?.end,
        provider: options.fixedFilters?.provider,
        authId: options.fixedFilters?.authId,
        model: options.fixedFilters?.model,
        failureStage: options.fixedFilters?.failureStage,
        errorCode: options.fixedFilters?.errorCode,
        statusCode: options.fixedFilters?.statusCode,
        requestId: options.fixedFilters?.requestId,
      }),
    [
      options.fixedFilters?.authId,
      options.fixedFilters?.end,
      options.fixedFilters?.errorCode,
      options.fixedFilters?.failureStage,
      options.fixedFilters?.model,
      options.fixedFilters?.provider,
      options.fixedFilters?.requestId,
      options.fixedFilters?.start,
      options.fixedFilters?.statusCode,
    ]
  );

  const effectiveFilters = useMemo(
    () => combineFilters(filtersState, fixedFilters),
    [filtersState, fixedFilters]
  );

  const queryParams = useMemo(
    () => buildQueryParams(effectiveFilters, page, pageSize, summaryLimit),
    [effectiveFilters, page, pageSize, summaryLimit]
  );

  const queryFingerprint = useMemo(() => JSON.stringify(queryParams), [queryParams]);
  const fixedFiltersFingerprint = useMemo(() => JSON.stringify(fixedFilters), [fixedFilters]);
  const inFlightIdRef = useRef(0);

  useEffect(() => {
    setPageState(1);
  }, [fixedFiltersFingerprint]);

  const setPage = useCallback((nextPage: number) => {
    setPageState(nextPage > 0 ? nextPage : 1);
  }, []);

  const setFilter = useCallback((key: keyof ErrorEventFilters, value: string) => {
    setPageState(1);
    setFiltersState((previous) => ({
      ...previous,
      [key]: normalizeFilterText(value),
    }));
  }, []);

  const setFilters = useCallback((patch: Partial<ErrorEventFilters>) => {
    setPageState(1);
    setFiltersState((previous) => {
      const next = { ...previous };
      (Object.keys(DEFAULT_FILTERS) as Array<keyof ErrorEventFilters>).forEach((key) => {
        if (patch[key] !== undefined) {
          next[key] = normalizeFilterText(patch[key]);
        }
      });
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setPageState(1);
    setFiltersState(initialFiltersRef.current);
  }, []);

  const refresh = useCallback(async () => {
    const currentRequestId = inFlightIdRef.current + 1;
    inFlightIdRef.current = currentRequestId;
    setLoading(true);
    setSummaryLoading(true);
    setError('');
    setSummaryError('');

    try {
      const result = await errorEventsApi.insights(queryParams);
      if (inFlightIdRef.current !== currentRequestId) {
        return;
      }

      setItems(result.items || []);
      setTotal(result.total || 0);
      setPageState(result.page || page);
      setProgressByScope(result.meta?.progress_by_scope || {});
      setSummary(buildSummaryBuckets(result.scope_ranking || [], result.summary));
      setMetrics({
        total: result.metrics?.total || 0,
        scopeCount: result.metrics?.scope_count || 0,
        circuitCountableTotal: result.metrics?.circuit_countable_total || 0,
      });
      setLastRefreshedAt(parseLastRefreshedAt(result.meta?.last_updated));
    } catch (loadError: unknown) {
      if (inFlightIdRef.current !== currentRequestId) {
        return;
      }
      const message = errorMessage(loadError);
      setError(message);
      setSummaryError(message);
      setItems([]);
      setProgressByScope({});
      setTotal(0);
      setSummary(EMPTY_SUMMARY);
      setMetrics(EMPTY_METRICS);
    } finally {
      if (inFlightIdRef.current === currentRequestId) {
        setLoading(false);
        setSummaryLoading(false);
      }
    }
  }, [page, queryParams]);

  useEffect(() => {
    if (!autoLoad) {
      return;
    }
    void refresh();
  }, [autoLoad, queryFingerprint, refresh]);

  return {
    items,
    progressByScope,
    total,
    page,
    pageSize,
    loading,
    error,
    summaryLoading,
    summaryError,
    summary,
    metrics,
    filters: filtersState,
    effectiveFilters,
    lastRefreshedAt,
    setPage,
    setFilter,
    setFilters,
    resetFilters,
    refresh,
  };
}
