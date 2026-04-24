import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import styles from './OpenAICompatSyncModal.module.scss';

export type SyncStep = 'select' | 'alias';

interface OpenAICompatSyncModalProps {
  open: boolean;
  providerName: string;
  rawModels: string[];
  selectedModelNames: Set<string>;
  matchedModelNames: Set<string>;
  aliasDrafts: Record<string, string>;
  search: string;
  step: SyncStep;
  lookupLoading: boolean;
  saving: boolean;
  onClose: () => void;
  onBack: () => void;
  onSearchChange: (value: string) => void;
  onToggleModel: (name: string) => void;
  onSelectVisible: () => void;
  onClearSelection: () => void;
  onSubmitSelection: () => void;
  onAliasChange: (name: string, value: string) => void;
  onConfirm: () => void;
}

export function OpenAICompatSyncModal(props: OpenAICompatSyncModalProps) {
  const { t } = useTranslation();

  const filteredModels = useMemo(() => {
    const keyword = props.search.trim().toLowerCase();
    if (!keyword) return props.rawModels;
    return props.rawModels.filter((name) => {
      const alias = (props.aliasDrafts[name] ?? '').toLowerCase();
      return name.toLowerCase().includes(keyword) || alias.includes(keyword);
    });
  }, [props.aliasDrafts, props.rawModels, props.search]);

  const selectedNames = useMemo(
    () => Array.from(props.selectedModelNames).sort((a, b) => a.localeCompare(b)),
    [props.selectedModelNames]
  );

  const canGoNext = props.selectedModelNames.size > 0 && !props.lookupLoading;
  const canConfirm =
    selectedNames.length > 0 &&
    selectedNames.every((name) => (props.aliasDrafts[name] ?? '').trim().length > 0);

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={
        props.step === 'select'
          ? t('system_info.sync_models_modal_title_select', { provider: props.providerName })
          : t('system_info.sync_models_modal_title_alias', { provider: props.providerName })
      }
      width={760}
      footer={
        props.step === 'select' ? (
          <>
            <Button variant="secondary" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={props.onSubmitSelection} disabled={!canGoNext} loading={props.lookupLoading}>
              {t('system_info.sync_models_next')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={props.onBack} disabled={props.saving}>
              {t('common.back')}
            </Button>
            <Button onClick={props.onConfirm} disabled={!canConfirm || props.saving} loading={props.saving}>
              {t('system_info.sync_models_confirm')}
            </Button>
          </>
        )
      }
    >
      {props.step === 'select' ? (
        <div className={styles.selectStep}>
          <Input
            label={t('system_info.sync_models_search_label')}
            value={props.search}
            onChange={(event) => props.onSearchChange(event.currentTarget.value)}
            placeholder={t('system_info.sync_models_search_placeholder')}
          />

          <div className={styles.toolbar}>
            <div className={styles.toolbarActions}>
              <Button size="sm" variant="secondary" onClick={props.onSelectVisible}>
                {t('system_info.sync_models_select_visible')}
              </Button>
              <Button size="sm" variant="ghost" onClick={props.onClearSelection}>
                {t('system_info.sync_models_clear_selection')}
              </Button>
            </div>
            <span className={styles.count}>
              {t('system_info.sync_models_selected_count', {
                count: props.selectedModelNames.size,
              })}
            </span>
          </div>

          <div className={styles.list}>
            {filteredModels.map((name) => (
              <SelectionCheckbox
                key={name}
                checked={props.selectedModelNames.has(name)}
                onChange={() => props.onToggleModel(name)}
                ariaLabel={name}
                className={styles.row}
                label={<div className={styles.modelName}>{name}</div>}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.aliasList}>
          {selectedNames.map((name) => {
            const matched = props.matchedModelNames.has(name);
            return (
              <div key={name} className={styles.aliasRow}>
                <div className={styles.aliasMeta}>
                  <div className={styles.modelName}>{name}</div>
                  <div className={matched ? styles.matchedBadge : styles.unmatchedBadge}>
                    {matched
                      ? t('system_info.sync_models_alias_matched')
                      : t('system_info.sync_models_alias_manual')}
                  </div>
                </div>
                <Input
                  value={props.aliasDrafts[name] ?? ''}
                  onChange={(event) => props.onAliasChange(name, event.currentTarget.value)}
                  placeholder={t('system_info.sync_models_alias_placeholder')}
                />
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
