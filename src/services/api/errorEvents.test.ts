import { describe, expect, it, vi, beforeEach } from 'vitest';
import { errorEventsApi } from './errorEvents';
import { apiClient } from './client';

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

const mockedApiClient = vi.mocked(apiClient);

describe('errorEventsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps insights params and normalizes payload', async () => {
    mockedApiClient.get.mockResolvedValueOnce({
      metrics: {
        total: '12',
        scope_count: '2',
        circuit_countable_total: '10',
      },
      scope_ranking: [
        {
          provider: 'openai',
          auth_id: 'auth-a',
          normalized_model: 'gpt-4.1',
          progress_scope_key: 'openai|auth-a|gpt-4.1',
          total: '7',
          circuit_countable_total: '6',
        },
      ],
      summary: {
        by_error_code: [{ error_code: 'upstream_timeout', total: '7', circuit_countable_total: '6' }],
        by_failure_stage: [{ failure_stage: 'request_execution', total: '7', circuit_countable_total: '6' }],
        by_status_code: [{ status_code: '503', total: '7', circuit_countable_total: '6' }],
      },
      items: [
        {
          id: 'evt-1',
          progress_scope_key: 'openai|auth-a|gpt-4.1',
          status_code: '503',
        },
      ],
      total: '12',
      page: '2',
      page_size: '5',
      meta: {
        progress_by_scope: {
          'openai|auth-a|gpt-4.1': {
            breaker: { current: '2', threshold: '3', state: 'closed' },
            deletion: { enabled: true, current: '1', threshold: '4', status: 'pending' },
          },
        },
        last_updated: '2026-04-27T00:00:00Z',
      },
    });

    const result = await errorEventsApi.insights({
      provider: 'openai',
      authId: 'auth-a',
      model: 'gpt-4.1',
      requestId: 'req-1',
      page: 2,
      pageSize: 5,
      summaryLimit: 20,
    });

    expect(mockedApiClient.get).toHaveBeenCalledWith('/error-events/insights', {
      params: {
        start: undefined,
        end: undefined,
        provider: 'openai',
        auth_id: 'auth-a',
        model: 'gpt-4.1',
        failure_stage: undefined,
        error_code: undefined,
        status_code: undefined,
        request_id: 'req-1',
        page: 2,
        page_size: 5,
        summary_limit: 20,
      },
    });
    expect(result.metrics.total).toBe(12);
    expect(result.metrics.scope_count).toBe(2);
    expect(result.metrics.circuit_countable_total).toBe(10);
    expect(result.scope_ranking[0].progress_scope_key).toBe('openai|auth-a|gpt-4.1');
    expect(result.summary.by_error_code[0].error_code).toBe('upstream_timeout');
    expect(result.summary.by_status_code[0].status_code).toBe(503);
    expect(result.meta.progress_by_scope['openai|auth-a|gpt-4.1']?.deletion?.threshold).toBe(4);
  });

  it('maps list params and normalizes payload', async () => {
    mockedApiClient.get.mockResolvedValueOnce({
      items: [
        {
          id: 'evt-1',
          provider: 'openai',
          auth_id: 'auth-a',
          model: 'gpt-4.1',
          normalized_model: 'gpt-4.1',
          progress_scope_key: 'openai|auth-a|gpt-4.1',
          request_id: 'req-1',
          status_code: '503',
          attempt_count: '2',
          circuit_countable: true,
          upstream_request_ids: ['upstream-1'],
        },
      ],
      meta: {
        progress_by_scope: {
          'openai|auth-a|gpt-4.1': {
            provider: 'openai',
            auth_id: 'auth-a',
            model: 'gpt-4.1',
            normalized_model: 'gpt-4.1',
            breaker: {
              current: '2',
              threshold: '3',
              state: 'closed',
            },
            deletion: {
              enabled: true,
              current: '1',
              threshold: '3',
              status: 'pending',
            },
          },
        },
      },
      total: '12',
      page: '2',
      page_size: '5',
    });

    const result = await errorEventsApi.list({
      provider: 'openai',
      authId: 'auth-a',
      model: 'gpt-4.1',
      page: 2,
      pageSize: 5,
    });

    expect(mockedApiClient.get).toHaveBeenCalledWith('/error-events', {
      params: {
        start: undefined,
        end: undefined,
        provider: 'openai',
        auth_id: 'auth-a',
        model: 'gpt-4.1',
        failure_stage: undefined,
        error_code: undefined,
        status_code: undefined,
        request_id: undefined,
        page: 2,
        page_size: 5,
      },
    });
    expect(result.total).toBe(12);
    expect(result.page).toBe(2);
    expect(result.page_size).toBe(5);
    expect(result.items[0].status_code).toBe(503);
    expect(result.items[0].attempt_count).toBe(2);
    expect(result.items[0].upstream_request_ids).toEqual(['upstream-1']);
    const typedResult = result as any;
    expect(typedResult.items[0].progress_scope_key).toBe('openai|auth-a|gpt-4.1');
    expect(typedResult.meta.progress_by_scope['openai|auth-a|gpt-4.1']?.breaker?.current).toBe(2);
    expect(typedResult.meta.progress_by_scope['openai|auth-a|gpt-4.1']?.deletion?.threshold).toBe(3);
  });

  it('maps summary params and normalizes payload', async () => {
    mockedApiClient.get.mockResolvedValueOnce({
      group_by: ['error_code'],
      meta: {
        progress_by_scope: {
          'openai|auth-a|gpt-4.1': {
            breaker: {
              current: '2',
              threshold: '3',
              state: 'closed',
            },
            deletion: {
              enabled: true,
              current: '1',
              threshold: '3',
              status: 'pending',
            },
          },
        },
      },
      items: [
        {
          auth_id: 'auth-a',
          normalized_model: 'gpt-4.1',
          progress_scope_key: 'openai|auth-a|gpt-4.1',
          error_code: 'upstream_timeout',
          total: '7',
          circuit_countable_total: '6',
          status_code: '503',
        },
      ],
    });

    const result = await errorEventsApi.summarize({
      provider: 'openai',
      authId: 'auth-a',
      groupBy: ['error_code'],
      limit: 10,
    });

    expect(mockedApiClient.get).toHaveBeenCalledWith('/error-events/summary', {
      params: {
        start: undefined,
        end: undefined,
        provider: 'openai',
        auth_id: 'auth-a',
        model: undefined,
        failure_stage: undefined,
        error_code: undefined,
        status_code: undefined,
        group_by: 'error_code',
        limit: 10,
      },
    });
    expect(result.group_by).toEqual(['error_code']);
    expect(result.items[0].total).toBe(7);
    expect(result.items[0].circuit_countable_total).toBe(6);
    expect(result.items[0].status_code).toBe(503);
    const typedResult = result as any;
    expect(typedResult.items[0].progress_scope_key).toBe('openai|auth-a|gpt-4.1');
    expect(typedResult.items[0].normalized_model).toBe('gpt-4.1');
    expect(typedResult.meta.progress_by_scope['openai|auth-a|gpt-4.1']?.deletion?.status).toBe(
      'pending'
    );
  });
});
