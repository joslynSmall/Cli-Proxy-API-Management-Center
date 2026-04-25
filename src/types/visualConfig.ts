export type PayloadParamValueType = 'string' | 'number' | 'boolean' | 'json';
export type PayloadParamValidationErrorCode =
  | 'payload_invalid_number'
  | 'payload_invalid_boolean'
  | 'payload_invalid_json';

export type VisualConfigFieldPath =
  | 'port'
  | 'logsMaxTotalSizeMb'
  | 'requestRetry'
  | 'maxRetryCredentials'
  | 'maxRetryInterval'
  | 'circuitBreakerAutoRemovalThreshold'
  | 'streaming.keepaliveSeconds'
  | 'streaming.bootstrapRetries'
  | 'streaming.nonstreamKeepaliveInterval';

export type VisualConfigValidationErrorCode = 'port_range' | 'non_negative_integer' | 'positive_integer';

export type VisualConfigValidationErrors = Partial<
  Record<VisualConfigFieldPath, VisualConfigValidationErrorCode>
>;

export type PayloadParamEntry = {
  id: string;
  path: string;
  valueType: PayloadParamValueType;
  value: string;
};

export type PayloadModelEntry = {
  id: string;
  name: string;
  protocol?: string;
};

export type PayloadRule = {
  id: string;
  models: PayloadModelEntry[];
  params: PayloadParamEntry[];
};

export type PayloadFilterRule = {
  id: string;
  models: PayloadModelEntry[];
  params: string[];
};

export interface StreamingConfig {
  keepaliveSeconds: string;
  bootstrapRetries: string;
  nonstreamKeepaliveInterval: string;
}

export type ReasoningIngressDefaultEntry = {
  id: string;
  format: string;
  policy: string;
  mode: string;
  value: string;
};

export type ReasoningDefaultModeOption = {
  mode: string;
  fieldPaths: string[];
  values: string[];
};

export type ReasoningIngressFormatOption = {
  format: string;
  appliesTo?: string[];
  policies: string[];
  modes: ReasoningDefaultModeOption[];
  availableModels?: string[];
};

export type CircuitBreakerProviderOverride = {
  id: string;
  index: number;
  label: string;
  failureThreshold: string;
  recoveryTimeout: string;
};

export type VisualConfigValues = {
  host: string;
  port: string;
  tlsEnable: boolean;
  tlsCert: string;
  tlsKey: string;
  rmAllowRemote: boolean;
  rmSecretKey: string;
  rmDisableControlPanel: boolean;
  rmPanelRepo: string;
  authDir: string;
  apiKeysText: string;
  debug: boolean;
  commercialMode: boolean;
  loggingToFile: boolean;
  logsMaxTotalSizeMb: string;
  usageStatisticsEnabled: boolean;
  proxyUrl: string;
  forceModelPrefix: boolean;
  requestRetry: string;
  maxRetryCredentials: string;
  maxRetryInterval: string;
  quotaSwitchProject: boolean;
  quotaSwitchPreviewModel: boolean;
  routingStrategy: 'round-robin' | 'fill-first';
  wsAuth: boolean;
  reasoningDefaultsByFormat: ReasoningIngressDefaultEntry[];
  payloadDefaultRules: PayloadRule[];
  payloadDefaultRawRules: PayloadRule[];
  payloadOverrideRules: PayloadRule[];
  payloadOverrideRawRules: PayloadRule[];
  payloadFilterRules: PayloadFilterRule[];
  circuitBreakerAutoRemovalEnabled: boolean;
  circuitBreakerAutoRemovalThreshold: string;
  codexCircuitBreakerOverrides: CircuitBreakerProviderOverride[];
  openaiCircuitBreakerOverrides: CircuitBreakerProviderOverride[];
  streaming: StreamingConfig;
};

export const makeClientId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

export const DEFAULT_VISUAL_VALUES: VisualConfigValues = {
  host: '',
  port: '',
  tlsEnable: false,
  tlsCert: '',
  tlsKey: '',
  rmAllowRemote: false,
  rmSecretKey: '',
  rmDisableControlPanel: false,
  rmPanelRepo: '',
  authDir: '',
  apiKeysText: '',
  debug: false,
  commercialMode: false,
  loggingToFile: false,
  logsMaxTotalSizeMb: '',
  usageStatisticsEnabled: false,
  proxyUrl: '',
  forceModelPrefix: false,
  requestRetry: '',
  maxRetryCredentials: '',
  maxRetryInterval: '',
  quotaSwitchProject: true,
  quotaSwitchPreviewModel: true,
  routingStrategy: 'round-robin',
  wsAuth: false,
  reasoningDefaultsByFormat: [],
  payloadDefaultRules: [],
  payloadDefaultRawRules: [],
  payloadOverrideRules: [],
  payloadOverrideRawRules: [],
  payloadFilterRules: [],
  circuitBreakerAutoRemovalEnabled: true,
  circuitBreakerAutoRemovalThreshold: '',
  codexCircuitBreakerOverrides: [],
  openaiCircuitBreakerOverrides: [],
  streaming: {
    keepaliveSeconds: '',
    bootstrapRetries: '',
    nonstreamKeepaliveInterval: '',
  },
};
