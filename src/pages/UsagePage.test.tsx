import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '@/test/setup';
import { UsagePage } from './UsagePage';

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(() => false),
}));

vi.mock('@/hooks/useHeaderRefresh', () => ({
  useHeaderRefresh: vi.fn(),
}));

vi.mock('@/components/usage', () => ({
  StatCards: () => <div data-testid="stat-cards" />,
  UsageChart: () => <div data-testid="usage-chart" />,
  ChartLineSelector: () => <div data-testid="chart-line-selector" />,
  ApiDetailsCard: () => <div data-testid="api-details-card" />,
  ModelStatsCard: () => <div data-testid="model-stats-card" />,
  PriceSettingsCard: () => <div data-testid="price-settings-card" />,
  CredentialStatsCard: () => <div data-testid="credential-stats-card" />,
  RequestEventsDetailsCard: () => <div data-testid="request-events-panel">request-events-panel</div>,
  TokenBreakdownChart: () => <div data-testid="token-breakdown-chart" />,
  CostTrendChart: () => <div data-testid="cost-trend-chart" />,
  ServiceHealthCard: () => <div data-testid="service-health-card" />,
  ErrorEventsInsightsContent: () => (
    <div data-testid="error-events-panel">error-events-panel</div>
  ),
  useUsageData: () => ({
    usage: null,
    usageDetails: [],
    loading: false,
    error: '',
    lastRefreshedAt: new Date('2026-04-27T00:00:00Z'),
    modelPrices: {},
    setModelPrices: vi.fn(),
    loadUsage: vi.fn(async () => {}),
    handleExport: vi.fn(),
    handleImport: vi.fn(),
    handleImportChange: vi.fn(),
    importInputRef: { current: null },
    exporting: false,
    importing: false,
  }),
  useSparklines: () => ({
    requestsSparkline: [],
    tokensSparkline: [],
    rpmSparkline: [],
    tpmSparkline: [],
    costSparkline: [],
  }),
  useChartData: () => ({
    requestsPeriod: 'hour',
    setRequestsPeriod: vi.fn(),
    tokensPeriod: 'hour',
    setTokensPeriod: vi.fn(),
    requestsChartData: null,
    tokensChartData: null,
    requestsChartOptions: {},
    tokensChartOptions: {},
  }),
}));

describe('UsagePage', () => {
  it('renders request events and error insights inside one tab region', async () => {
    const user = userEvent.setup();

    render(<UsagePage />);

    const requestEventsTab = screen.getByRole('tab', { name: '请求事件明细' });
    const errorEventsTab = screen.getByRole('tab', { name: '错误事件洞察' });

    expect(requestEventsTab).toHaveAttribute('aria-selected', 'true');
    expect(errorEventsTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('request-events-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('error-events-panel')).not.toBeInTheDocument();

    await user.click(errorEventsTab);

    expect(requestEventsTab).toHaveAttribute('aria-selected', 'false');
    expect(errorEventsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('request-events-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('error-events-panel')).toBeInTheDocument();
  });
});
