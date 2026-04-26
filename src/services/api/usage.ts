/**
 * 使用统计相关 API
 */

import { apiClient } from './client';
import {
  computeKeyStats,
  normalizeUsageSourceId,
  type KeyStats,
  type UsageDetail,
  type UsageTimeRange,
} from '@/utils/usage';

const USAGE_TIMEOUT_MS = 60 * 1000;

export interface RequestEventTokensPayload {
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
  cache_tokens?: number;
  total_tokens?: number;
}

export interface RequestEventItemPayload {
  event_id?: number;
  timestamp?: string;
  model?: string;
  source?: string;
  auth_index?: string;
  failed?: boolean;
  failure_stage?: string;
  error_code?: string;
  error_message?: string;
  status_code?: number;
  request_id?: string;
  request_log_ref?: string;
  attempt_count?: number;
  upstream_request_ids?: string[];
  tokens?: RequestEventTokensPayload;
}

export interface RequestEventsPagePayload {
  items?: RequestEventItemPayload[];
  latest_event_id?: number;
}

export interface ListRequestEventsOptions {
  timeRange?: UsageTimeRange;
  limit?: number;
}

export interface RequestEventsStreamResetPayload {
  reason?: string;
}

export interface OpenRequestEventsStreamOptions {
  sinceId?: number;
  signal?: AbortSignal;
  onEvent: (event: RequestEventItemPayload) => void;
  onResetRequired?: (payload: RequestEventsStreamResetPayload) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeRequestEventTokens = (value: unknown): RequestEventTokensPayload => {
  const record = isRecord(value) ? value : {};
  return {
    input_tokens: Math.max(toFiniteNumber(record.input_tokens), 0),
    output_tokens: Math.max(toFiniteNumber(record.output_tokens), 0),
    reasoning_tokens: Math.max(toFiniteNumber(record.reasoning_tokens), 0),
    cached_tokens: Math.max(toFiniteNumber(record.cached_tokens ?? record.cache_tokens), 0),
    total_tokens: Math.max(toFiniteNumber(record.total_tokens), 0),
  };
};

export const normalizeRequestEventItem = (value: unknown): RequestEventItemPayload => {
  const record = isRecord(value) ? value : {};
  const upstreamRequestIds = Array.isArray(record.upstream_request_ids)
    ? record.upstream_request_ids
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  return {
    event_id: Math.max(toFiniteNumber(record.event_id), 0),
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : '',
    model: typeof record.model === 'string' ? record.model : '',
    source: typeof record.source === 'string' ? record.source : '',
    auth_index: typeof record.auth_index === 'string' ? record.auth_index : '',
    failed: record.failed === true,
    failure_stage: typeof record.failure_stage === 'string' ? record.failure_stage : '',
    error_code: typeof record.error_code === 'string' ? record.error_code : '',
    error_message: typeof record.error_message === 'string' ? record.error_message : '',
    status_code: toFiniteNumber(record.status_code),
    request_id: typeof record.request_id === 'string' ? record.request_id : '',
    request_log_ref: typeof record.request_log_ref === 'string' ? record.request_log_ref : '',
    attempt_count: Math.max(toFiniteNumber(record.attempt_count), 0),
    upstream_request_ids: upstreamRequestIds,
    tokens: normalizeRequestEventTokens(record.tokens),
  };
};

const normalizeRequestEventsPage = (value: unknown): RequestEventsPagePayload => {
  const record = isRecord(value) ? value : {};
  return {
    items: Array.isArray(record.items) ? record.items.map(normalizeRequestEventItem) : [],
    latest_event_id: Math.max(toFiniteNumber(record.latest_event_id), 0),
  };
};

const createApiErrorFromResponse = async (response: Response): Promise<Error> => {
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('unauthorized'));
  }

  let message = `Request failed with status ${response.status}`;
  try {
    const payload = await response.json();
    if (typeof payload?.error === 'string') {
      message = payload.error;
    } else if (typeof payload?.message === 'string') {
      message = payload.message;
    }
  } catch {
    try {
      const text = await response.text();
      if (text.trim()) {
        message = text.trim();
      }
    } catch {
      // Ignore secondary parsing errors.
    }
  }

  return new Error(message);
};

const extractSseFrames = (buffer: string): { frames: string[]; rest: string } => {
  const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const frames: string[] = [];
  let searchFrom = 0;

  while (true) {
    const separatorIndex = normalized.indexOf('\n\n', searchFrom);
    if (separatorIndex === -1) {
      return { frames, rest: normalized.slice(searchFrom) };
    }
    frames.push(normalized.slice(searchFrom, separatorIndex));
    searchFrom = separatorIndex + 2;
  }
};

