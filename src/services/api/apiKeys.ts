/**
 * API 密钥管理
 */

import { apiClient } from './client';

export interface ApiKeyScopeEntry {
  apiKey: string;
  allowedSuppliers: string[];
  allowedModels: string[];
}

export interface ApiKeyEntryOptions {
  suppliers: string[];
  models: string[];
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];

const normalizeEntry = (raw: unknown): ApiKeyScopeEntry | null => {
  if (raw === null || typeof raw !== 'object') {
    if (typeof raw === 'string' && raw.trim()) {
      return { apiKey: raw.trim(), allowedSuppliers: [], allowedModels: [] };
    }
    return null;
  }

  const record = raw as Record<string, unknown>;
  const apiKey = record['api-key'] ?? record.apiKey ?? record.key;
  const trimmedApiKey = String(apiKey ?? '').trim();
  if (!trimmedApiKey) return null;

  return {
    apiKey: trimmedApiKey,
    allowedSuppliers: asStringArray(
      record['allowed-suppliers'] ?? record.allowedSuppliers ?? record.allowed_suppliers
    ),
    allowedModels: asStringArray(
      record['allowed-models'] ?? record.allowedModels ?? record.allowed_models
    ),
  };
};

const encodeEntry = (entry: ApiKeyScopeEntry) => ({
  'api-key': entry.apiKey.trim(),
  'allowed-suppliers': asStringArray(entry.allowedSuppliers),
  'allowed-models': asStringArray(entry.allowedModels),
});

export const apiKeysApi = {
  async listEntries(): Promise<ApiKeyScopeEntry[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-key-entries');
    const rawEntries = data['api-key-entries'] ?? data.apiKeyEntries ?? data.items;
    if (!Array.isArray(rawEntries)) return [];
    return rawEntries.map((entry) => normalizeEntry(entry)).filter(Boolean) as ApiKeyScopeEntry[];
  },

  async getEntryOptions(): Promise<ApiKeyEntryOptions> {
    const data = await apiClient.get<Record<string, unknown>>('/api-key-entries/options');
    return {
      suppliers: asStringArray(data.suppliers),
      models: asStringArray(data.models),
    };
  },

  replaceEntries: (entries: ApiKeyScopeEntry[]) =>
    apiClient.put('/api-key-entries', entries.map((entry) => encodeEntry(entry))),

  updateEntry: (index: number, value: Partial<ApiKeyScopeEntry>) =>
    apiClient.patch('/api-key-entries', {
      index,
      value: {
        ...(value.apiKey !== undefined ? { 'api-key': String(value.apiKey ?? '') } : {}),
        ...(value.allowedSuppliers !== undefined
          ? { 'allowed-suppliers': asStringArray(value.allowedSuppliers) }
          : {}),
        ...(value.allowedModels !== undefined
          ? { 'allowed-models': asStringArray(value.allowedModels) }
          : {}),
      },
    }),

  deleteEntry: (index: number) => apiClient.delete(`/api-key-entries?index=${index}`),

  async list(): Promise<string[]> {
    const entries = await apiKeysApi.listEntries();
    return entries.map((entry) => entry.apiKey);
  },

  replace: (keys: string[]) =>
    apiKeysApi.replaceEntries(
      keys.map((key) => ({ apiKey: key, allowedSuppliers: [], allowedModels: [] }))
    ),

  update: (index: number, value: string) => apiKeysApi.updateEntry(index, { apiKey: value }),

  delete: (index: number) => apiKeysApi.deleteEntry(index),
};
