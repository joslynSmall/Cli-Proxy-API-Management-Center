import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/test/setup';
import { CircuitBreakerPage } from './CircuitBreakerPage';
import { useAuthStore, useNotificationStore } from '@/stores';
import type { CircuitBreakerDeletionItem } from '@/services/api/circuitBreaker';
import { circuitBreakerApi } from '@/services/api/circuitBreaker';

vi.mock('@/components/usage', () => ({
  ErrorEventsInsightsContent: ({
    fixedFilters,
  }: {
    fixedFilters?: { provider?: string; authId?: string; model?: string };
  }) => (
    <div data-testid="error-events-insights">
      {fixedFilters?.provider || ''}|{fixedFilters?.authId || ''}|{fixedFilters?.model || ''}
    </div>
  ),
}));

vi.mock('@/services/api/circuitBreaker', () => ({
  circuitBreakerApi: {
    list: vi.fn(),
    reset: vi.fn(),
    open: vi.fn(),
    listDeletions: vi.fn(),
    executeDeletion: vi.fn(),
    dismissDeletion: vi.fn(),
  },
}));

const mockedCircuitBreakerApi = vi.mocked(circuitBreakerApi);

const buildBreakerMap = () => ({
  'auth-a': {
    'gpt-4.1': {
      provider: 'openai',
      errorInsightFilters: {
        provider: 'openai',
        authId: 'auth-a-insight',
        model: 'gpt-4.1-insight',
      },
      state: 'open' as const,
      failureCount: 3,
      lastFailure: '2026-04-25T10:00:00Z',
      recoveryAt: '2026-04-25T10:30:00Z',
    },
  },
  'auth-b': {
    'claude-3.7-sonnet': {
      provider: 'anthropic',
      state: 'half-open' as const,
      failureCount: 1,
      lastFailure: '2026-04-25T11:00:00Z',
      recoveryAt: '',
    },
  },
});

const buildBreakerMapWithMissingFields = () => ({
  'auth-a': {
    'gpt-4.1': {
      provider: '',
      state: 'open' as const,
      failureCount: 3,
      lastFailure: '2026-04-25T10:00:00Z',
      recoveryAt: '2026-04-25T10:30:00Z',
    },
  },
  'auth-b': {
    '': {
      provider: 'anthropic',
      state: 'half-open' as const,
      failureCount: 1,
      lastFailure: '2026-04-25T11:00:00Z',
      recoveryAt: '',
    },
  },
});

const buildDeletionPage = (items: CircuitBreakerDeletionItem[]) => ({
  items,
  total: items.length,
  page: 1,
  page_size: 20,
});

