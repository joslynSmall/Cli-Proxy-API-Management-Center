import {
  useLayoutEffect,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { DEFAULT_API_PORT } from '@/utils/constants';
import {
  IconCode,
  IconDiamond,
  IconKey,
  IconSatellite,
  IconSettings,
  IconShield,
  IconTimer,
  IconTrendingUp,
  type IconProps,
} from '@/components/ui/icons';
import { ConfigSection } from '@/components/config/ConfigSection';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { VisualCircuitBreakerValidationErrors } from '@/hooks/useVisualConfig';
import type {
  PayloadFilterRule,
  PayloadParamValidationErrorCode,
  PayloadRule,
  ProviderRateLimitOverrideEntry,
  ReasoningIngressFormatOption,
  VisualConfigFieldPath,
  VisualConfigValidationErrorCode,
  VisualConfigValidationErrors,
  VisualConfigValues,
} from '@/types/visualConfig';
import { makeClientId } from '@/types/visualConfig';
import { configApi, reasoningDefaultsApi } from '@/services/api';
import {
  ApiKeysCardEditor,
  PayloadFilterRulesEditor,
  PayloadRulesEditor,
} from './VisualConfigEditorBlocks';
import styles from './VisualConfigEditor.module.scss';

type VisualSectionId =
  | 'server'
  | 'tls'
  | 'remote'
  | 'auth'
  | 'system'
  | 'network'
  | 'quota'
  | 'circuitBreaker'
  | 'streaming'
  | 'payload';

type VisualSection = {
  id: VisualSectionId;
  title: string;
  description: string;
  icon: ComponentType<IconProps>;
  errorCount: number;
};

interface VisualConfigEditorProps {
  values: VisualConfigValues;
  validationErrors?: VisualConfigValidationErrors;
  hasPayloadValidationErrors?: boolean;
  circuitBreakerValidationErrors?: VisualCircuitBreakerValidationErrors;
  hasCircuitBreakerValidationErrors?: boolean;
  disabled?: boolean;
  onChange: (values: Partial<VisualConfigValues>) => void;
}

type ProviderRateLimitOptions = {
  providers: string[];
  models: string[];
};

function getValidationMessage(
  t: ReturnType<typeof useTranslation>['t'],
  errorCode?: VisualConfigValidationErrorCode | PayloadParamValidationErrorCode
) {
  if (!errorCode) return undefined;
  return t(`config_management.visual.validation.${errorCode}`);
}

type ToggleRowProps = {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
};

function ToggleRow({ title, description, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleCopy}>
        <div className={styles.toggleTitle}>{title}</div>
        {description ? <div className={styles.toggleDescription}>{description}</div> : null}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={title} />
    </div>
  );
}

function SectionGrid({ children }: { children: ReactNode }) {
  return <div className={styles.sectionGrid}>{children}</div>;
}

function SectionStack({ children }: { children: ReactNode }) {
  return <div className={styles.sectionStack}>{children}</div>;
}

function Divider() {
  return <div className={styles.divider} />;
}

