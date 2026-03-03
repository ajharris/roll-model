import type {
  ConfidenceLevel,
  EntryIntegrationContext,
  IntegrationInferenceStatus,
  IntegrationProvider,
  IntegrationSettings,
  IntegrationSignalImport,
  IntegrationSignalRecord,
  IntegrationSyncFailure,
  IntegrationSyncResult,
  SessionContext,
  SessionMetrics
} from './types';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const toIsoDate = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toISOString();
};

const normalizeTag = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

const confidenceFromNumber = (value: number | undefined): ConfidenceLevel => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'medium';
  }
  if (value >= 0.8) return 'high';
  if (value <= 0.4) return 'low';
  return 'medium';
};

const mapCalendarTitleToTags = (title: string): string[] => {
  const lower = title.toLowerCase();
  const tags: string[] = [];
  if (lower.includes('fundamental')) tags.push('fundamentals');
  if (lower.includes('open mat')) tags.push('open-mat');
  if (lower.includes('competition') || lower.includes('comp')) tags.push('competition-class');
  if (lower.includes('no-gi') || lower.includes('nogi')) tags.push('no-gi');
  if (/\bgi\b/.test(lower)) tags.push('gi');
  if (lower.includes('drill')) tags.push('drilling');
  if (lower.includes('spar')) tags.push('sparring');
  return unique(tags);
};

export const defaultIntegrationSettings = (athleteId: string, nowIso: string, updatedBy: string): IntegrationSettings => ({
  athleteId,
  calendar: { enabled: false, connected: false, updatedAt: nowIso },
  wearable: { enabled: false, connected: false, updatedAt: nowIso },
  updatedAt: nowIso,
  updatedBy
});

export const parseIntegrationSettingsRecord = (item: Record<string, unknown>): IntegrationSettings | null => {
  if (item.entityType !== 'INTEGRATION_SETTINGS' || typeof item.athleteId !== 'string') {
    return null;
  }

  const nowIso = typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString();
  const fallback = defaultIntegrationSettings(
    item.athleteId,
    nowIso,
    typeof item.updatedBy === 'string' ? item.updatedBy : item.athleteId
  );
  const calendar = asRecord(item.calendar);
  const wearable = asRecord(item.wearable);
  const parseProviderConfig = (value: Record<string, unknown> | null, current: IntegrationSettings['calendar']) => ({
    enabled: Boolean(value?.enabled),
    connected: Boolean(value?.connected),
    ...(typeof value?.selectedSourceId === 'string' && value.selectedSourceId.trim()
      ? { selectedSourceId: value.selectedSourceId.trim() }
      : {}),
    ...(typeof value?.selectedSourceLabel === 'string' && value.selectedSourceLabel.trim()
      ? { selectedSourceLabel: value.selectedSourceLabel.trim() }
      : {}),
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : current.updatedAt
  });

  return {
    athleteId: fallback.athleteId,
    calendar: parseProviderConfig(calendar, fallback.calendar),
    wearable: parseProviderConfig(wearable, fallback.wearable),
    updatedAt: nowIso,
    updatedBy: typeof item.updatedBy === 'string' ? item.updatedBy : fallback.updatedBy
  };
};

export const mergeIntegrationSettings = (
  existing: IntegrationSettings,
  patch: {
    calendar?: Partial<IntegrationSettings['calendar']>;
    wearable?: Partial<IntegrationSettings['wearable']>;
  },
  nowIso: string,
  updatedBy: string
): IntegrationSettings => {
  const applyPatch = (
    current: IntegrationSettings['calendar'],
    next: Partial<IntegrationSettings['calendar']> | undefined
  ): IntegrationSettings['calendar'] => ({
    enabled: typeof next?.enabled === 'boolean' ? next.enabled : current.enabled,
    connected: typeof next?.connected === 'boolean' ? next.connected : current.connected,
    ...(typeof next?.selectedSourceId === 'string'
      ? next.selectedSourceId.trim()
        ? { selectedSourceId: next.selectedSourceId.trim() }
        : {}
      : typeof current.selectedSourceId === 'string'
        ? { selectedSourceId: current.selectedSourceId }
        : {}),
    ...(typeof next?.selectedSourceLabel === 'string'
      ? next.selectedSourceLabel.trim()
        ? { selectedSourceLabel: next.selectedSourceLabel.trim() }
        : {}
      : typeof current.selectedSourceLabel === 'string'
        ? { selectedSourceLabel: current.selectedSourceLabel }
        : {}),
    updatedAt: nowIso
  });

  return {
    athleteId: existing.athleteId,
    calendar: applyPatch(existing.calendar, patch.calendar),
    wearable: applyPatch(existing.wearable, patch.wearable),
    updatedAt: nowIso,
    updatedBy
  };
};