describe('CircuitBreakerPage', () => {
  const showNotification = vi.fn();
  const showConfirmation = vi.fn((options: { onConfirm: () => void | Promise<void> }) => {
    void options.onConfirm();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      configurable: true,
    });

    useAuthStore.setState({
      connectionStatus: 'connected',
      connectionError: null,
    });
    useNotificationStore.setState({
      showNotification,
      showConfirmation,
    });

    mockedCircuitBreakerApi.list.mockResolvedValue(buildBreakerMap());
    mockedCircuitBreakerApi.reset.mockResolvedValue(undefined);
    mockedCircuitBreakerApi.open.mockResolvedValue(undefined);
    mockedCircuitBreakerApi.executeDeletion.mockResolvedValue(undefined);
    mockedCircuitBreakerApi.dismissDeletion.mockResolvedValue(undefined);
    mockedCircuitBreakerApi.listDeletions.mockResolvedValue(
      buildDeletionPage([
        {
          id: 'del-1',
          provider: 'nvidia',
          auth_id: 'auth-a',
          model: 'meta/llama-3.1-70b-instruct',
          normalized_model: 'llama-3.1-70b-instruct',
          status: 'pending',
          open_cycles: 3,
          failure_count: 7,
          consecutive_failures: 4,
          opened_at: '2026-04-25T10:05:00Z',
          updated_at: '2026-04-25T10:06:00Z',
          action_at: '',
          action_error: '',
        },
      ])
    );
  });

  it('renders breaker tab with open filter by default and shows deletion page after manual switch', async () => {
    const user = userEvent.setup();

    render(<CircuitBreakerPage />);

    expect(await screen.findByRole('tab', { name: '熔断状态' })).toHaveAttribute('aria-selected', 'true');
    expect((await screen.findAllByText('gpt-4.1')).length).toBeGreaterThan(0);
    expect(screen.queryByText('claude-3.7-sonnet')).not.toBeInTheDocument();
    expect(screen.getAllByText('openai').length).toBeGreaterThan(0);
    expect(screen.queryByText('anthropic')).not.toBeInTheDocument();
    expect(screen.queryByText('meta/llama-3.1-70b-instruct')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '待删除候选' }));

    expect(await screen.findByText('nvidia')).toBeInTheDocument();
    expect(screen.getByText('meta/llama-3.1-70b-instruct')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockedCircuitBreakerApi.list).toHaveBeenCalledTimes(1);
      expect(mockedCircuitBreakerApi.listDeletions).toHaveBeenCalledWith({
        status: 'pending',
        page: 1,
        pageSize: 20,
      });
    });
  });

  it('switches group-by from model to provider', async () => {
    const user = userEvent.setup();

    render(<CircuitBreakerPage />);

    expect((await screen.findAllByText('gpt-4.1')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '全部' }));
    await user.click(screen.getByRole('button', { name: '按提供商' }));
    expect((await screen.findAllByText('openai')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('anthropic').length).toBeGreaterThan(0);
  });

  it('opens error insights modal from breaker row', async () => {
    const user = userEvent.setup();

    render(<CircuitBreakerPage />);

    expect((await screen.findAllByText('gpt-4.1')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '错误洞察' }));

    expect(await screen.findByText('错误洞察 · openai / auth-a-insight / gpt-4.1-insight')).toBeInTheDocument();
    expect(screen.getByTestId('error-events-insights')).toHaveTextContent(
      'openai|auth-a-insight|gpt-4.1-insight'
    );
  });

  it('falls back to breaker row fields when error insight filters are missing', async () => {
    const user = userEvent.setup();

    mockedCircuitBreakerApi.list.mockResolvedValueOnce({
      'auth-a': {
        'gpt-4.1': {
          provider: 'openai',
          state: 'open' as const,
          failureCount: 3,
          lastFailure: '2026-04-25T10:00:00Z',
          recoveryAt: '2026-04-25T10:30:00Z',
        },
      },
    });

    render(<CircuitBreakerPage />);

    expect((await screen.findAllByText('gpt-4.1')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '错误洞察' }));

    expect(await screen.findByText('错误洞察 · openai / auth-a / gpt-4.1')).toBeInTheDocument();
    expect(screen.getByTestId('error-events-insights')).toHaveTextContent('openai|auth-a|gpt-4.1');
  });

  it('shows unknown fallback labels for missing provider/model', async () => {
    mockedCircuitBreakerApi.list.mockResolvedValueOnce(buildBreakerMapWithMissingFields());

    render(<CircuitBreakerPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '全部' }));
    expect(await screen.findByText('未知模型')).toBeInTheDocument();
    expect(screen.getAllByText('未知提供商').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '按提供商' }));
    expect((await screen.findAllByText('未知提供商')).length).toBeGreaterThan(0);
  });

  it('switches deletion status filter independently and keeps history rows read-only', async () => {
    const user = userEvent.setup();

    mockedCircuitBreakerApi.listDeletions
      .mockResolvedValueOnce(
        buildDeletionPage([
          {
            id: 'del-1',
            provider: 'nvidia',
            auth_id: 'auth-a',
            model: 'meta/llama-3.1-70b-instruct',
            normalized_model: 'llama-3.1-70b-instruct',
            status: 'pending',
            open_cycles: 3,
            failure_count: 7,
            consecutive_failures: 4,
            opened_at: '2026-04-25T10:05:00Z',
            updated_at: '2026-04-25T10:06:00Z',
            action_at: '',
            action_error: '',
          },
        ])
      )
      .mockResolvedValueOnce(
        buildDeletionPage([
          {
            id: 'del-2',
            provider: 'openai',
            auth_id: 'auth-b',
            model: 'gpt-4.1',
            normalized_model: 'gpt-4.1',
            status: 'deleted',
            open_cycles: 4,
            failure_count: 9,
            consecutive_failures: 5,
            opened_at: '2026-04-25T09:30:00Z',
            updated_at: '2026-04-25T09:36:00Z',
            action_at: '2026-04-25T09:36:00Z',
            action_error: '',
          },
        ])
      );

    render(<CircuitBreakerPage />);

    await user.click(await screen.findByRole('tab', { name: '待删除候选' }));
    await screen.findByText('meta/llama-3.1-70b-instruct');
    await user.click(screen.getByRole('button', { name: '已删除' }));

    const historyAuth = await screen.findByText('auth-b');
    const historyRow = historyAuth.closest('tr');
    expect(historyRow).not.toBeNull();
    if (!historyRow) throw new Error('missing history row');

    await waitFor(() => {
      expect(mockedCircuitBreakerApi.listDeletions).toHaveBeenLastCalledWith({
        status: 'deleted',
        page: 1,
        pageSize: 20,
      });
    });
    expect(within(historyRow).queryByRole('button', { name: '执行删除' })).not.toBeInTheDocument();
    expect(within(historyRow).queryByRole('button', { name: '忽略' })).not.toBeInTheDocument();
  });

  it('executes deletion for pending candidates and reloads the deletion region', async () => {
    const user = userEvent.setup();

    mockedCircuitBreakerApi.listDeletions
      .mockResolvedValueOnce(
        buildDeletionPage([
          {
            id: 'del-1',
            provider: 'nvidia',
            auth_id: 'auth-a',
            model: 'meta/llama-3.1-70b-instruct',
            normalized_model: 'llama-3.1-70b-instruct',
            status: 'pending',
            open_cycles: 3,
            failure_count: 7,
            consecutive_failures: 4,
            opened_at: '2026-04-25T10:05:00Z',
            updated_at: '2026-04-25T10:06:00Z',
            action_at: '',
            action_error: '',
          },
        ])
      )
      .mockResolvedValueOnce(
        buildDeletionPage([
          {
            id: 'del-1',
            provider: 'nvidia',
            auth_id: 'auth-a',
            model: 'meta/llama-3.1-70b-instruct',
            normalized_model: 'llama-3.1-70b-instruct',
            status: 'deleted',
            open_cycles: 3,
            failure_count: 7,
            consecutive_failures: 4,
            opened_at: '2026-04-25T10:05:00Z',
            updated_at: '2026-04-25T10:06:00Z',
            action_at: '2026-04-25T10:08:00Z',
            action_error: '',
          },
        ])
      );

    render(<CircuitBreakerPage />);

    await user.click(await screen.findByRole('tab', { name: '待删除候选' }));
    const executeButton = await screen.findByRole('button', { name: '执行删除' });
    await user.click(executeButton);

    await waitFor(() => {
      expect(mockedCircuitBreakerApi.executeDeletion).toHaveBeenCalledWith('del-1');
    });
    await waitFor(() => {
      expect(mockedCircuitBreakerApi.listDeletions).toHaveBeenCalledTimes(2);
    });
    expect(showNotification).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('dismisses pending candidates and reloads the deletion region', async () => {
    const user = userEvent.setup();

    mockedCircuitBreakerApi.listDeletions
      .mockResolvedValueOnce(
        buildDeletionPage([
          {
            id: 'del-1',
            provider: 'nvidia',
            auth_id: 'auth-a',
            model: 'meta/llama-3.1-70b-instruct',
            normalized_model: 'llama-3.1-70b-instruct',
            status: 'pending',
            open_cycles: 3,
            failure_count: 7,
            consecutive_failures: 4,
            opened_at: '2026-04-25T10:05:00Z',
            updated_at: '2026-04-25T10:06:00Z',
            action_at: '',
            action_error: '',
          },
        ])
      )
      .mockResolvedValueOnce(
        buildDeletionPage([
          {
            id: 'del-1',
            provider: 'nvidia',
            auth_id: 'auth-a',
            model: 'meta/llama-3.1-70b-instruct',
            normalized_model: 'llama-3.1-70b-instruct',
            status: 'dismissed',
            open_cycles: 3,
            failure_count: 7,
            consecutive_failures: 4,
            opened_at: '2026-04-25T10:05:00Z',
            updated_at: '2026-04-25T10:06:00Z',
            action_at: '2026-04-25T10:08:00Z',
            action_error: '',
          },
        ])
      );

    render(<CircuitBreakerPage />);

    await user.click(await screen.findByRole('tab', { name: '待删除候选' }));
    const dismissButton = await screen.findByRole('button', { name: '忽略' });
    await user.click(dismissButton);

    await waitFor(() => {
      expect(mockedCircuitBreakerApi.dismissDeletion).toHaveBeenCalledWith('del-1');
    });
    await waitFor(() => {
      expect(mockedCircuitBreakerApi.listDeletions).toHaveBeenCalledTimes(2);
    });
    expect(showNotification).toHaveBeenCalledWith(expect.any(String), 'success');
  });
});
