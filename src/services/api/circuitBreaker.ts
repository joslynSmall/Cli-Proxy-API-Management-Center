/**
 * Circuit Breaker API
 */

import { apiClient } from './client';

export interface CircuitBreakerErrorInsightFilters {
  provider?: string;
  authId?: string;
  model?: string;
}

export interface CircuitBreakerStatus {
  provider?: string;
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailure: string;
  recoveryAt?: string;
  errorInsightFilters?: CircuitBreakerErrorInsightFilters;
}

export type CircuitBreakerMap = Record<string, Record<string, CircuitBreakerStatus>>;

export interface CircuitBreakerTarget {
  clientId: string;
  modelId: string;
}

export type CircuitBreakerDeletionStatus = 'pending' | 'deleted' | 'failed' | 'dismissed';

export interface CircuitBreakerDeletionItem {
  id: string;
  auth_id: string;
  provider: string;
  model: string;
  normalized_model?: string;
  dedupe_key?: string;
  status: CircuitBreakerDeletionStatus;
  open_cycles?: number;
  failure_count?: number;
  consecutive_failures?: number;
  opened_at?: string;
  recovery_at?: string;
  action_at?: string;
  action_by?: string;
  action_error?: string;
  persisted?: boolean;
  already_removed?: boolean;
  runtime_suspended?: boolean;
  persist_error?: string;
  updated_at?: string;
  created_at?: string;
}

export interface CircuitBreakerDeletionListParams {
  provider?: string;
  authId?: string;
  model?: string;
  status?: CircuitBreakerDeletionStatus;
  start?: string;
  end?: string;
  page?: number;
  pageSize?: number;
}

export interface CircuitBreakerDeletionListResult {
  items: CircuitBreakerDeletionItem[];
  total: number;
  page: number;
  page_size: number;
}

export const circuitBreakerApi = {
  async list(): Promise<CircuitBreakerMap> {
    const data = await apiClient.get<CircuitBreakerMap>('/circuit-breaker');
    return data ?? {};
  },

  async listDeletions(
    params: CircuitBreakerDeletionListParams = {}
  ): Promise<CircuitBreakerDeletionListResult> {
    const data = await apiClient.get<CircuitBreakerDeletionListResult>('/circuit-breaker/deletions', {
      params: {
        provider: params.provider,
        auth_id: params.authId,
        model: params.model,
        status: params.status,
        start: params.start,
        end: params.end,
        page: params.page,
        page_size: params.pageSize,
      },
    });

    return {
      items: data?.items ?? [],
      total: data?.total ?? 0,
      page: data?.page ?? params.page ?? 1,
      page_size: data?.page_size ?? params.pageSize ?? 20,
    };
  },

  reset(target: CircuitBreakerTarget): Promise<void> {
    return apiClient.delete('/circuit-breaker', { data: target });
  },

  open(target: CircuitBreakerTarget): Promise<void> {
    return apiClient.put('/circuit-breaker', target);
  },

  executeDeletion(id: string): Promise<void> {
    return apiClient.delete(`/circuit-breaker/deletions/${encodeURIComponent(id)}`);
  },

  dismissDeletion(id: string): Promise<void> {
    return apiClient.post(`/circuit-breaker/deletions/${encodeURIComponent(id)}/dismiss`);
  },
};
