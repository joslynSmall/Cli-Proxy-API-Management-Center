/**
 * Circuit Breaker API
 */

import { apiClient } from './client';

export interface CircuitBreakerStatus {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailure: string;
  recoveryAt?: string;
}

export type CircuitBreakerMap = Record<string, Record<string, CircuitBreakerStatus>>;

export interface CircuitBreakerTarget {
  clientId: string;
  modelId: string;
}

export const circuitBreakerApi = {
  async list(): Promise<CircuitBreakerMap> {
    const data = await apiClient.get<CircuitBreakerMap>('/circuit-breaker');
    return data ?? {};
  },

  reset(target: CircuitBreakerTarget): Promise<void> {
    return apiClient.delete('/circuit-breaker', { data: target });
  },

  open(target: CircuitBreakerTarget): Promise<void> {
    return apiClient.put('/circuit-breaker', target);
  },
};