export const buildIntegrationSettingsRecord = (settings: IntegrationSettings): Record<string, unknown> => ({
  PK: `USER#${settings.athleteId}`,
  SK: 'INTEGRATION_SETTINGS',
  entityType: 'INTEGRATION_SETTINGS',
  ...settings
});

export const normalizeIntegrationSignalImport = (
  athleteId: string,
  raw: IntegrationSignalImport,
  capturedAt: string
): { record?: IntegrationSignalRecord; failure?: Omit<IntegrationSyncFailure, 'index'> } => {
  const provider = raw.provider;
  if (provider !== 'calendar' && provider !== 'wearable') {
    return { failure: { reason: 'Unsupported provider.', recoverable: false } };
  }

  if (provider === 'calendar') {
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const occurredAt = typeof raw.occurredAt === 'string' ? toIsoDate(raw.occurredAt) : '';
    if (!title || !occurredAt) {
      return { failure: { provider, reason: 'Calendar signals require title and occurredAt.', recoverable: true } };
    }
    const externalId = (raw.externalId?.trim() || `${occurredAt}#${title}`).slice(0, 180);
    const normalizedTags = unique([
      ...mapCalendarTitleToTags(title),
      ...(Array.isArray(raw.tags) ? raw.tags.map((value) => normalizeTag(String(value))) : [])
    ]);

    return {
      record: {
        signalId: `${provider}:${externalId}`,
        athleteId,
        provider,
        externalId,
        occurredAt,
        capturedAt,
        normalizedTags,
        title,
        ...(raw.metadata ? { metadata: raw.metadata } : {})
      }
    };
  }

  const occurredAt = typeof raw.occurredAt === 'string' ? toIsoDate(raw.occurredAt) : '';
  const dateOnly = raw.occurredAt?.trim() ? `${raw.occurredAt.trim()}T00:00:00.000Z` : '';
  const wearableOccurredAt = occurredAt || toIsoDate(dateOnly);
  if (!wearableOccurredAt || typeof raw.trained !== 'boolean') {
    return { failure: { provider, reason: 'Wearable signals require occurredAt and trained.', recoverable: true } };
  }
  const dayKey = wearableOccurredAt.slice(0, 10);
  const externalId = (raw.externalId?.trim() || dayKey).slice(0, 180);
  const normalizedTags = raw.trained ? ['trained-today'] : [];

  return {
    record: {
      signalId: `${provider}:${externalId}`,
      athleteId,
      provider,
      externalId,
      occurredAt: wearableOccurredAt,
      capturedAt,
      normalizedTags,
      trained: raw.trained,
      ...(typeof raw.confidence === 'number' ? { confidence: Math.max(0, Math.min(1, raw.confidence)) } : {}),
      ...(raw.metadata ? { metadata: raw.metadata } : {})
    }
  };
};

export const buildIntegrationSignalRecord = (signal: IntegrationSignalRecord): Record<string, unknown> => ({
  PK: `USER#${signal.athleteId}`,
  SK: `INTEGRATION_SIGNAL#${signal.provider}#${signal.externalId}`,
  entityType: 'INTEGRATION_SIGNAL',
  ...signal
});

export const parseIntegrationSignalRecord = (item: Record<string, unknown>): IntegrationSignalRecord | null => {
  if (item.entityType !== 'INTEGRATION_SIGNAL') {
    return null;
  }
  if (
    typeof item.signalId !== 'string' ||
    typeof item.athleteId !== 'string' ||
    typeof item.provider !== 'string' ||
    typeof item.externalId !== 'string' ||
    typeof item.occurredAt !== 'string' ||
    typeof item.capturedAt !== 'string'
  ) {
    return null;
  }
  const provider = item.provider as IntegrationProvider;
  if (provider !== 'calendar' && provider !== 'wearable') {
    return null;
  }

  return {
    signalId: item.signalId,
    athleteId: item.athleteId,
    provider,
    externalId: item.externalId,
    occurredAt: item.occurredAt,
    capturedAt: item.capturedAt,
    normalizedTags: Array.isArray(item.normalizedTags)
      ? item.normalizedTags.map((value) => normalizeTag(String(value))).filter(Boolean)
      : [],
    ...(typeof item.trained === 'boolean' ? { trained: item.trained } : {}),
    ...(typeof item.confidence === 'number' ? { confidence: item.confidence } : {}),
    ...(typeof item.title === 'string' ? { title: item.title } : {}),
    ...(asRecord(item.metadata) ? { metadata: asRecord(item.metadata) as Record<string, unknown> } : {})
  };
};

