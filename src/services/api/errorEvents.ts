import { apiClient } from './client';

export interface ErrorEventItemPayload {
  id?: string;
  dedupe_key?: string;
  progress_scope_key?: string;
  created_at?: string;
  occurred_at?: string;
  provider?: string;
  model?: string;
  normalized_model?: string;
  source?: string;
  auth_id?: string;
  auth_index?: string;
  request_id?: string;
  request_log_ref?: string;
  attempt_count?: number;
  upstream_request_ids?: string[];
  failed?: boolean;
  failure_stage?: string;
  error_code?: string;
  error_message_masked?: string;
  error_message_hash?: string;
  status_code?: number;
  circuit_countable?: boolean;
  circuit_skip_reason?: string;
}

export interface ErrorEventBreakerProgressPayload {
  current?: number;
  threshold?: number;
  state?: string;
}

export interface ErrorEventDeletionProgressPayload {
  enabled?: boolean;
  current?: number;
  threshold?: number;
  status?: string;
}

export interface ErrorEventProgressSnapshotPayload {
  breaker?: ErrorEventBreakerProgressPayload;
  deletion?: ErrorEventDeletionProgressPayload;
}

export interface ErrorEventListMetaPayload {
  progress_by_scope?: Record<string, ErrorEventProgressSnapshotPayload>;
}

export interface ErrorEventListParams {
  start?: string;
  end?: string;
  provider?: string;
  authId?: string;
  model?: string;
  failureStage?: string;
  errorCode?: string;
  statusCode?: number;
  requestId?: string;
  page?: number;
  pageSize?: number;
}

export interface ErrorEventListResult {
  items: ErrorEventItemPayload[];
  meta: ErrorEventListMetaPayload;
  total: number;
  page: number;
  page_size: number;
}

export interface ErrorEventSummaryItemPayload {
  provider?: string;
  model?: string;
  normalized_model?: string;
  auth_id?: string;
  progress_scope_key?: string;
  error_code?: string;
  failure_stage?: string;
  status_code?: number | null;
  total?: number;
  circuit_countable_total?: number;
  latest_occurred_at?: string;
}

export interface ErrorEventSummaryParams {
  start?: string;
  end?: string;
  provider?: string;
  authId?: string;
  model?: string;
  failureStage?: string;
  errorCode?: string;
  statusCode?: number;
  groupBy?: string[];
  limit?: number;
}

export interface ErrorEventSummaryResult {
  items: ErrorEventSummaryItemPayload[];
  group_by: string[];
  meta: ErrorEventListMetaPayload;
}

export interface ErrorEventInsightsMetricsPayload {
  total?: number;
  scope_count?: number;
  circuit_countable_total?: number;
}

export interface ErrorEventInsightsSummaryPayload {
  by_error_code?: ErrorEventSummaryItemPayload[];
  by_failure_stage?: ErrorEventSummaryItemPayload[];
  by_status_code?: ErrorEventSummaryItemPayload[];
}

export interface ErrorEventInsightsMetaPayload {
  progress_by_scope?: Record<string, ErrorEventProgressSnapshotPayload>;
  last_updated?: string;
}

export interface ErrorEventInsightsParams extends ErrorEventListParams {
  summaryLimit?: number;
}

