import { apiClient } from './client';
import type {
  ReasoningDefaultModeOption,
  ReasoningIngressFormatOption,
} from '@/types/visualConfig';

type RawModeOption = {
  mode?: unknown;
  'field-paths'?: unknown;
  fieldPaths?: unknown;
  values?: unknown;
};

type RawFormatOption = {
  format?: unknown;
  'applies-to'?: unknown;
  appliesTo?: unknown;
  policies?: unknown;
  modes?: unknown;
  'available-models'?: unknown;
  availableModels?: unknown;
};

function normalizeModeOption(raw: RawModeOption): ReasoningDefaultModeOption | null {
  const mode = typeof raw.mode === 'string' ? raw.mode.trim() : '';
  if (!mode) return null;

  const fieldPathsSource = Array.isArray(raw['field-paths'])
    ? raw['field-paths']
    : Array.isArray(raw.fieldPaths)
      ? raw.fieldPaths
      : [];
  const valuesSource = Array.isArray(raw.values) ? raw.values : [];

  const fieldPaths = fieldPathsSource
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  const values = valuesSource
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return {
    mode,
    fieldPaths,
    values,
  };
}

function normalizeFormatOption(raw: RawFormatOption): ReasoningIngressFormatOption | null {
  const format = typeof raw.format === 'string' ? raw.format.trim() : '';
  if (!format) return null;

  const modesSource = Array.isArray(raw.modes) ? raw.modes : [];
  const modes = modesSource
    .map((item) => normalizeModeOption((item as RawModeOption) ?? {}))
    .filter((item): item is ReasoningDefaultModeOption => item !== null);
  if (modes.length === 0) return null;

  const appliesToSource = Array.isArray(raw['applies-to'])
    ? raw['applies-to']
    : Array.isArray(raw.appliesTo)
      ? raw.appliesTo
      : [];
  const policiesSource = Array.isArray(raw.policies) ? raw.policies : [];
  const availableModelsSource = Array.isArray(raw['available-models'])
    ? raw['available-models']
    : Array.isArray(raw.availableModels)
      ? raw.availableModels
      : [];

  const policies = policiesSource
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  if (policies.length === 0) return null;

  return {
    format,
    appliesTo: appliesToSource
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean),
    policies,
    modes,
    availableModels: availableModelsSource
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean),
  };
}

export type ReasoningDefaultsByFormat = Record<
  string,
  { policy: string; mode: string; value: string }
>;

export const reasoningDefaultsApi = {
  async getOptions(): Promise<ReasoningIngressFormatOption[]> {
    const data = await apiClient.get<{ formats?: unknown }>('/reasoning-ingress-options');
    const formatsSource = Array.isArray(data?.formats) ? data.formats : [];
    return formatsSource
      .map((item) => normalizeFormatOption((item as RawFormatOption) ?? {}))
      .filter((item): item is ReasoningIngressFormatOption => item !== null);
  },

  async getDefaults(): Promise<ReasoningDefaultsByFormat> {
    const data = await apiClient.get<Record<string, unknown>>(
      '/default-reasoning-on-ingress-by-format'
    );
    const raw =
      (data?.['default-reasoning-on-ingress-by-format'] as Record<string, unknown> | undefined) ??
      {};
    const out: ReasoningDefaultsByFormat = {};
    for (const [format, entry] of Object.entries(raw)) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const policy = typeof record.policy === 'string' ? record.policy.trim() : '';
      const mode = typeof record.mode === 'string' ? record.mode.trim() : '';
      const value = typeof record.value === 'string' ? record.value.trim() : '';
      if (!format.trim() || !policy || !mode || !value) continue;
      out[format.trim()] = { policy, mode, value };
    }
    return out;
  },

  updateDefaults: (value: ReasoningDefaultsByFormat) =>
    apiClient.put('/default-reasoning-on-ingress-by-format', { value }),
};