export const parseIntegrationSignalsFromItems = (items: Array<Record<string, unknown>>): IntegrationSignalRecord[] =>
  items
    .map((item) => parseIntegrationSignalRecord(item))
    .filter((item): item is IntegrationSignalRecord => item !== null);

export const inferIntegrationContextForEntry = (
  request: { quickAdd: { time: string }; integrationContext?: EntryIntegrationContext },
  signals: IntegrationSignalRecord[],
  nowIso: string
): EntryIntegrationContext | undefined => {
  const entryDate = request.quickAdd.time.slice(0, 10);
  if (!entryDate) {
    return request.integrationContext;
  }

  const sameDaySignals = signals.filter((signal) => signal.occurredAt.slice(0, 10) === entryDate);
  if (sameDaySignals.length === 0 && !request.integrationContext) {
    return undefined;
  }

  const prior = request.integrationContext;
  const priorByInference = new Map((prior?.inferredTags ?? []).map((tag) => [tag.inferenceId, tag]));
  const inferredTags = sameDaySignals
    .filter((signal) => signal.provider === 'calendar')
    .flatMap((signal) =>
      signal.normalizedTags.map((tag) => {
        const inferenceId = `${signal.signalId}:${tag}`;
        const previous = priorByInference.get(inferenceId);
        const status: IntegrationInferenceStatus = previous?.status ?? 'suggested';
        return {
          inferenceId,
          provider: signal.provider,
          tag,
          confidence: (signal.title && signal.title.trim() ? 'high' : 'medium') as ConfidenceLevel,
          status,
          inferredFromSignalId: signal.signalId,
          inferredAt: nowIso,
          ...(previous?.note ? { note: previous.note } : {}),
          ...(previous?.overriddenTag ? { overriddenTag: normalizeTag(previous.overriddenTag) } : {}),
          ...(previous?.reviewedAt ? { reviewedAt: previous.reviewedAt } : {}),
          ...(previous?.reviewedByRole ? { reviewedByRole: previous.reviewedByRole } : {})
        };
      })
    );

  const wearableSignal = sameDaySignals.find((signal) => signal.provider === 'wearable');
  const wearable = wearableSignal
    ? {
        signalId: wearableSignal.signalId,
        date: wearableSignal.occurredAt.slice(0, 10),
        trained: Boolean(wearableSignal.trained),
        confidence: confidenceFromNumber(wearableSignal.confidence),
        status: prior?.wearable?.signalId === wearableSignal.signalId ? prior.wearable.status : 'suggested',
        ...(prior?.wearable?.note ? { note: prior.wearable.note } : {}),
        ...(prior?.wearable?.reviewedAt ? { reviewedAt: prior.wearable.reviewedAt } : {}),
        ...(prior?.wearable?.reviewedByRole ? { reviewedByRole: prior.wearable.reviewedByRole } : {})
      }
    : prior?.wearable;

  const confirmedTags = unique([
    ...inferredTags.flatMap((tag) => {
      if (tag.status === 'confirmed') return [tag.tag];
      if (tag.status === 'overridden' && tag.overriddenTag) return [normalizeTag(tag.overriddenTag)];
      return [];
    }),
    ...(wearable?.trained && (wearable.status === 'confirmed' || wearable.status === 'overridden') ? ['trained-today'] : [])
  ]);

  return {
    inferredTags,
    ...(wearable ? { wearable } : {}),
    confirmedTags,
    sourceSignalIds: unique([
      ...sameDaySignals.map((signal) => signal.signalId),
      ...(prior?.sourceSignalIds ?? [])
    ]),
    updatedAt: nowIso
  };
};

type IntegrationMergeTarget = {
  sessionContext?: SessionContext;
  sessionMetrics: SessionMetrics;
  integrationContext?: EntryIntegrationContext;
};

export const mergeConfirmedIntegrationTags = <T extends IntegrationMergeTarget>(input: T): T => {
  const confirmedTags = input.integrationContext?.confirmedTags ?? [];
  if (confirmedTags.length === 0) {
    return input;
  }

  const existingContextTags = input.sessionContext?.tags ?? [];
  return {
    ...input,
    sessionContext: {
      ...(input.sessionContext ?? { injuryNotes: [], tags: [] }),
      injuryNotes: input.sessionContext?.injuryNotes ?? [],
      tags: unique([...existingContextTags, ...confirmedTags])
    },
    sessionMetrics: {
      ...input.sessionMetrics,
      tags: unique([...(input.sessionMetrics.tags ?? []), ...confirmedTags])
    }
  } as T;
};

export const summarizeSyncResult = (imported: number, duplicates: number, failures: IntegrationSyncFailure[]): IntegrationSyncResult => ({
  imported,
  duplicates,
  failures,
  partialFailure: failures.length > 0
});
