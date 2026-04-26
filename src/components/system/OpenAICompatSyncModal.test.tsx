import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '@/test/setup';
import { OpenAICompatSyncModal } from '@/components/system/OpenAICompatSyncModal';

describe('OpenAICompatSyncModal', () => {
  it('filters raw models and requires at least one selection before next step', async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();

    render(
      <OpenAICompatSyncModal
        open
        providerName="us-ci"
        rawModels={['kimi-k2.5', 'glm-5.1']}
        lookupLoading={false}
        saving={false}
        step="select"
        selectedModelNames={new Set()}
        aliasDrafts={{}}
        matchedModelNames={new Set()}
        onClose={vi.fn()}
        onBack={vi.fn()}
        onSearchChange={onSearchChange}
        onToggleModel={vi.fn()}
        onSelectVisible={vi.fn()}
        onClearSelection={vi.fn()}
        onSubmitSelection={vi.fn()}
        onAliasChange={vi.fn()}
        onConfirm={vi.fn()}
        search="glm"
        configuredModels={[]}
      />
    );

    await screen.findByRole('dialog');

    const searchInput = screen.getByLabelText('搜索模型');
    expect(searchInput).toHaveValue('glm');
    expect(screen.getByText('glm-5.1')).toBeInTheDocument();
    expect(screen.queryByText('kimi-k2.5')).not.toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, 'g');
    expect(onSearchChange).toHaveBeenCalled();

    expect(screen.getByRole('button', { name: '下一步：匹配 alias' })).toBeDisabled();
  });

  it('blocks confirm when any selected model alias is empty', async () => {
    render(
      <OpenAICompatSyncModal
        open
        providerName="us-ci"
        rawModels={['unknown-model']}
        lookupLoading={false}
        saving={false}
        step="alias"
        selectedModelNames={new Set(['unknown-model'])}
        aliasDrafts={{ 'unknown-model': '' }}
        matchedModelNames={new Set()}
        onClose={vi.fn()}
        onBack={vi.fn()}
        onSearchChange={vi.fn()}
        onToggleModel={vi.fn()}
        onSelectVisible={vi.fn()}
        onClearSelection={vi.fn()}
        onSubmitSelection={vi.fn()}
        onAliasChange={vi.fn()}
        onConfirm={vi.fn()}
        search=""
        configuredModels={[]}
      />
    );

    await screen.findByRole('dialog');

    expect(screen.getByRole('button', { name: '确认同步所选模型' })).toBeDisabled();
  });
});