const handleSseFrame = (
  frame: string,
  options: Pick<OpenRequestEventsStreamOptions, 'onEvent' | 'onResetRequired'>
) => {
  if (!frame.trim()) {
    return;
  }

  let eventName = 'message';
  const dataLines: string[] = [];

  frame.split('\n').forEach((line) => {
    if (!line || line.startsWith(':')) {
      return;
    }
    const separatorIndex = line.indexOf(':');
    const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
    const rawValue = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : '';
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'event') {
      eventName = value;
      return;
    }
    if (field === 'data') {
      dataLines.push(value);
    }
  });

  if (!dataLines.length) {
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join('\n'));
  } catch {
    return;
  }

  if (eventName === 'request-event') {
    options.onEvent(normalizeRequestEventItem(payload));
    return;
  }

  if (eventName === 'reset-required') {
    const record = isRecord(payload) ? payload : {};
    options.onResetRequired?.({
      reason: typeof record.reason === 'string' ? record.reason : '',
    });
  }
};

export const requestEventToUsageDetail = (event: RequestEventItemPayload): UsageDetail => {
  const timestamp = String(event.timestamp ?? '').trim();
  const timestampMs = Date.parse(timestamp);
  const tokens = event.tokens ?? {};

  return {
    timestamp,
    source: normalizeUsageSourceId(event.source),
    auth_index: String(event.auth_index ?? '').trim(),
    request_id: String(event.request_id ?? '').trim(),
    request_log_ref: String(event.request_log_ref ?? '').trim(),
    attempt_count: Math.max(toFiniteNumber(event.attempt_count), 0),
    upstream_request_ids: Array.isArray(event.upstream_request_ids)
      ? event.upstream_request_ids
      : [],
    tokens: {
      input_tokens: Math.max(toFiniteNumber(tokens.input_tokens), 0),
      output_tokens: Math.max(toFiniteNumber(tokens.output_tokens), 0),
      reasoning_tokens: Math.max(toFiniteNumber(tokens.reasoning_tokens), 0),
      cached_tokens: Math.max(toFiniteNumber(tokens.cached_tokens ?? tokens.cache_tokens), 0),
      total_tokens: Math.max(toFiniteNumber(tokens.total_tokens), 0),
    },
    failed: event.failed === true,
    failure_stage: String(event.failure_stage ?? '').trim(),
    error_code: String(event.error_code ?? '').trim(),
    error_message: String(event.error_message ?? '').trim(),
    status_code: Math.max(toFiniteNumber(event.status_code), 0),
    __modelName: String(event.model ?? '').trim(),
    __timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
    __eventId: Math.max(toFiniteNumber(event.event_id), 0),
  };
};

export interface UsageExportPayload {
  version?: number;
  exported_at?: string;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UsageImportResponse {
  added?: number;
  skipped?: number;
  total_requests?: number;
  failed_requests?: number;
  [key: string]: unknown;
}

export const usageApi = {
  /**
   * 获取使用统计原始数据
   */
  getUsage: () => apiClient.get<Record<string, unknown>>('/usage', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 导出使用统计快照
   */
  exportUsage: () =>
    apiClient.get<UsageExportPayload>('/usage/export', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 导入使用统计快照
   */
  importUsage: (payload: unknown) =>
    apiClient.post<UsageImportResponse>('/usage/import', payload, { timeout: USAGE_TIMEOUT_MS }),

  listRequestEvents: async (options: ListRequestEventsOptions = {}) => {
    const params = new URLSearchParams();
    params.set('time_range', options.timeRange ?? '24h');
    if (options.limit && options.limit > 0) {
      params.set('limit', String(Math.trunc(options.limit)));
    }

    const page = await apiClient.get<RequestEventsPagePayload>(
      `/usage/request-events?${params.toString()}`,
      { timeout: USAGE_TIMEOUT_MS }
    );
    return normalizeRequestEventsPage(page);
  },

  openRequestEventsStream: async ({
    sinceId = 0,
    signal,
    onEvent,
    onResetRequired,
  }: OpenRequestEventsStreamOptions): Promise<void> => {
    const params = new URLSearchParams();
    if (sinceId > 0) {
      params.set('since_id', String(Math.trunc(sinceId)));
    }

    const response = await fetch(
      apiClient.buildUrl(
        `/usage/request-events/stream${params.size ? `?${params.toString()}` : ''}`
      ),
      {
        method: 'GET',
        headers: apiClient.buildAuthorizedHeaders({
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        }),
        cache: 'no-store',
        signal,
      }
    );

    if (!response.ok) {
      throw await createApiErrorFromResponse(response);
    }

    if (!response.body) {
      throw new Error('Request event stream unavailable');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const extracted = extractSseFrames(buffer);
      buffer = extracted.rest;
      extracted.frames.forEach((frame) => handleSseFrame(frame, { onEvent, onResetRequired }));
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      handleSseFrame(buffer, { onEvent, onResetRequired });
    }
  },

  /**
   * 计算密钥成功/失败统计，必要时会先获取 usage 数据
   */
  async getKeyStats(usageData?: unknown): Promise<KeyStats> {
    let payload = usageData;
    if (!payload) {
      const response = await apiClient.get<Record<string, unknown>>('/usage', {
        timeout: USAGE_TIMEOUT_MS,
      });
      payload = response?.usage ?? response;
    }
    return computeKeyStats(payload);
  },
};