export interface ErrorEventInsightsResult {
  metrics: {
    total: number;
    scope_count: number;
    circuit_countable_total: number;
  };
  scope_ranking: ErrorEventSummaryItemPayload[];
  summary: {
    by_error_code: ErrorEventSummaryItemPayload[];
    by_failure_stage: ErrorEventSummaryItemPayload[];
    by_status_code: ErrorEventSummaryItemPayload[];
  };
  items: ErrorEventItemPayload[];
  total: number;
  page: number;
  page_size: number;
  meta: {
    progress_by_scope: Record<string, ErrorEventProgressSnapshotPayload>;
    last_updated: string;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toOptionalFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const normalizeErrorEventItem = (value: unknown): ErrorEventItemPayload => {
  const record = isRecord(value) ? value : {};
  return {
    id: typeof record.id === 'string' ? record.id : '',
    dedupe_key: typeof record.dedupe_key === 'string' ? record.dedupe_key : '',
    progress_scope_key:
      typeof record.progress_scope_key === 'string' ? record.progress_scope_key : '',
    created_at: typeof record.created_at === 'string' ? record.created_at : '',
    occurred_at: typeof record.occurred_at === 'string' ? record.occurred_at : '',
    provider: typeof record.provider === 'string' ? record.provider : '',
    model: typeof record.model === 'string' ? record.model : '',
    normalized_model: typeof record.normalized_model === 'string' ? record.normalized_model : '',
    source: typeof record.source === 'string' ? record.source : '',
    auth_id: typeof record.auth_id === 'string' ? record.auth_id : '',
    auth_index: typeof record.auth_index === 'string' ? record.auth_index : '',
    request_id: typeof record.request_id === 'string' ? record.request_id : '',
    request_log_ref: typeof record.request_log_ref === 'string' ? record.request_log_ref : '',
    attempt_count: Math.max(toFiniteNumber(record.attempt_count), 0),
    upstream_request_ids: normalizeStringArray(record.upstream_request_ids),
    failed: record.failed === true,
    failure_stage: typeof record.failure_stage === 'string' ? record.failure_stage : '',
    error_code: typeof record.error_code === 'string' ? record.error_code : '',
    error_message_masked:
      typeof record.error_message_masked === 'string' ? record.error_message_masked : '',
    error_message_hash: typeof record.error_message_hash === 'string' ? record.error_message_hash : '',
    status_code: Math.max(toFiniteNumber(record.status_code), 0),
    circuit_countable: record.circuit_countable === true,
    circuit_skip_reason: typeof record.circuit_skip_reason === 'string' ? record.circuit_skip_reason : '',
  };
};

const normalizeProgressSnapshot = (value: unknown): ErrorEventProgressSnapshotPayload => {
  const record = isRecord(value) ? value : {};
  const breaker = isRecord(record.breaker) ? record.breaker : {};
  const deletion = isRecord(record.deletion) ? record.deletion : {};
  return {
    breaker: {
      current: Math.max(toFiniteNumber(breaker.current), 0),
      threshold: Math.max(toFiniteNumber(breaker.threshold), 0),
      state: typeof breaker.state === 'string' ? breaker.state : '',
    },
    deletion: {
      enabled: deletion.enabled === true,
      current: Math.max(toFiniteNumber(deletion.current), 0),
      threshold: Math.max(toFiniteNumber(deletion.threshold), 0),
      status: typeof deletion.status === 'string' ? deletion.status : '',
    },
  };
};

const normalizeProgressByScope = (
  value: unknown
): Record<string, ErrorEventProgressSnapshotPayload> => {
  if (!isRecord(value)) {
    return {};
  }
  const result: Record<string, ErrorEventProgressSnapshotPayload> = {};
  Object.entries(value).forEach(([key, item]) => {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return;
    }
    result[normalizedKey] = normalizeProgressSnapshot(item);
  });
  return result;
};

const normalizeErrorEventListResult = (value: unknown): ErrorEventListResult => {
  const record = isRecord(value) ? value : {};
  const meta = isRecord(record.meta) ? record.meta : {};
  return {
    items: Array.isArray(record.items) ? record.items.map(normalizeErrorEventItem) : [],
    meta: {
      progress_by_scope: normalizeProgressByScope(meta.progress_by_scope),
    },
    total: Math.max(toFiniteNumber(record.total), 0),
    page: Math.max(toFiniteNumber(record.page), 1),
    page_size: Math.max(toFiniteNumber(record.page_size), 1),
  };
};

const normalizeErrorEventSummaryItem = (value: unknown): ErrorEventSummaryItemPayload => {
  const record = isRecord(value) ? value : {};
  return {
    provider: typeof record.provider === 'string' ? record.provider : '',
    model: typeof record.model === 'string' ? record.model : '',
    normalized_model:
      typeof record.normalized_model === 'string' ? record.normalized_model : '',
    auth_id: typeof record.auth_id === 'string' ? record.auth_id : '',
    progress_scope_key:
      typeof record.progress_scope_key === 'string' ? record.progress_scope_key : '',
    error_code: typeof record.error_code === 'string' ? record.error_code : '',
    failure_stage: typeof record.failure_stage === 'string' ? record.failure_stage : '',
    status_code: toOptionalFiniteNumber(record.status_code),
    total: Math.max(toFiniteNumber(record.total), 0),
    circuit_countable_total: Math.max(toFiniteNumber(record.circuit_countable_total), 0),
    latest_occurred_at:
      typeof record.latest_occurred_at === 'string' ? record.latest_occurred_at : '',
  };
};

const normalizeErrorEventSummaryResult = (value: unknown): ErrorEventSummaryResult => {
  const record = isRecord(value) ? value : {};
  const meta = isRecord(record.meta) ? record.meta : {};
  return {
    items: Array.isArray(record.items) ? record.items.map(normalizeErrorEventSummaryItem) : [],
    group_by: normalizeStringArray(record.group_by),
    meta: {
      progress_by_scope: normalizeProgressByScope(meta.progress_by_scope),
    },
  };
};

const normalizeSummaryItems = (value: unknown): ErrorEventSummaryItemPayload[] =>
  Array.isArray(value) ? value.map(normalizeErrorEventSummaryItem) : [];

const normalizeErrorEventInsightsResult = (value: unknown): ErrorEventInsightsResult => {
  const record = isRecord(value) ? value : {};
  const metrics = isRecord(record.metrics) ? record.metrics : {};
  const summary = isRecord(record.summary) ? record.summary : {};
  const meta = isRecord(record.meta) ? record.meta : {};

  return {
    metrics: {
      total: Math.max(toFiniteNumber(metrics.total), 0),
      scope_count: Math.max(toFiniteNumber(metrics.scope_count), 0),
      circuit_countable_total: Math.max(toFiniteNumber(metrics.circuit_countable_total), 0),
    },
    scope_ranking: normalizeSummaryItems(record.scope_ranking),
    summary: {
      by_error_code: normalizeSummaryItems(summary.by_error_code),
      by_failure_stage: normalizeSummaryItems(summary.by_failure_stage),
      by_status_code: normalizeSummaryItems(summary.by_status_code),
    },
    items: Array.isArray(record.items) ? record.items.map(normalizeErrorEventItem) : [],
    total: Math.max(toFiniteNumber(record.total), 0),
    page: Math.max(toFiniteNumber(record.page), 1),
    page_size: Math.max(toFiniteNumber(record.page_size), 1),
    meta: {
      progress_by_scope: normalizeProgressByScope(meta.progress_by_scope),
      last_updated: typeof meta.last_updated === 'string' ? meta.last_updated : '',
    },
  };
};

export const errorEventsApi = {
  async insights(params: ErrorEventInsightsParams = {}): Promise<ErrorEventInsightsResult> {
    const data = await apiClient.get<unknown>('/error-events/insights', {
      params: {
        start: params.start,
        end: params.end,
        provider: params.provider,
        auth_id: params.authId,
        model: params.model,
        failure_stage: params.failureStage,
        error_code: params.errorCode,
        status_code: params.statusCode,
        request_id: params.requestId,
        page: params.page,
        page_size: params.pageSize,
        summary_limit: params.summaryLimit,
      },
    });
    return normalizeErrorEventInsightsResult(data);
  },

  async list(params: ErrorEventListParams = {}): Promise<ErrorEventListResult> {
    const data = await apiClient.get<unknown>('/error-events', {
      params: {
        start: params.start,
        end: params.end,
        provider: params.provider,
        auth_id: params.authId,
        model: params.model,
        failure_stage: params.failureStage,
        error_code: params.errorCode,
        status_code: params.statusCode,
        request_id: params.requestId,
        page: params.page,
        page_size: params.pageSize,
      },
    });
    return normalizeErrorEventListResult(data);
  },

  async summarize(params: ErrorEventSummaryParams = {}): Promise<ErrorEventSummaryResult> {
    const groupBy = Array.isArray(params.groupBy)
      ? params.groupBy
          .map((item) => item.trim())
          .filter(Boolean)
          .join(',')
      : undefined;

    const data = await apiClient.get<unknown>('/error-events/summary', {
      params: {
        start: params.start,
        end: params.end,
        provider: params.provider,
        auth_id: params.authId,
        model: params.model,
        failure_stage: params.failureStage,
        error_code: params.errorCode,
        status_code: params.statusCode,
        group_by: groupBy,
        limit: params.limit,
      },
    });
    return normalizeErrorEventSummaryResult(data);
  },
};
