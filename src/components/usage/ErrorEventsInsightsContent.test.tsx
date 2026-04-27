import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/test/setup';
import { ErrorEventsInsightsContent } from './ErrorEventsInsightsContent';
import { useErrorEventsData } from '@/hooks/useErrorEventsData';
import { useNotificationStore } from '@/stores';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/hooks/useErrorEventsData', () => ({
  useErrorEventsData: vi.fn(),
}));

vi.mock('@/services/api/logs', () => ({
  logsApi: {
    fetchRequestLogTextById: vi.fn(),
  },
}));

const mockedUseErrorEventsData = vi.mocked(useErrorEventsData);

describe('ErrorEventsInsightsContent', () => {
  const refresh = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    useNotificationStore.setState({
      showNotification: vi.fn(),
      showConfirmation: vi.fn(),
    });

    mockedUseErrorEventsData.mockReturnValue({
      items: [
        {
          id: 'evt-1',
          occurred_at: '2026-04-27T00:00:00Z',
          provider: 'openai',
          auth_id: 'auth-a',
          model: 'gpt-4.1',
          normalized_model: 'gpt-4.1',
          progress_scope_key: 'openai|auth-a|gpt-4.1',
          failure_stage: 'request_execution',
          error_code: 'upstream_timeout',
          error_message_masked: 'masked message',
          status_code: 503,
          circuit_countable: true,
          request_id: 'req-1',
          request_log_ref: 'log-1',
          attempt_count: 2,
          upstream_request_ids: ['upstream-1'],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      loading: false,
      error: '',
      summaryLoading: false,
      summaryError: '',
      summary: {
        byProvider: [{ provider: 'openai', total: 5 }],
        byAuth: [{ auth_id: 'auth-a', total: 5 }],
        byModel: [{ model: 'gpt-4.1', normalized_model: 'gpt-4.1', total: 5 }],
        byRiskScope: [
          {
            provider: 'openai',
            auth_id: 'auth-a',
            normalized_model: 'gpt-4.1',
            progress_scope_key: 'openai|auth-a|gpt-4.1',
            total: 5,
          },
        ],
        byErrorCode: [{ error_code: 'upstream_timeout', total: 5 }],
        byFailureStage: [{ failure_stage: 'request_execution', total: 5 }],
        byStatusCode: [{ status_code: 503, total: 5 }],
      },
      metrics: {
        total: 5,
        scopeCount: 1,
        circuitCountableTotal: 4,
      },
      filters: {
        start: '',
        end: '',
        provider: '',
        authId: '',
        model: '',
        failureStage: '',
        errorCode: '',
        statusCode: '',
        requestId: '',
      },
      effectiveFilters: {
        start: '',
        end: '',
        provider: '',
        authId: '',
        model: '',
        failureStage: '',
        errorCode: '',
        statusCode: '',
        requestId: '',
      },
      progressByScope: {
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
      lastRefreshedAt: new Date('2026-04-27T00:00:00Z'),
      setPage: vi.fn(),
      setFilter: vi.fn(),
      setFilters: vi.fn(),
      resetFilters: vi.fn(),
      refresh,
    } as any);
  });

  it('renders detail view with scope aggregation switch', () => {
    render(<ErrorEventsInsightsContent />);

    expect(screen.getByRole('tab', { name: '事件明细' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '作用域聚合' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('masked message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看日志' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '跳转熔断页' })).toBeInTheDocument();
    expect(screen.queryByText('高风险 auth + model')).not.toBeInTheDocument();
  });

  it('applies advanced filters only when clicking apply button', async () => {
    const user = userEvent.setup();
    render(<ErrorEventsInsightsContent />);
    const data = mockedUseErrorEventsData.mock.results[0]?.value;

    await user.click(screen.getByRole('button', { name: /筛选/ }));
    await user.type(screen.getByLabelText('请求 ID'), 'req-123');
    expect(data.setFilters).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(data.setFilters).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-123',
      })
    );
  });

  it('navigates to circuit breaker page from row action', async () => {
    const user = userEvent.setup();
    render(<ErrorEventsInsightsContent />);

    await user.click(screen.getByRole('button', { name: '跳转熔断页' }));

    expect(mockNavigate).toHaveBeenCalledWith('/circuit-breaker');
  });

  it('supports scope aggregation drilldown back to detail view', async () => {
    const user = userEvent.setup();
    render(<ErrorEventsInsightsContent />);
    const data = mockedUseErrorEventsData.mock.results[0]?.value;

    await user.click(screen.getByRole('tab', { name: '作用域聚合' }));

    expect(screen.getByRole('tab', { name: '作用域聚合' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('button', { name: '查看明细' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看明细' }));

    expect(data.setFilters).toHaveBeenCalledWith({
      provider: 'openai',
      authId: 'auth-a',
      model: 'gpt-4.1',
    });
    expect(screen.getByRole('tab', { name: '事件明细' })).toHaveAttribute('aria-selected', 'true');
  });
});