function SectionSubsection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.subsection}>
      <div className={styles.subsectionHeader}>
        <h3 className={styles.subsectionTitle}>{title}</h3>
        {description ? <p className={styles.subsectionDescription}>{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

function FieldShell({
  label,
  labelId,
  htmlFor,
  hint,
  hintId,
  error,
  errorId,
  children,
}: {
  label: string;
  labelId?: string;
  htmlFor?: string;
  hint?: string;
  hintId?: string;
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.fieldShell}>
      <label id={labelId} htmlFor={htmlFor} className={styles.fieldLabel}>
        {label}
      </label>
      {children}
      {error ? (
        <div id={errorId} className="error-box">
          {error}
        </div>
      ) : null}
      {hint ? (
        <div id={hintId} className={styles.fieldHint}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

const FALLBACK_REASONING_OPTIONS: ReasoningIngressFormatOption[] = [
  {
    format: 'openai',
    appliesTo: ['POST /v1/chat/completions', 'POST /v1/responses', 'POST /v1/responses/compact', 'GET /v1/responses/ws'],
    policies: ['missing_only', 'force_override'],
    modes: [
      {
        mode: 'effort',
        fieldPaths: ['reasoning_effort', 'reasoning.effort'],
        values: ['none', 'auto', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
    ],
  },
  {
    format: 'claude',
    appliesTo: ['POST /v1/messages'],
    policies: ['missing_only', 'force_override'],
    modes: [
      {
        mode: 'adaptive_effort',
        fieldPaths: ['thinking.type', 'output_config.effort'],
        values: ['low', 'medium', 'high', 'max'],
      },
      {
        mode: 'disabled',
        fieldPaths: ['thinking.type'],
        values: ['disabled'],
      },
    ],
  },
  {
    format: 'gemini',
    appliesTo: ['POST /v1beta/models/*:generateContent', 'POST /v1beta/models/*:streamGenerateContent'],
    policies: ['missing_only', 'force_override'],
    modes: [
      {
        mode: 'level',
        fieldPaths: ['generationConfig.thinkingConfig.thinkingLevel'],
        values: ['none', 'auto', 'minimal', 'low', 'medium', 'high'],
      },
    ],
  },
];

export function VisualConfigEditor({
  values,
  validationErrors,
  hasPayloadValidationErrors = false,
  circuitBreakerValidationErrors,
  hasCircuitBreakerValidationErrors = false,
  disabled = false,
  onChange,
}: VisualConfigEditorProps) {
  const { t } = useTranslation();
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isFloatingSidebar = useMediaQuery('(min-width: 1025px)');
  const shouldRenderFloatingSidebar = !isMobile && isFloatingSidebar && isCurrentLayer;
  const routingStrategyLabelId = useId();
  const routingStrategyHintId = `${routingStrategyLabelId}-hint`;
  const providerRateLimitScopeLabelId = useId();
  const providerRateLimitScopeHintId = `${providerRateLimitScopeLabelId}-hint`;
  const keepaliveInputId = useId();
  const keepaliveHintId = `${keepaliveInputId}-hint`;
  const keepaliveErrorId = `${keepaliveInputId}-error`;
  const nonstreamKeepaliveInputId = useId();
  const nonstreamKeepaliveHintId = `${nonstreamKeepaliveInputId}-hint`;
  const nonstreamKeepaliveErrorId = `${nonstreamKeepaliveInputId}-error`;
  const [activeSectionId, setActiveSectionId] = useState<VisualSectionId>('server');
  const [reasoningOptions, setReasoningOptions] =
    useState<ReasoningIngressFormatOption[]>(FALLBACK_REASONING_OPTIONS);
  const [reasoningOptionsLoading, setReasoningOptionsLoading] = useState(true);
  const [reasoningOptionsLoadError, setReasoningOptionsLoadError] = useState<string | null>(null);
  const [providerRateLimitOptions, setProviderRateLimitOptions] = useState<ProviderRateLimitOptions>({
    providers: [],
    models: [],
  });
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const sidebarAnchorRef = useRef<HTMLElement | null>(null);
  const floatingSidebarRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Partial<Record<VisualSectionId, HTMLElement | null>>>({});
  const mobileNavScrollerRef = useRef<HTMLDivElement | null>(null);
  const mobileNavButtonRefs = useRef<Partial<Record<VisualSectionId, HTMLButtonElement | null>>>(
    {}
  );

  const isKeepaliveDisabled =
    values.streaming.keepaliveSeconds === '' || values.streaming.keepaliveSeconds === '0';
  const isNonstreamKeepaliveDisabled =
    values.streaming.nonstreamKeepaliveInterval === '' ||
    values.streaming.nonstreamKeepaliveInterval === '0';

  const portError = getValidationMessage(t, validationErrors?.port);
  const logsMaxSizeError = getValidationMessage(t, validationErrors?.logsMaxTotalSizeMb);
  const requestRetryError = getValidationMessage(t, validationErrors?.requestRetry);
  const maxRetryCredentialsError = getValidationMessage(t, validationErrors?.maxRetryCredentials);
  const maxRetryIntervalError = getValidationMessage(t, validationErrors?.maxRetryInterval);
  const providerRateLimitRateError = getValidationMessage(
    t,
    validationErrors?.['providerRateLimit.rateLimit']
  );
  const providerRateLimitWindowError = getValidationMessage(
    t,
    validationErrors?.['providerRateLimit.rateWindowSeconds']
  );
  const providerRateLimitConcurrencyError = getValidationMessage(
    t,
    validationErrors?.['providerRateLimit.maxStreamConcurrency']
  );
  const providerRateLimitBaseDelayError = getValidationMessage(
    t,
    validationErrors?.['providerRateLimit.reactiveBaseDelayMs']
  );
  const providerRateLimitMaxDelayError = getValidationMessage(
    t,
    validationErrors?.['providerRateLimit.reactiveMaxDelaySeconds']
  );
  const providerRateLimitJitterError = getValidationMessage(
    t,
    validationErrors?.['providerRateLimit.reactiveJitterMs']
  );
  const providerRateLimitAdaptiveFactorError = getValidationMessage(
    t,
    validationErrors?.['providerRateLimit.adaptiveDecreaseFactor']
  );
  const providerRateLimitAdaptiveMinRateError = getValidationMessage(
    t,
    validationErrors?.['providerRateLimit.adaptiveMinRateLimit']
  );
  const providerRateLimitAdaptiveDebounceError = getValidationMessage(
    t,
    validationErrors?.['providerRateLimit.adaptivePersistDebounceSeconds']
  );
  const keepaliveError = getValidationMessage(t, validationErrors?.['streaming.keepaliveSeconds']);
  const bootstrapRetriesError = getValidationMessage(
    t,
    validationErrors?.['streaming.bootstrapRetries']
  );
  const nonstreamKeepaliveError = getValidationMessage(
    t,
    validationErrors?.['streaming.nonstreamKeepaliveInterval']
  );
  const circuitBreakerAutoRemovalThresholdError = getValidationMessage(
    t,
    validationErrors?.circuitBreakerAutoRemovalThreshold
  );

  const handleApiKeysTextChange = useCallback(
    (apiKeyEntries: VisualConfigValues['apiKeyEntries']) => onChange({ apiKeyEntries }),
    [onChange]
  );
  const handlePayloadDefaultRulesChange = useCallback(
    (payloadDefaultRules: PayloadRule[]) => onChange({ payloadDefaultRules }),
    [onChange]
  );
  const handlePayloadDefaultRawRulesChange = useCallback(
    (payloadDefaultRawRules: PayloadRule[]) => onChange({ payloadDefaultRawRules }),
    [onChange]
  );
  const handlePayloadOverrideRulesChange = useCallback(
    (payloadOverrideRules: PayloadRule[]) => onChange({ payloadOverrideRules }),
    [onChange]
  );
  const handlePayloadOverrideRawRulesChange = useCallback(
    (payloadOverrideRawRules: PayloadRule[]) => onChange({ payloadOverrideRawRules }),
    [onChange]
  );
  const handlePayloadFilterRulesChange = useCallback(
    (payloadFilterRules: PayloadFilterRule[]) => onChange({ payloadFilterRules }),
    [onChange]
  );
  const patchProviderRateLimit = useCallback(
    (patch: Partial<VisualConfigValues['providerRateLimit']>) =>
      onChange({
        providerRateLimit: {
          ...values.providerRateLimit,
          ...patch,
        },
      }),
    [onChange, values.providerRateLimit]
  );
  const addProviderRateLimitOverride = useCallback(() => {
    const next: ProviderRateLimitOverrideEntry = {
      id: makeClientId(),
      provider: '',
      authId: '',
      model: '',
      mode: 'auto',
      scope: 'provider-model',
      rateLimit: '',
    };
    patchProviderRateLimit({
      overrides: [...values.providerRateLimit.overrides, next],
    });
  }, [patchProviderRateLimit, values.providerRateLimit.overrides]);
  const removeProviderRateLimitOverride = useCallback(
    (id: string) => {
      patchProviderRateLimit({
        overrides: values.providerRateLimit.overrides.filter((item) => item.id !== id),
      });
    },
    [patchProviderRateLimit, values.providerRateLimit.overrides]
  );
  const updateProviderRateLimitOverride = useCallback(
    (id: string, patch: Partial<ProviderRateLimitOverrideEntry>) => {
      patchProviderRateLimit({
        overrides: values.providerRateLimit.overrides.map((item) =>
          item.id === id ? { ...item, ...patch } : item
        ),
      });
    },
    [patchProviderRateLimit, values.providerRateLimit.overrides]
  );
  const providerRateLimitProviderOptions = useMemo(() => {
    const valuesSet = new Set<string>();
    providerRateLimitOptions.providers.forEach((item) => {
      const normalized = item.trim();
      if (normalized) valuesSet.add(normalized);
    });
    values.providerRateLimit.overrides.forEach((item) => {
      const normalized = item.provider.trim();
      if (normalized) valuesSet.add(normalized);
    });
    return Array.from(valuesSet).sort();
  }, [providerRateLimitOptions.providers, values.providerRateLimit.overrides]);
  const providerRateLimitModelOptions = useMemo(() => {
    const valuesSet = new Set<string>();
    providerRateLimitOptions.models.forEach((item) => {
      const normalized = item.trim();
      if (normalized) valuesSet.add(normalized);
    });
    values.providerRateLimit.overrides.forEach((item) => {
      const normalized = item.model.trim();
      if (normalized) valuesSet.add(normalized);
    });
    return Array.from(valuesSet).sort();
  }, [providerRateLimitOptions.models, values.providerRateLimit.overrides]);
  const reasoningFormatSpecs = useMemo(() => {
    const map = new Map<string, ReasoningIngressFormatOption>();
    for (const item of reasoningOptions) {
      map.set(item.format, item);
    }
    return map;
  }, [reasoningOptions]);
  const reasoningFormatSelectOptions = useMemo(
    () =>
      reasoningOptions.map((item) => ({
        value: item.format,
        label: item.format,
      })),
    [reasoningOptions]
  );

  const addReasoningDefaultEntry = useCallback(() => {
    if (reasoningOptions.length === 0) return;
    const formatSpec = reasoningOptions[0];
    const modeSpec = formatSpec.modes[0];
    const policy = formatSpec.policies[0];
    if (!modeSpec || modeSpec.values.length === 0) return;
    onChange({
      reasoningDefaultsByFormat: [
        ...values.reasoningDefaultsByFormat,
        {
          id: makeClientId(),
          format: formatSpec.format,
          policy: policy ?? '',
          mode: modeSpec.mode,
          value: modeSpec.values[0],
        },
      ],
    });
  }, [onChange, reasoningOptions, values.reasoningDefaultsByFormat]);

  const removeReasoningDefaultEntry = useCallback(
    (id: string) => {
      onChange({
        reasoningDefaultsByFormat: values.reasoningDefaultsByFormat.filter(
          (entry) => entry.id !== id
        ),
      });
    },
    [onChange, values.reasoningDefaultsByFormat]
  );

  const updateReasoningDefaultEntry = useCallback(
    (
      id: string,
      updater: (
        current: VisualConfigValues['reasoningDefaultsByFormat'][number]
      ) => VisualConfigValues['reasoningDefaultsByFormat'][number]
    ) => {
      onChange({
        reasoningDefaultsByFormat: values.reasoningDefaultsByFormat.map((entry) =>
          entry.id === id ? updater(entry) : entry
        ),
      });
    },
    [onChange, values.reasoningDefaultsByFormat]
  );

  const changeReasoningFormat = useCallback(
    (id: string, format: string) => {
      const formatSpec = reasoningFormatSpecs.get(format);
      const modeSpec = formatSpec?.modes[0];
      if (!formatSpec || !modeSpec || modeSpec.values.length === 0) return;
      updateReasoningDefaultEntry(id, (entry) => ({
        ...entry,
        format: formatSpec.format,
        policy: formatSpec.policies[0] ?? '',
        mode: modeSpec.mode,
        value: modeSpec.values[0],
      }));
    },
    [reasoningFormatSpecs, updateReasoningDefaultEntry]
  );

  const changeReasoningPolicy = useCallback(
    (id: string, policy: string) => {
      updateReasoningDefaultEntry(id, (entry) => ({ ...entry, policy }));
    },
    [updateReasoningDefaultEntry]
  );

  const changeReasoningMode = useCallback(
    (id: string, mode: string) => {
      updateReasoningDefaultEntry(id, (entry) => {
        const formatSpec = reasoningFormatSpecs.get(entry.format);
        const modeSpec = formatSpec?.modes.find((item) => item.mode === mode);
        if (!formatSpec || !modeSpec || modeSpec.values.length === 0) return entry;
        return {
          ...entry,
          mode: modeSpec.mode,
          value: modeSpec.values.includes(entry.value) ? entry.value : modeSpec.values[0],
        };
      });
    },
    [reasoningFormatSpecs, updateReasoningDefaultEntry]
  );

  const changeReasoningValue = useCallback(
    (id: string, value: string) => {
      updateReasoningDefaultEntry(id, (entry) => ({ ...entry, value }));
    },
    [updateReasoningDefaultEntry]
  );

  useEffect(() => {
    let cancelled = false;
    reasoningDefaultsApi
      .getOptions()
      .then((items) => {
        if (cancelled) return;
        if (items.length > 0) {
          setReasoningOptions(items);
          return;
        }
        setReasoningOptions(FALLBACK_REASONING_OPTIONS);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : '';
        setReasoningOptions(FALLBACK_REASONING_OPTIONS);
        setReasoningOptionsLoadError(message || 'failed');
      })
      .finally(() => {
        if (cancelled) return;
        setReasoningOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    configApi
      .getProviderRateLimitOptions()
      .then((payload) => {
        if (cancelled) return;
        const providers = Array.isArray((payload as { providers?: unknown }).providers)
          ? ((payload as { providers: unknown[] }).providers
              .map((item) => String(item ?? '').trim())
              .filter(Boolean) as string[])
          : [];
        const models = Array.isArray((payload as { models?: unknown }).models)
          ? ((payload as { models: unknown[] }).models
              .map((item) => String(item ?? '').trim())
              .filter(Boolean) as string[])
          : [];
        setProviderRateLimitOptions({ providers, models });
      })
      .catch(() => {
        if (cancelled) return;
        setProviderRateLimitOptions({ providers: [], models: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const countErrors = useCallback(
    (fields: VisualConfigFieldPath[]) =>
      fields.reduce((total, field) => total + (validationErrors?.[field] ? 1 : 0), 0),
    [validationErrors]
  );

  const sections = useMemo<VisualSection[]>(
    () => [
      {
        id: 'server',
        title: t('config_management.visual.sections.server.title'),
        description: t('config_management.visual.sections.server.description'),
        icon: IconSettings,
        errorCount: countErrors(['port']),
      },
      {
        id: 'tls',
        title: t('config_management.visual.sections.tls.title'),
        description: t('config_management.visual.sections.tls.description'),
        icon: IconShield,
        errorCount: 0,
      },
      {
        id: 'remote',
        title: t('config_management.visual.sections.remote.title'),
        description: t('config_management.visual.sections.remote.description'),
        icon: IconSatellite,
        errorCount: 0,
      },
      {
        id: 'auth',
        title: t('config_management.visual.sections.auth.title'),
        description: t('config_management.visual.sections.auth.description'),
        icon: IconKey,
        errorCount: 0,
      },
      {
        id: 'system',
        title: t('config_management.visual.sections.system.title'),
        description: t('config_management.visual.sections.system.description'),
        icon: IconDiamond,
        errorCount: countErrors(['logsMaxTotalSizeMb']),
      },
      {
        id: 'network',
        title: t('config_management.visual.sections.network.title'),
        description: t('config_management.visual.sections.network.description'),
        icon: IconTrendingUp,
        errorCount: countErrors([
          'requestRetry',
          'maxRetryCredentials',
          'maxRetryInterval',
          'providerRateLimit.rateLimit',
          'providerRateLimit.rateWindowSeconds',
          'providerRateLimit.maxStreamConcurrency',
          'providerRateLimit.reactiveBaseDelayMs',
          'providerRateLimit.reactiveMaxDelaySeconds',
          'providerRateLimit.reactiveJitterMs',
          'providerRateLimit.adaptiveDecreaseFactor',
          'providerRateLimit.adaptiveMinRateLimit',
          'providerRateLimit.adaptivePersistDebounceSeconds',
        ]),
      },
      {
        id: 'quota',
        title: t('config_management.visual.sections.quota.title'),
        description: t('config_management.visual.sections.quota.description'),
        icon: IconTimer,
        errorCount: 0,
      },
      {
        id: 'circuitBreaker',
        title: t('config_management.visual.sections.circuit_breaker.title'),
        description: t('config_management.visual.sections.circuit_breaker.description'),
        icon: IconTimer,
        errorCount:
          countErrors(['circuitBreakerAutoRemovalThreshold']) +
          (hasCircuitBreakerValidationErrors ? 1 : 0),
      },
      {
        id: 'streaming',
        title: t('config_management.visual.sections.streaming.title'),
        description: t('config_management.visual.sections.streaming.description'),
        icon: IconSatellite,
        errorCount: countErrors([
          'streaming.keepaliveSeconds',
          'streaming.bootstrapRetries',
          'streaming.nonstreamKeepaliveInterval',
        ]),
      },
      {
        id: 'payload',
        title: t('config_management.visual.sections.payload.title'),
        description: t('config_management.visual.sections.payload.description'),
        icon: IconCode,
        errorCount: hasPayloadValidationErrors ? 1 : 0,
      },
    ],
    [countErrors, hasCircuitBreakerValidationErrors, hasPayloadValidationErrors, t]
  );

  const hasValidationIssues =
    sections.some((section) => section.errorCount > 0) || hasPayloadValidationErrors;
  const focusSections = useMemo(
    () =>
      sections.filter((section) =>
        ['server', 'network', 'circuitBreaker', 'payload'].includes(section.id)
      ),
    [sections]
  );

  const updateCodexOverride = useCallback(
    (id: string, patch: Partial<VisualConfigValues['codexCircuitBreakerOverrides'][number]>) => {
      onChange({
        codexCircuitBreakerOverrides: values.codexCircuitBreakerOverrides.map((entry) =>
          entry.id === id ? { ...entry, ...patch } : entry
        ),
      });
    },
    [onChange, values.codexCircuitBreakerOverrides]
  );

  const updateOpenAIOverride = useCallback(
    (id: string, patch: Partial<VisualConfigValues['openaiCircuitBreakerOverrides'][number]>) => {
      onChange({
        openaiCircuitBreakerOverrides: values.openaiCircuitBreakerOverrides.map((entry) =>
          entry.id === id ? { ...entry, ...patch } : entry
        ),
      });
    },
    [onChange, values.openaiCircuitBreakerOverrides]
  );

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio);

        if (visibleEntries.length === 0) return;
        setActiveSectionId(visibleEntries[0].target.id as VisualSectionId);
      },
      {
        rootMargin: '-18% 0px -58% 0px',
        threshold: [0.12, 0.3, 0.55],
      }
    );

    for (const section of sections) {
      const element = sectionRefs.current[section.id];
      if (element) observer.observe(element);
    }

    return () => observer.disconnect();
  }, [sections]);

  useEffect(() => {
    if (!isMobile) return;
    const scroller = mobileNavScrollerRef.current;
    const button = mobileNavButtonRefs.current[activeSectionId];
    if (!scroller || !button) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const centeredLeft =
      scroller.scrollLeft +
      (buttonRect.left - scrollerRect.left) -
      (scroller.clientWidth - buttonRect.width) / 2;
    const maxScrollLeft = Math.max(scroller.scrollWidth - scroller.clientWidth, 0);
    const targetLeft = Math.min(Math.max(centeredLeft, 0), maxScrollLeft);

    scroller.scrollTo({
      left: targetLeft,
      behavior: 'smooth',
    });
  }, [activeSectionId, isMobile]);

  const handleSectionJump = useCallback((sectionId: VisualSectionId) => {
    setActiveSectionId(sectionId);
    sectionRefs.current[sectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useLayoutEffect(() => {
    const floatingElement = floatingSidebarRef.current;
    const anchorElement = sidebarAnchorRef.current;
    const workspaceElement = workspaceRef.current;
    if (!floatingElement) return undefined;

    const clearFloatingStyles = () => {
      floatingElement.style.removeProperty('transform');
      floatingElement.style.removeProperty('width');
      floatingElement.style.removeProperty('max-height');
      floatingElement.style.removeProperty('opacity');
      floatingElement.style.removeProperty('pointer-events');
    };

    if (!shouldRenderFloatingSidebar || !anchorElement || !workspaceElement) {
      clearFloatingStyles();
      return undefined;
    }

    /* ---- Cache header height – recomputed only on resize ---- */
    const computeHeaderHeight = () => {
      const header = document.querySelector('.main-header') as HTMLElement | null;
      if (header) return header.getBoundingClientRect().height;

      const raw = getComputedStyle(document.documentElement).getPropertyValue('--header-height');
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : 64;
    };
    let headerHeight = computeHeaderHeight();

    /* ---- Cache content scroller – resolved once ---- */
    const contentScroller = document.querySelector('.content') as HTMLElement | null;

    /* ---- Cache floating height from previous frame ---- */
    let cachedFloatingHeight = floatingElement.getBoundingClientRect().height || 200;

    let frameId = 0;

    const updateFloatingPosition = () => {
      frameId = 0;

      const anchorRect = anchorElement.getBoundingClientRect();
      const workspaceRect = workspaceElement.getBoundingClientRect();
      const stickyTop = headerHeight + 20;
      const viewportPadding = 16;
      const maxTop = workspaceRect.bottom - cachedFloatingHeight;
      const unclampedTop = Math.min(Math.max(anchorRect.top, stickyTop), maxTop);
      const top = Math.max(unclampedTop, viewportPadding);
      const left = Math.max(anchorRect.left, viewportPadding);
      const width = Math.max(
        Math.min(anchorRect.width, window.innerWidth - left - viewportPadding),
        220
      );
      const maxHeight = Math.max(window.innerHeight - top - viewportPadding, 160);
      const isVisible = workspaceRect.bottom > stickyTop + 24 && anchorRect.top < window.innerHeight;

      floatingElement.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      floatingElement.style.width = `${width}px`;
      floatingElement.style.maxHeight = `${maxHeight}px`;
      floatingElement.style.opacity = isVisible ? '1' : '0';
      floatingElement.style.pointerEvents = isVisible ? 'auto' : 'none';
    };

    const requestPositionUpdate = () => {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(updateFloatingPosition);
    };

    const handleResize = () => {
      headerHeight = computeHeaderHeight();
      cachedFloatingHeight = floatingElement.getBoundingClientRect().height || cachedFloatingHeight;
      requestPositionUpdate();
    };

    requestPositionUpdate();

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', requestPositionUpdate, { passive: true });
    contentScroller?.addEventListener('scroll', requestPositionUpdate, { passive: true });

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(requestPositionUpdate);
    resizeObserver?.observe(anchorElement);
    resizeObserver?.observe(workspaceElement);

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', requestPositionUpdate);
      contentScroller?.removeEventListener('scroll', requestPositionUpdate);
      clearFloatingStyles();
    };
  }, [shouldRenderFloatingSidebar]);

  const navContent = (
    <div className={styles.navList}>
      {sections.map((section, index) => {
        const Icon = section.icon;

        return (
          <button
            key={section.id}
            type="button"
            className={`${styles.navButton} ${
              activeSectionId === section.id ? styles.navButtonActive : ''
            }`}
            onClick={() => handleSectionJump(section.id)}
          >
            <span className={styles.navIndex}>{String(index + 1).padStart(2, '0')}</span>
            <span className={styles.navMain}>
              <span className={styles.navHeadingRow}>
                <span className={styles.navLabelWrap}>
                  <span className={styles.navIcon}>
                    <Icon size={14} />
                  </span>
                  <span className={styles.navLabel}>{section.title}</span>
                </span>
                {section.errorCount > 0 ? (
                  <span className={styles.navBadge} aria-hidden="true">
                    {section.errorCount}
                  </span>
                ) : null}
              </span>
              <span className={styles.navDescription}>{section.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={styles.visualEditor}>
      <div className={styles.overview}>
        <div className={styles.overviewHeader}>
          <div className={styles.overviewMeta}>
            <span className={styles.overviewPill}>
              {t('config_management.visual.quick_jump', { defaultValue: '快速跳转' })}
            </span>
            {hasValidationIssues ? (
              <span className={`${styles.overviewPill} ${styles.overviewPillWarning}`}>
                {t('config_management.visual.validation.validation_blocked')}
              </span>
            ) : null}
          </div>
        </div>

        <div className={styles.overviewFocusList}>
          {focusSections.map((section) => {
            const Icon = section.icon;

            return (
              <button
                key={section.id}
                type="button"
                className={`${styles.overviewFocusLink} ${
                  activeSectionId === section.id ? styles.overviewFocusLinkActive : ''
                }`}
                onClick={() => handleSectionJump(section.id)}
              >
                <span className={styles.focusIcon}>
                  <Icon size={16} />
                </span>
                <span className={styles.focusCopy}>
                  <span className={styles.focusTitle}>{section.title}</span>
                  <span className={styles.focusDescription}>{section.description}</span>
                </span>
                {section.errorCount > 0 ? (
                  <span className={styles.navBadge} aria-hidden="true">
                    {section.errorCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={workspaceRef} className={styles.workspace}>
        {isMobile ? (
          <div className={styles.mobileSectionNav}>
            <div
              ref={mobileNavScrollerRef}
              className={styles.mobileSectionNavScroller}
              aria-label={t('config_management.visual.quick_jump', { defaultValue: '快速跳转' })}
            >
              {sections.map((section, index) => (
                <button
                  key={section.id}
                  ref={(node) => {
                    mobileNavButtonRefs.current[section.id] = node;
                  }}
                  type="button"
                  className={`${styles.mobileSectionNavButton} ${
                    activeSectionId === section.id ? styles.mobileSectionNavButtonActive : ''
                  }`}
                  onClick={() => handleSectionJump(section.id)}
                >
                  <span className={styles.mobileSectionNavIndex}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className={styles.mobileSectionNavLabel}>{section.title}</span>
                  {section.errorCount > 0 ? (
                    <span className={styles.mobileSectionNavBadge} aria-hidden="true">
                      {section.errorCount}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <aside ref={sidebarAnchorRef} className={styles.sidebar}>
          {isFloatingSidebar ? (
            <div className={styles.sidebarPlaceholder} aria-hidden="true" />
          ) : (
            <div className={styles.sidebarRail}>{navContent}</div>
          )}
        </aside>

        <div className={styles.sections}>
          <ConfigSection
            id="server"
            ref={(node) => {
              sectionRefs.current.server = node;
            }}
            indexLabel="01"
            icon={<IconSettings size={16} />}
            title={t('config_management.visual.sections.server.title')}
            description={t('config_management.visual.sections.server.description')}
          >
            <SectionGrid>
              <Input
                label={t('config_management.visual.sections.server.host')}
                placeholder="0.0.0.0"
                value={values.host}
                onChange={(e) => onChange({ host: e.target.value })}
                disabled={disabled}
              />
              <Input
                label={t('config_management.visual.sections.server.port')}
                type="number"
                placeholder={String(DEFAULT_API_PORT)}
                value={values.port}
                onChange={(e) => onChange({ port: e.target.value })}
                disabled={disabled}
                error={portError}
              />
            </SectionGrid>
          </ConfigSection>

          <ConfigSection
            id="tls"
            ref={(node) => {
              sectionRefs.current.tls = node;
            }}
            indexLabel="02"
            icon={<IconShield size={16} />}
            title={t('config_management.visual.sections.tls.title')}
            description={t('config_management.visual.sections.tls.description')}
          >
            <SectionStack>
              <ToggleRow
                title={t('config_management.visual.sections.tls.enable')}
                description={t('config_management.visual.sections.tls.enable_desc')}
                checked={values.tlsEnable}
                disabled={disabled}
                onChange={(tlsEnable) => onChange({ tlsEnable })}
              />

              {values.tlsEnable ? (
                <>
                  <Divider />
                  <SectionGrid>
                    <Input
                      label={t('config_management.visual.sections.tls.cert')}
                      placeholder="/path/to/cert.pem"
                      value={values.tlsCert}
                      onChange={(e) => onChange({ tlsCert: e.target.value })}
                      disabled={disabled}
                    />
                    <Input
                      label={t('config_management.visual.sections.tls.key')}
                      placeholder="/path/to/key.pem"
                      value={values.tlsKey}
                      onChange={(e) => onChange({ tlsKey: e.target.value })}
                      disabled={disabled}
                    />
                  </SectionGrid>
                </>
              ) : null}
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="remote"
            ref={(node) => {
              sectionRefs.current.remote = node;
            }}
            indexLabel="03"
            icon={<IconSatellite size={16} />}
            title={t('config_management.visual.sections.remote.title')}
            description={t('config_management.visual.sections.remote.description')}
          >
            <SectionStack>
              <ToggleRow
                title={t('config_management.visual.sections.remote.allow_remote')}
                description={t('config_management.visual.sections.remote.allow_remote_desc')}
                checked={values.rmAllowRemote}
                disabled={disabled}
                onChange={(rmAllowRemote) => onChange({ rmAllowRemote })}
              />
              <ToggleRow
                title={t('config_management.visual.sections.remote.disable_panel')}
                description={t('config_management.visual.sections.remote.disable_panel_desc')}
                checked={values.rmDisableControlPanel}
                disabled={disabled}
                onChange={(rmDisableControlPanel) => onChange({ rmDisableControlPanel })}
              />
              <SectionGrid>
                <Input
                  label={t('config_management.visual.sections.remote.secret_key')}
                  type="password"
                  placeholder={t('config_management.visual.sections.remote.secret_key_placeholder')}
                  value={values.rmSecretKey}
                  onChange={(e) => onChange({ rmSecretKey: e.target.value })}
                  disabled={disabled}
                />
                <Input
                  label={t('config_management.visual.sections.remote.panel_repo')}
                  placeholder="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
                  value={values.rmPanelRepo}
                  onChange={(e) => onChange({ rmPanelRepo: e.target.value })}
                  disabled={disabled}
                />
              </SectionGrid>
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="auth"
            ref={(node) => {
              sectionRefs.current.auth = node;
            }}
            indexLabel="04"
            icon={<IconKey size={16} />}
            title={t('config_management.visual.sections.auth.title')}
            description={t('config_management.visual.sections.auth.description')}
          >
            <SectionStack>
              <Input
                label={t('config_management.visual.sections.auth.auth_dir')}
                placeholder="~/.cli-proxy-api"
                value={values.authDir}
                onChange={(e) => onChange({ authDir: e.target.value })}
                disabled={disabled}
                hint={t('config_management.visual.sections.auth.auth_dir_hint')}
              />
              <div className={styles.subsection}>
                <ApiKeysCardEditor
                  value={values.apiKeyEntries}
                  disabled={disabled}
                  onChange={handleApiKeysTextChange}
                />
              </div>
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="system"
            ref={(node) => {
              sectionRefs.current.system = node;
            }}
            indexLabel="05"
            icon={<IconDiamond size={16} />}
            title={t('config_management.visual.sections.system.title')}
            description={t('config_management.visual.sections.system.description')}
          >
            <SectionStack>
              <SectionGrid>
                <ToggleRow
                  title={t('config_management.visual.sections.system.debug')}
                  description={t('config_management.visual.sections.system.debug_desc')}
                  checked={values.debug}
                  disabled={disabled}
                  onChange={(debug) => onChange({ debug })}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.system.commercial_mode')}
                  description={t('config_management.visual.sections.system.commercial_mode_desc')}
                  checked={values.commercialMode}
                  disabled={disabled}
                  onChange={(commercialMode) => onChange({ commercialMode })}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.system.logging_to_file')}
                  description={t('config_management.visual.sections.system.logging_to_file_desc')}
                  checked={values.loggingToFile}
                  disabled={disabled}
                  onChange={(loggingToFile) => onChange({ loggingToFile })}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.system.usage_statistics')}
                  description={t('config_management.visual.sections.system.usage_statistics_desc')}
                  checked={values.usageStatisticsEnabled}
                  disabled={disabled}
                  onChange={(usageStatisticsEnabled) => onChange({ usageStatisticsEnabled })}
                />
              </SectionGrid>

              <SectionGrid>
                <Input
                  label={t('config_management.visual.sections.system.logs_max_size')}
                  type="number"
                  placeholder="0"
                  value={values.logsMaxTotalSizeMb}
                  onChange={(e) => onChange({ logsMaxTotalSizeMb: e.target.value })}
                  disabled={disabled}
                  error={logsMaxSizeError}
                />
              </SectionGrid>
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="network"
            ref={(node) => {
              sectionRefs.current.network = node;
            }}
            indexLabel="06"
            icon={<IconTrendingUp size={16} />}
            title={t('config_management.visual.sections.network.title')}
            description={t('config_management.visual.sections.network.description')}
          >
            <SectionStack>
              <SectionGrid>
                <Input
                  label={t('config_management.visual.sections.network.proxy_url')}
                  placeholder="socks5://user:pass@127.0.0.1:1080/"
                  value={values.proxyUrl}
                  onChange={(e) => onChange({ proxyUrl: e.target.value })}
                  disabled={disabled}
                />
                <Input
                  label={t('config_management.visual.sections.network.request_retry')}
                  type="number"
                  placeholder="3"
                  value={values.requestRetry}
                  onChange={(e) => onChange({ requestRetry: e.target.value })}
                  disabled={disabled}
                  error={requestRetryError}
                />
                <Input
                  label={t('config_management.visual.sections.network.max_retry_credentials')}
                  type="number"
                  placeholder="0"
                  value={values.maxRetryCredentials}
                  onChange={(e) => onChange({ maxRetryCredentials: e.target.value })}
                  disabled={disabled}
                  hint={t('config_management.visual.sections.network.max_retry_credentials_hint')}
                  error={maxRetryCredentialsError}
                />
                <Input
                  label={t('config_management.visual.sections.network.max_retry_interval')}
                  type="number"
                  placeholder="30"
                  value={values.maxRetryInterval}
                  onChange={(e) => onChange({ maxRetryInterval: e.target.value })}
                  disabled={disabled}
                  error={maxRetryIntervalError}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.network.provider_rate_limit_enabled')}
                  description={t(
                    'config_management.visual.sections.network.provider_rate_limit_enabled_desc'
                  )}
                  checked={values.providerRateLimit.enabled}
                  disabled={disabled}
                  onChange={(enabled) => patchProviderRateLimit({ enabled })}
                />
                <FieldShell
                  label={t('config_management.visual.sections.network.provider_rate_limit_scope')}
                  labelId={providerRateLimitScopeLabelId}
                  hint={t('config_management.visual.sections.network.provider_rate_limit_scope_hint')}
                  hintId={providerRateLimitScopeHintId}
                >
                  <Select
                    value={values.providerRateLimit.scope}
                    options={[
                      {
                        value: 'credential',
                        label: t(
                          'config_management.visual.sections.network.provider_rate_limit_scope_credential'
                        ),
                      },
                      {
                        value: 'provider',
                        label: t(
                          'config_management.visual.sections.network.provider_rate_limit_scope_provider'
                        ),
                      },
                      {
                        value: 'provider-model',
                        label: t(
                          'config_management.visual.sections.network.provider_rate_limit_scope_provider_model'
                        ),
                      },
                    ]}
                    id={`${providerRateLimitScopeLabelId}-select`}
                    disabled={disabled}
                    ariaLabelledBy={providerRateLimitScopeLabelId}
                    ariaDescribedBy={providerRateLimitScopeHintId}
                    onChange={(nextValue) =>
                      patchProviderRateLimit({
                        scope: nextValue as VisualConfigValues['providerRateLimit']['scope'],
                      })
                    }
                  />
                </FieldShell>
                <Input
                  label={t('config_management.visual.sections.network.provider_rate_limit_rate')}
                  type="number"
                  placeholder="40"
                  value={values.providerRateLimit.rateLimit}
                  onChange={(e) => patchProviderRateLimit({ rateLimit: e.target.value })}
                  disabled={disabled}
                  error={providerRateLimitRateError}
                />
                <Input
                  label={t('config_management.visual.sections.network.provider_rate_limit_window')}
                  type="number"
                  placeholder="60"
                  value={values.providerRateLimit.rateWindowSeconds}
                  onChange={(e) => patchProviderRateLimit({ rateWindowSeconds: e.target.value })}
                  disabled={disabled}
                  error={providerRateLimitWindowError}
                />
                <Input
                  label={t(
                    'config_management.visual.sections.network.provider_rate_limit_max_concurrency'
                  )}
                  type="number"
                  placeholder="5"
                  value={values.providerRateLimit.maxStreamConcurrency}
                  onChange={(e) => patchProviderRateLimit({ maxStreamConcurrency: e.target.value })}
                  disabled={disabled}
                  error={providerRateLimitConcurrencyError}
                />
                <Input
                  label={t(
                    'config_management.visual.sections.network.provider_rate_limit_base_delay_ms'
                  )}
                  type="number"
                  placeholder="1000"
                  value={values.providerRateLimit.reactiveBaseDelayMs}
                  onChange={(e) => patchProviderRateLimit({ reactiveBaseDelayMs: e.target.value })}
                  disabled={disabled}
                  error={providerRateLimitBaseDelayError}
                />
                <Input
                  label={t(
                    'config_management.visual.sections.network.provider_rate_limit_max_delay_seconds'
                  )}
                  type="number"
                  placeholder="60"
                  value={values.providerRateLimit.reactiveMaxDelaySeconds}
                  onChange={(e) =>
                    patchProviderRateLimit({ reactiveMaxDelaySeconds: e.target.value })
                  }
                  disabled={disabled}
                  error={providerRateLimitMaxDelayError}
                />
                <Input
                  label={t(
                    'config_management.visual.sections.network.provider_rate_limit_jitter_ms'
                  )}
                  type="number"
                  placeholder="300"
                  value={values.providerRateLimit.reactiveJitterMs}
                  onChange={(e) => patchProviderRateLimit({ reactiveJitterMs: e.target.value })}
                  disabled={disabled}
                  error={providerRateLimitJitterError}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.network.provider_rate_limit_adaptive_enabled')}
                  description={t(
                    'config_management.visual.sections.network.provider_rate_limit_adaptive_enabled_desc'
                  )}
                  checked={values.providerRateLimit.adaptiveEnabled}
                  disabled={disabled}
                  onChange={(adaptiveEnabled) => patchProviderRateLimit({ adaptiveEnabled })}
                />
                <ToggleRow
                  title={t(
                    'config_management.visual.sections.network.provider_rate_limit_adaptive_increase_on_success'
                  )}
                  description={t(
                    'config_management.visual.sections.network.provider_rate_limit_adaptive_increase_on_success_desc'
                  )}
                  checked={values.providerRateLimit.adaptiveIncreaseOnSuccess}
                  disabled={disabled || !values.providerRateLimit.adaptiveEnabled}
                  onChange={(adaptiveIncreaseOnSuccess) =>
                    patchProviderRateLimit({ adaptiveIncreaseOnSuccess })
                  }
                />
                <Input
                  label={t(
                    'config_management.visual.sections.network.provider_rate_limit_adaptive_decrease_factor'
                  )}
                  type="number"
                  placeholder="0.8"
                  value={values.providerRateLimit.adaptiveDecreaseFactor}
                  onChange={(e) =>
                    patchProviderRateLimit({ adaptiveDecreaseFactor: e.target.value })
                  }
                  disabled={disabled || !values.providerRateLimit.adaptiveEnabled}
                  error={providerRateLimitAdaptiveFactorError}
                />
                <Input
                  label={t(
                    'config_management.visual.sections.network.provider_rate_limit_adaptive_min_rate_limit'
                  )}
                  type="number"
                  placeholder="1"
                  value={values.providerRateLimit.adaptiveMinRateLimit}
                  onChange={(e) =>
                    patchProviderRateLimit({ adaptiveMinRateLimit: e.target.value })
                  }
                  disabled={disabled || !values.providerRateLimit.adaptiveEnabled}
                  error={providerRateLimitAdaptiveMinRateError}
                />
                <Input
                  label={t(
                    'config_management.visual.sections.network.provider_rate_limit_adaptive_persist_debounce_seconds'
                  )}
                  type="number"
                  placeholder="2"
                  value={values.providerRateLimit.adaptivePersistDebounceSeconds}
                  onChange={(e) =>
                    patchProviderRateLimit({ adaptivePersistDebounceSeconds: e.target.value })
                  }
                  disabled={disabled || !values.providerRateLimit.adaptiveEnabled}
                  error={providerRateLimitAdaptiveDebounceError}
                />
                <FieldShell
                  label={t('config_management.visual.sections.network.routing_strategy')}
                  labelId={routingStrategyLabelId}
                  hint={t('config_management.visual.sections.network.routing_strategy_hint')}
                  hintId={routingStrategyHintId}
                >
                  <Select
                    value={values.routingStrategy}
                    options={[
                      {
                        value: 'round-robin',
                        label: t('config_management.visual.sections.network.strategy_round_robin'),
                      },
                      {
                        value: 'fill-first',
                        label: t('config_management.visual.sections.network.strategy_fill_first'),
                      },
                    ]}
                    id={`${routingStrategyLabelId}-select`}
                    disabled={disabled}
                    ariaLabelledBy={routingStrategyLabelId}
                    ariaDescribedBy={routingStrategyHintId}
                    onChange={(nextValue) =>
                      onChange({
                        routingStrategy: nextValue as VisualConfigValues['routingStrategy'],
                      })
                    }
                  />
                </FieldShell>
              </SectionGrid>

              <SectionSubsection
                title={t('config_management.visual.sections.network.reasoning_defaults_title')}
                description={t('config_management.visual.sections.network.reasoning_defaults_desc')}
              >
                {reasoningOptionsLoading ? (
                  <p className={styles.subsectionDescription}>
                    {t('config_management.visual.sections.network.reasoning_loading_options')}
                  </p>
                ) : null}
                {reasoningOptionsLoadError ? (
                  <p className={styles.subsectionDescription}>
                    {t('config_management.visual.sections.network.reasoning_options_failed')}
                  </p>
                ) : null}
                {values.reasoningDefaultsByFormat.length === 0 ? (
                  <p className={styles.subsectionDescription}>
                    {t('config_management.visual.sections.network.reasoning_empty')}
                  </p>
                ) : null}
                {values.reasoningDefaultsByFormat.map((entry) => {
                  const formatSpec = reasoningFormatSpecs.get(entry.format);
                  const modeSpec =
                    formatSpec?.modes.find((item) => item.mode === entry.mode) ??
                    formatSpec?.modes[0];
                  const modeOptions = (formatSpec?.modes ?? []).map((item) => ({
                    value: item.mode,
                    label: item.mode,
                  }));
                  const policyOptions = (formatSpec?.policies ?? []).map((item) => ({
                    value: item,
                    label: item,
                  }));
                  const valueOptions = (modeSpec?.values ?? []).map((item) => ({
                    value: item,
                    label: item,
                  }));
                  return (
                    <SectionGrid key={entry.id}>
                      <FieldShell
                        label={t('config_management.visual.sections.network.reasoning_provider')}
                      >
                        <Select
                          value={entry.format}
                          options={reasoningFormatSelectOptions}
                          disabled={disabled || reasoningFormatSelectOptions.length === 0}
                          onChange={(nextFormat) =>
                            changeReasoningFormat(entry.id, nextFormat)
                          }
                        />
                      </FieldShell>
                      <FieldShell
                        label={t('config_management.visual.sections.network.reasoning_policy')}
                      >
                        <Select
                          value={entry.policy}
                          options={policyOptions}
                          disabled={disabled || policyOptions.length === 0}
                          onChange={(nextPolicy) => changeReasoningPolicy(entry.id, nextPolicy)}
                        />
                      </FieldShell>
                      <FieldShell label={t('config_management.visual.sections.network.reasoning_mode')}>
                        <Select
                          value={entry.mode}
                          options={modeOptions}
                          disabled={disabled || modeOptions.length === 0}
                          onChange={(nextMode) => changeReasoningMode(entry.id, nextMode)}
                        />
                      </FieldShell>
                      <FieldShell
                        label={t('config_management.visual.sections.network.reasoning_value')}
                        hint={
                          modeSpec?.fieldPaths?.length
                            ? `${t('config_management.visual.sections.network.reasoning_field_paths')}: ${modeSpec.fieldPaths.join(', ')}`
                            : undefined
                        }
                      >
                        <Select
                          value={entry.value}
                          options={valueOptions}
                          disabled={disabled || valueOptions.length === 0}
                          onChange={(nextValue) => changeReasoningValue(entry.id, nextValue)}
                        />
                      </FieldShell>
                      <FieldShell
                        label={t('config_management.visual.sections.network.reasoning_actions')}
                      >
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={disabled}
                          onClick={() => removeReasoningDefaultEntry(entry.id)}
                        >
                          {t('config_management.visual.sections.network.reasoning_remove')}
                        </Button>
                      </FieldShell>
                    </SectionGrid>
                  );
                })}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={disabled || reasoningFormatSelectOptions.length === 0}
                  onClick={addReasoningDefaultEntry}
                >
                  {t('config_management.visual.sections.network.reasoning_add')}
                </Button>
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.network.provider_rate_limit_overrides_title')}
                description={t(
                  'config_management.visual.sections.network.provider_rate_limit_overrides_desc'
                )}
              >
                {values.providerRateLimit.overrides.length === 0 ? (
                  <p className={styles.subsectionDescription}>
                    {t('config_management.visual.sections.network.provider_rate_limit_overrides_empty')}
                  </p>
                ) : null}
                {values.providerRateLimit.overrides.map((entry) => (
                  <SectionGrid key={entry.id}>
                    <Input
                      label={t(
                        'config_management.visual.sections.network.provider_rate_limit_override_provider'
                      )}
                      placeholder="openai-compatibility"
                      value={entry.provider}
                      onChange={(e) =>
                        updateProviderRateLimitOverride(entry.id, { provider: e.target.value })
                      }
                      disabled={disabled}
                      list="provider-rate-limit-provider-options"
                    />
                    <Input
                      label={t(
                        'config_management.visual.sections.network.provider_rate_limit_override_model'
                      )}
                      placeholder="gpt-4.1"
                      value={entry.model}
                      onChange={(e) =>
                        updateProviderRateLimitOverride(entry.id, { model: e.target.value })
                      }
                      disabled={disabled}
                      list="provider-rate-limit-model-options"
                    />
                    <FieldShell
                      label={t(
                        'config_management.visual.sections.network.provider_rate_limit_override_mode'
                      )}
                    >
                      <Select
                        value={entry.mode}
                        options={[
                          {
                            value: 'auto',
                            label: t(
                              'config_management.visual.sections.network.provider_rate_limit_override_mode_auto'
                            ),
                          },
                          {
                            value: 'manual',
                            label: t(
                              'config_management.visual.sections.network.provider_rate_limit_override_mode_manual'
                            ),
                          },
                        ]}
                        disabled={disabled}
                        onChange={(mode) =>
                          updateProviderRateLimitOverride(entry.id, {
                            mode: mode as ProviderRateLimitOverrideEntry['mode'],
                          })
                        }
                      />
                    </FieldShell>
                    <Input
                      label={t(
                        'config_management.visual.sections.network.provider_rate_limit_override_rate_limit'
                      )}
                      type="number"
                      placeholder="40"
                      value={entry.rateLimit}
                      onChange={(e) =>
                        updateProviderRateLimitOverride(entry.id, { rateLimit: e.target.value })
                      }
                      disabled={disabled}
                    />
                    <FieldShell
                      label={t(
                        'config_management.visual.sections.network.provider_rate_limit_override_scope'
                      )}
                    >
                      <Select
                        value={entry.scope}
                        options={[
                          {
                            value: 'credential',
                            label: t(
                              'config_management.visual.sections.network.provider_rate_limit_scope_credential'
                            ),
                          },
                          {
                            value: 'provider',
                            label: t(
                              'config_management.visual.sections.network.provider_rate_limit_scope_provider'
                            ),
                          },
                          {
                            value: 'provider-model',
                            label: t(
                              'config_management.visual.sections.network.provider_rate_limit_scope_provider_model'
                            ),
                          },
                        ]}
                        disabled={disabled}
                        onChange={(scope) =>
                          updateProviderRateLimitOverride(entry.id, {
                            scope: scope as ProviderRateLimitOverrideEntry['scope'],
                          })
                        }
                      />
                    </FieldShell>
                    <FieldShell
                      label={t(
                        'config_management.visual.sections.network.provider_rate_limit_override_actions'
                      )}
                    >
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={disabled}
                        onClick={() => removeProviderRateLimitOverride(entry.id)}
                      >
                        {t('config_management.visual.sections.network.provider_rate_limit_override_remove')}
                      </Button>
                    </FieldShell>
                  </SectionGrid>
                ))}
                <datalist id="provider-rate-limit-provider-options">
                  {providerRateLimitProviderOptions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
                <datalist id="provider-rate-limit-model-options">
                  {providerRateLimitModelOptions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
                <Button variant="secondary" size="sm" disabled={disabled} onClick={addProviderRateLimitOverride}>
                  {t('config_management.visual.sections.network.provider_rate_limit_override_add')}
                </Button>
              </SectionSubsection>

              <SectionGrid>
                <ToggleRow
                  title={t('config_management.visual.sections.network.force_model_prefix')}
                  description={t(
                    'config_management.visual.sections.network.force_model_prefix_desc'
                  )}
                  checked={values.forceModelPrefix}
                  disabled={disabled}
                  onChange={(forceModelPrefix) => onChange({ forceModelPrefix })}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.network.ws_auth')}
                  description={t('config_management.visual.sections.network.ws_auth_desc')}
                  checked={values.wsAuth}
                  disabled={disabled}
                  onChange={(wsAuth) => onChange({ wsAuth })}
                />
              </SectionGrid>
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="quota"
            ref={(node) => {
              sectionRefs.current.quota = node;
            }}
            indexLabel="07"
            icon={<IconTimer size={16} />}
            title={t('config_management.visual.sections.quota.title')}
            description={t('config_management.visual.sections.quota.description')}
          >
            <SectionGrid>
              <ToggleRow
                title={t('config_management.visual.sections.quota.switch_project')}
                description={t('config_management.visual.sections.quota.switch_project_desc')}
                checked={values.quotaSwitchProject}
                disabled={disabled}
                onChange={(quotaSwitchProject) => onChange({ quotaSwitchProject })}
              />
              <ToggleRow
                title={t('config_management.visual.sections.quota.switch_preview_model')}
                description={t('config_management.visual.sections.quota.switch_preview_model_desc')}
                checked={values.quotaSwitchPreviewModel}
                disabled={disabled}
                onChange={(quotaSwitchPreviewModel) => onChange({ quotaSwitchPreviewModel })}
              />
            </SectionGrid>
          </ConfigSection>

          <ConfigSection
            id="circuitBreaker"
            ref={(node) => {
              sectionRefs.current.circuitBreaker = node;
            }}
            indexLabel="08"
            icon={<IconTimer size={16} />}
            title={t('config_management.visual.sections.circuit_breaker.title')}
            description={t('config_management.visual.sections.circuit_breaker.description')}
          >
            <SectionStack>
              <SectionSubsection
                title={t('config_management.visual.sections.circuit_breaker.auto_removal_title')}
                description={t(
                  'config_management.visual.sections.circuit_breaker.auto_removal_desc'
                )}
              >
                <SectionStack>
                  <ToggleRow
                    title={t('config_management.visual.sections.circuit_breaker.auto_removal_enable')}
                    description={t(
                      'config_management.visual.sections.circuit_breaker.auto_removal_enable_desc'
                    )}
                    checked={values.circuitBreakerAutoRemovalEnabled}
                    disabled={disabled}
                    onChange={(circuitBreakerAutoRemovalEnabled) =>
                      onChange({ circuitBreakerAutoRemovalEnabled })
                    }
                  />
                  <Input
                    label={t(
                      'config_management.visual.sections.circuit_breaker.auto_remove_threshold'
                    )}
                    type="number"
                    step={1}
                    min={1}
                    placeholder="3"
                    value={values.circuitBreakerAutoRemovalThreshold}
                    onChange={(e) =>
                      onChange({ circuitBreakerAutoRemovalThreshold: e.target.value })
                    }
                    disabled={disabled}
                    hint={t(
                      'config_management.visual.sections.circuit_breaker.auto_remove_threshold_hint'
                    )}
                    error={circuitBreakerAutoRemovalThresholdError}
                  />
                </SectionStack>
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.circuit_breaker.codex_title')}
                description={t('config_management.visual.sections.circuit_breaker.codex_desc')}
              >
                {values.codexCircuitBreakerOverrides.length === 0 ? (
                  <div className={styles.emptyState}>
                    {t('config_management.visual.sections.circuit_breaker.codex_empty')}
                  </div>
                ) : (
                  <div className={styles.circuitOverrideList}>
                    {values.codexCircuitBreakerOverrides.map((entry) => {
                      const entryErrors = circuitBreakerValidationErrors?.codex?.[entry.id];
                      return (
                        <div key={entry.id} className={styles.circuitOverrideRow}>
                          <div className={styles.circuitOverrideLabel}>
                            <code>{entry.label}</code>
                          </div>
                          <Input
                            label={t('config_management.visual.sections.circuit_breaker.failure_threshold')}
                            type="number"
                            step={1}
                            min={1}
                            value={entry.failureThreshold}
                            onChange={(e) =>
                              updateCodexOverride(entry.id, { failureThreshold: e.target.value })
                            }
                            disabled={disabled}
                            error={getValidationMessage(t, entryErrors?.failureThreshold)}
                          />
                          <Input
                            label={t('config_management.visual.sections.circuit_breaker.recovery_timeout')}
                            type="number"
                            step={1}
                            min={1}
                            value={entry.recoveryTimeout}
                            onChange={(e) =>
                              updateCodexOverride(entry.id, { recoveryTimeout: e.target.value })
                            }
                            disabled={disabled}
                            error={getValidationMessage(t, entryErrors?.recoveryTimeout)}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.circuit_breaker.openai_title')}
                description={t('config_management.visual.sections.circuit_breaker.openai_desc')}
              >
                {values.openaiCircuitBreakerOverrides.length === 0 ? (
                  <div className={styles.emptyState}>
                    {t('config_management.visual.sections.circuit_breaker.openai_empty')}
                  </div>
                ) : (
                  <div className={styles.circuitOverrideList}>
                    {values.openaiCircuitBreakerOverrides.map((entry) => {
                      const entryErrors = circuitBreakerValidationErrors?.openai?.[entry.id];
                      return (
                        <div key={entry.id} className={styles.circuitOverrideRow}>
                          <div className={styles.circuitOverrideLabel}>
                            <code>{entry.label}</code>
                          </div>
                          <Input
                            label={t('config_management.visual.sections.circuit_breaker.failure_threshold')}
                            type="number"
                            step={1}
                            min={1}
                            value={entry.failureThreshold}
                            onChange={(e) =>
                              updateOpenAIOverride(entry.id, { failureThreshold: e.target.value })
                            }
                            disabled={disabled}
                            error={getValidationMessage(t, entryErrors?.failureThreshold)}
                          />
                          <Input
                            label={t('config_management.visual.sections.circuit_breaker.recovery_timeout')}
                            type="number"
                            step={1}
                            min={1}
                            value={entry.recoveryTimeout}
                            onChange={(e) =>
                              updateOpenAIOverride(entry.id, { recoveryTimeout: e.target.value })
                            }
                            disabled={disabled}
                            error={getValidationMessage(t, entryErrors?.recoveryTimeout)}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionSubsection>
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="streaming"
            ref={(node) => {
              sectionRefs.current.streaming = node;
            }}
            indexLabel="09"
            icon={<IconSatellite size={16} />}
            title={t('config_management.visual.sections.streaming.title')}
            description={t('config_management.visual.sections.streaming.description')}
          >
            <SectionStack>
              <SectionGrid>
                <FieldShell
                  label={t('config_management.visual.sections.streaming.keepalive_seconds')}
                  htmlFor={keepaliveInputId}
                  hint={t('config_management.visual.sections.streaming.keepalive_hint')}
                  hintId={keepaliveHintId}
                  error={keepaliveError}
                  errorId={keepaliveErrorId}
                >
                  <div className={styles.fieldControl}>
                    <input
                      id={keepaliveInputId}
                      className="input"
                      type="number"
                      placeholder="0"
                      value={values.streaming.keepaliveSeconds}
                      onChange={(e) =>
                        onChange({
                          streaming: {
                            ...values.streaming,
                            keepaliveSeconds: e.target.value,
                          },
                        })
                      }
                      disabled={disabled}
                    />
                    {isKeepaliveDisabled ? (
                      <span className={styles.inlinePill}>
                        {t('config_management.visual.sections.streaming.disabled')}
                      </span>
                    ) : null}
                  </div>
                </FieldShell>

                <Input
                  label={t('config_management.visual.sections.streaming.bootstrap_retries')}
                  type="number"
                  placeholder="1"
                  value={values.streaming.bootstrapRetries}
                  onChange={(e) =>
                    onChange({
                      streaming: {
                        ...values.streaming,
                        bootstrapRetries: e.target.value,
                      },
                    })
                  }
                  disabled={disabled}
                  hint={t('config_management.visual.sections.streaming.bootstrap_hint')}
                  error={bootstrapRetriesError}
                />
              </SectionGrid>

              <SectionGrid>
                <FieldShell
                  label={t('config_management.visual.sections.streaming.nonstream_keepalive')}
                  htmlFor={nonstreamKeepaliveInputId}
                  hint={t('config_management.visual.sections.streaming.nonstream_keepalive_hint')}
                  hintId={nonstreamKeepaliveHintId}
                  error={nonstreamKeepaliveError}
                  errorId={nonstreamKeepaliveErrorId}
                >
                  <div className={styles.fieldControl}>
                    <input
                      id={nonstreamKeepaliveInputId}
                      className="input"
                      type="number"
                      placeholder="0"
                      value={values.streaming.nonstreamKeepaliveInterval}
                      onChange={(e) =>
                        onChange({
                          streaming: {
                            ...values.streaming,
                            nonstreamKeepaliveInterval: e.target.value,
                          },
                        })
                      }
                      disabled={disabled}
                    />
                    {isNonstreamKeepaliveDisabled ? (
                      <span className={styles.inlinePill}>
                        {t('config_management.visual.sections.streaming.disabled')}
                      </span>
                    ) : null}
                  </div>
                </FieldShell>
              </SectionGrid>
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="payload"
            ref={(node) => {
              sectionRefs.current.payload = node;
            }}
            indexLabel="10"
            icon={<IconCode size={16} />}
            title={t('config_management.visual.sections.payload.title')}
            description={t('config_management.visual.sections.payload.description')}
          >
            <SectionStack>
              <SectionSubsection
                title={t('config_management.visual.sections.payload.default_rules')}
                description={t('config_management.visual.sections.payload.default_rules_desc')}
              >
                <PayloadRulesEditor
                  value={values.payloadDefaultRules}
                  disabled={disabled}
                  onChange={handlePayloadDefaultRulesChange}
                />
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.payload.default_raw_rules')}
                description={t('config_management.visual.sections.payload.default_raw_rules_desc')}
              >
                <PayloadRulesEditor
                  value={values.payloadDefaultRawRules}
                  disabled={disabled}
                  rawJsonValues
                  onChange={handlePayloadDefaultRawRulesChange}
                />
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.payload.override_rules')}
                description={t('config_management.visual.sections.payload.override_rules_desc')}
              >
                <PayloadRulesEditor
                  value={values.payloadOverrideRules}
                  disabled={disabled}
                  protocolFirst
                  onChange={handlePayloadOverrideRulesChange}
                />
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.payload.override_raw_rules')}
                description={t('config_management.visual.sections.payload.override_raw_rules_desc')}
              >
                <PayloadRulesEditor
                  value={values.payloadOverrideRawRules}
                  disabled={disabled}
                  protocolFirst
                  rawJsonValues
                  onChange={handlePayloadOverrideRawRulesChange}
                />
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.payload.filter_rules')}
                description={t('config_management.visual.sections.payload.filter_rules_desc')}
              >
                <PayloadFilterRulesEditor
                  value={values.payloadFilterRules}
                  disabled={disabled}
                  onChange={handlePayloadFilterRulesChange}
                />
              </SectionSubsection>
            </SectionStack>
          </ConfigSection>
        </div>
      </div>

      {shouldRenderFloatingSidebar && typeof document !== 'undefined'
        ? createPortal(
            <div ref={floatingSidebarRef} className={styles.floatingSidebarContainer}>
              <div className={styles.floatingSidebarRail}>{navContent}</div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
