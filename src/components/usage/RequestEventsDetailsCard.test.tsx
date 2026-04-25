import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/test/setup';
import { RequestEventsDetailsCard } from './RequestEventsDetailsCard';
import { useNotificationStore } from '@/stores';
import { authFilesApi } from '@/services/api/authFiles';
import { usageApi } from '@/services/api/usage';
import type { UsageDetail } from '@/utils/usage';

vi.mock('@/services/api/authFiles', () => ({
  authFilesApi: {
    list: vi.fn(),
  },
}));

vi.mock('@/services/api/logs', () => ({
  logsApi: {
    fetchRequestLogTextById: vi.fn(),
  },
}));

vi.mock('@/services/api/usage', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/usage')>(
    '@/services/api/usage'
  );
  return {
    ...actual,
    usageApi: {
      ...actual.usageApi,
      listRequestEvents: vi.fn(),
      openRequestEventsStream: vi.fn(),
    },
  };
});

const mockedAuthFilesApi = vi.mocked(authFilesApi);
const mockedUsageApi = vi.mocked(usageApi);

const buildUsageDetail = (overrides: Partial<UsageDetail> = {}): UsageDetail => ({
  timestamp: '2026-04-25T10:00:00Z',
  source: 'openai-main',
  auth_index: 'auth-a',
  request_id: 'req-initial',
  request_log_ref: 'log-initial',
  attempt_count: 1,
  upstream_request_ids: ['upstream-initial'],
  tokens: {
    input_tokens: 100,
    output_tokens: 50,
    reasoning_tokens: 0,
    cached_tokens: 0,
    total_tokens: 150,
  },
  failed: false,
  __modelName: 'gpt-4.1',
  __timestampMs: Date.parse('2026-04-25T10:00:00Z'),
  ...overrides,
});

const buildUsageResponse = (detail: UsageDetail) => ({
  items: [
    {
      event_id: 11,
      timestamp: detail.timestamp,
      model: detail.__modelName,
      source: detail.source,
      auth_index: String(detail.auth_index ?? ''),
      request_id: detail.request_id,
      request_log_ref: detail.request_log_ref,
      attempt_count: detail.attempt_count,
      upstream_request_ids: detail.upstream_request_ids,
      tokens: detail.tokens,
      failed: detail.failed,
      failure_stage: detail.failure_stage,
      error_code: detail.error_code,
      error_message: detail.error_message,
      status_code: detail.status_code,
    },
  ],
  latest_event_id: 11,
});

describe('RequestEventsDetailsCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockedAuthFilesApi.list.mockResolvedValue({ files: [] });
    useNotificationStore.setState({
      showNotification: vi.fn(),
      showConfirmation: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads request-event snapshot and consumes stream updates when auto refresh is enabled', async () => {
    mockedUsageApi.listRequestEvents.mockResolvedValue(
      buildUsageResponse(
        buildUsageDetail({
          timestamp: '2026-04-25T10:05:00Z',
          request_id: 'req-refreshed',
          request_log_ref: 'log-refreshed',
          upstream_request_ids: ['upstream-refreshed'],
          __modelName: 'claude-3.7-sonnet',
          __timestampMs: Date.parse('2026-04-25T10:05:00Z'),
        })
      )
    );
    mockedUsageApi.openRequestEventsStream.mockImplementation(async ({ onEvent }) => {
      onEvent({
        event_id: 12,
        timestamp: '2026-04-25T10:06:00Z',
        model: 'gemini-2.5-pro',
        source: 'gemini-main',
        auth_index: 'auth-b',
        request_id: 'req-stream',
        request_log_ref: 'log-stream',
        attempt_count: 1,
        upstream_request_ids: ['upstream-stream'],
        tokens: {
          input_tokens: 10,
          output_tokens: 20,
          reasoning_tokens: 0,
          cached_tokens: 0,
          total_tokens: 30,
        },
        failed: false,
      });
    });

    render(
      <RequestEventsDetailsCard
        usageDetails={[buildUsageDetail()]}
        loading={false}
        geminiKeys={[]}
        claudeConfigs={[]}
        codexConfigs={[]}
        vertexConfigs={[]}
        openaiProviders={[]}
        autoRefreshEnabled
        autoRefreshInterval="5000"
        autoRefreshIntervalOptions={[
          { value: '5000', label: '每 5 秒' },
          { value: '10000', label: '每 10 秒' },
        ]}
        onAutoRefreshChange={vi.fn()}
        onAutoRefreshIntervalChange={vi.fn()}
      />
    );

    expect(screen.getByText('gpt-4.1')).toBeInTheDocument();

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedUsageApi.listRequestEvents).toHaveBeenCalledTimes(1);
    expect(mockedUsageApi.openRequestEventsStream).toHaveBeenCalledTimes(1);
    expect(mockedUsageApi.openRequestEventsStream).toHaveBeenCalledWith(
      expect.objectContaining({ sinceId: 11 })
    );
    expect(screen.getByText('claude-3.7-sonnet')).toBeInTheDocument();
    expect(screen.getByText('gemini-2.5-pro')).toBeInTheDocument();
  });

  it('does not start request-event sync when auto refresh is disabled', async () => {
    render(
      <RequestEventsDetailsCard
        usageDetails={[buildUsageDetail()]}
        loading={false}
        geminiKeys={[]}
        claudeConfigs={[]}
        codexConfigs={[]}
        vertexConfigs={[]}
        openaiProviders={[]}
        autoRefreshEnabled={false}
        autoRefreshInterval="5000"
        autoRefreshIntervalOptions={[{ value: '5000', label: '每 5 秒' }]}
        onAutoRefreshChange={vi.fn()}
        onAutoRefreshIntervalChange={vi.fn()}
      />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(mockedUsageApi.listRequestEvents).not.toHaveBeenCalled();
    expect(mockedUsageApi.openRequestEventsStream).not.toHaveBeenCalled();
  });
});
