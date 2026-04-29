/**
 * 配置相关类型定义
 * 与基线 /config 返回结构保持一致（内部使用驼峰形式）
 */

import type { GeminiKeyConfig, ProviderKeyConfig, OpenAIProviderConfig } from './provider';
import type { AmpcodeConfig } from './ampcode';

export interface QuotaExceededConfig {
  switchProject?: boolean;
  switchPreviewModel?: boolean;
}

export interface ProviderRateLimitConfig {
  enabled?: boolean;
  scope?: 'credential' | 'provider' | 'provider-model' | string;
  rateLimit?: number;
  rateWindowSeconds?: number;
  maxStreamConcurrency?: number;
  reactiveBaseDelayMs?: number;
  reactiveMaxDelaySeconds?: number;
  reactiveJitterMs?: number;
  adaptiveEnabled?: boolean;
  adaptiveIncreaseOnSuccess?: boolean;
  adaptiveDecreaseFactor?: number;
  adaptiveMinRateLimit?: number;
  adaptivePersistDebounceSeconds?: number;
  overrides?: ProviderRateLimitOverride[];
}

export interface ProviderRateLimitOverride {
  provider?: string;
  authId?: string;
  model?: string;
  mode?: 'auto' | 'manual' | string;
  enabled?: boolean;
  scope?: 'credential' | 'provider' | 'provider-model' | string;
  rateLimit?: number;
  rateWindowSeconds?: number;
  maxStreamConcurrency?: number;
  reactiveBaseDelayMs?: number;
  reactiveMaxDelaySeconds?: number;
  reactiveJitterMs?: number;
}

export interface Config {
  debug?: boolean;
  proxyUrl?: string;
  requestRetry?: number;
  providerRateLimit?: ProviderRateLimitConfig;
  quotaExceeded?: QuotaExceededConfig;
  usageStatisticsEnabled?: boolean;
  requestLog?: boolean;
  loggingToFile?: boolean;
  logsMaxTotalSizeMb?: number;
  wsAuth?: boolean;
  forceModelPrefix?: boolean;
  routingStrategy?: string;
  apiKeyEntries?: ConfigApiKeyEntry[];
  ampcode?: AmpcodeConfig;
  geminiApiKeys?: GeminiKeyConfig[];
  codexApiKeys?: ProviderKeyConfig[];
  claudeApiKeys?: ProviderKeyConfig[];
  vertexApiKeys?: ProviderKeyConfig[];
  openaiCompatibility?: OpenAIProviderConfig[];
  oauthExcludedModels?: Record<string, string[]>;
  raw?: Record<string, unknown>;
}

export interface ConfigApiKeyEntry {
  apiKey: string;
  allowedSuppliers?: string[];
  allowedModels?: string[];
}

export type RawConfigSection =
  | 'debug'
  | 'proxy-url'
  | 'request-retry'
  | 'provider-rate-limit'
  | 'quota-exceeded'
  | 'usage-statistics-enabled'
  | 'request-log'
  | 'logging-to-file'
  | 'logs-max-total-size-mb'
  | 'ws-auth'
  | 'force-model-prefix'
  | 'routing/strategy'
  | 'api-key-entries'
  | 'ampcode'
  | 'gemini-api-key'
  | 'codex-api-key'
  | 'claude-api-key'
  | 'vertex-api-key'
  | 'openai-compatibility'
  | 'oauth-excluded-models';

export interface ConfigCache {
  data: Config;
  timestamp: number;
}
