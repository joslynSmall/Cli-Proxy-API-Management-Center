import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/test/setup';
import { useErrorEventsData } from './useErrorEventsData';
import { errorEventsApi } from '@/services/api/errorEvents';

vi.mock('@/services/api/errorEvents', () => ({
  errorEventsApi: {
    insights: vi.fn(),
  },
}));

const mockedErrorEventsApi = vi.mocked(errorEventsApi);

describe('useErrorEventsData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedErrorEventsApi.insights.mockResolvedValue({
      metrics: {
        total: 12,
        scope_count: 2,
        circuit_countable_total: 10,
      },
      scope_ranking: [
        {
          provider: 'openai',
          auth_id: 'auth-a',
          normalized_model: 'gpt-4.1',
          progress_scope_key: 'openai|auth-a|gpt-4.1',
          total: 7,
          circuit_countable_total: 6,
        },
        {
          provider: 'openai',
          auth_id: 'auth-b',
          normalized_model: 'gpt-4.1',
          progress_scope_key: 'openai|auth-b|gpt-4.1',
          total: 5,
          circuit_countable_total: 4,
        },
      ],
      summary: {
        by_error_code: [{ error_code: 'upstream_timeout', total: 12, circuit_countable_total: 10 }],
        by_failure_stage: [{ failure_stage: 'request_execution', total: 12, circuit_countable_total: 10 }],
        by_status_code: [{ status_code: 503, total: 12, circuit_countable_total: 10 }],
      },
      items: [
        {
          id: 'evt-1',
          provider: 'openai',
          auth_id: 'auth-a',
          model: 'gpt-4.1',
          normalized_model: 'gpt-4.1',
          progress_scope_key: 'openai|auth-a|gpt-4.1',
        },
      ],
      total: 12,
      page: 1,
      page_size: 20,
      meta: {
        progress_by_scope: {
          'openai|auth-a|gpt-4.1': {
            breaker: {
              current: 2,
              threshold: 3,
              state: 'closed',
            },
            deletion: {
              enabled: true,
              current: 1,
              threshold: 3,
              status: 'pending',
            },
          },
        },
        last_updated: '2026-04-27T00:00:00Z',
      },
    } as any);
  });

  it('loads insights in one request and builds summary buckets', async () => {
    const { result } = renderHook(() => useErrorEventsData({ autoLoad: false }));

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(mockedErrorEventsApi.insights).toHaveBeenCalledTimes(1);
    });

    expect(mockedErrorEventsApi.insights).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
      })
    );
    expect(result.current.summary.byRiskScope).toHaveLength(2);
    expect(result.current.summary.byProvider[0].provider).toBe('openai');
    expect(result.current.summary.byAuth[0].auth_id).toBe('auth-a');
    expect(result.current.summary.byErrorCode[0].error_code).toBe('upstream_timeout');
    expect(result.current.metrics.total).toBe(12);
    expect(result.current.metrics.scopeCount).toBe(2);
    expect(result.current.progressByScope['openai|auth-a|gpt-4.1']?.breaker?.current).toBe(2);
  });
});
