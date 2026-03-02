import { createHash } from 'crypto';

import { v4 as uuidv4 } from 'uuid';

import { queryItems } from './db';
import { parseEntryRecord, withCurrentEntrySchemaVersion } from './entries';
import { getOpenAIApiKey } from './openai';
import { ApiError } from './responses';
import { extractStructuredMetadata } from './structuredExtraction';
import type {
  CoachReviewState,
  Entry,
  EntryQuickAdd,
  EntrySections,
  EntryStructuredFieldKey,
  EntryStructuredFields,
  LegacyImportCommitRequest,
  LegacyImportDedupStatus,
  LegacyImportDraftEntry,
  LegacyImportMode,
  LegacyImportPreview,
  LegacyImportPreviewRequest,
  LegacyImportSourceType,
  SessionMetrics,
} from './types';

const ENTRY_TAG_VALUES = new Set([
  'guard-type',
  'top',
  'bottom',
  'submission',
  'sweep',
  'pass',
  'escape',
  'takedown',
] as const);

const STRUCTURED_FIELDS: EntryStructuredFieldKey[] = ['position', 'technique', 'outcome', 'problem', 'cue'];

const MARKDOWN_HEADING_REGEX = /^#{1,6}\s+/;
const BULLET_REGEX = /^[-*]\s+/;

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizeForHash = (value: string): string => normalizeWhitespace(value.toLowerCase());

const hashContent = (value: string): string => createHash('sha256').update(value).digest('hex');

const invalid = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400,
  });
};

const splitFrontMatter = (raw: string): { meta: Record<string, string>; body: string } => {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('---\n')) {
    return { meta: {}, body: raw };
  }

  const end = trimmed.indexOf('\n---\n', 4);
  if (end < 0) {
    return { meta: {}, body: raw };
  }

  const frontMatter = trimmed.slice(4, end);
  const body = trimmed.slice(end + 5);
  const meta: Record<string, string> = {};
  frontMatter.split(/\r?\n/).forEach((line) => {
    const idx = line.indexOf(':');
    if (idx < 1) return;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key && value) {
      meta[key] = value;
    }
  });

  return { meta, body };
};

const stripMarkdown = (value: string): string =>
  value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[>*_~]/g, ' ')
    .replace(MARKDOWN_HEADING_REGEX, '')
    .replace(BULLET_REGEX, '')
    .replace(/\r/g, '');

const stripHtml = (value: string): string =>
  value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ');

const parseDate = (value: string | undefined, fallback: string): string => {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return fallback;
  return new Date(parsed).toISOString();
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const parsePartners = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
};

const detectTags = (text: string): LegacyImportDraftEntry['tags'] => {
  const lowered = text.toLowerCase();
  const output: LegacyImportDraftEntry['tags'] = [];
  if (/guard/.test(lowered)) output.push('guard-type');
  if (/top\s+game|mount\s+top|side\s+control\s+top/.test(lowered)) output.push('top');
  if (/bottom\s+game|guard\s+bottom|mounted/.test(lowered)) output.push('bottom');
  if (/choke|armbar|kimura|submission|triangle|guillotine/.test(lowered)) output.push('submission');
  if (/sweep|reversal/.test(lowered)) output.push('sweep');
  if (/pass|passing/.test(lowered)) output.push('pass');
  if (/escape|escaped|reguard/.test(lowered)) output.push('escape');
  if (/single\s+leg|double\s+leg|takedown|wrestling/.test(lowered)) output.push('takedown');
  return [...new Set(output)];
};

const detectTechniqueMentions = (raw: string): string[] => {
  const byBullet = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 12);

  const byPattern = [
    ...raw.matchAll(/\b(knee\s*(?:cut|slice)|armbar|triangle\s+choke|kimura|guillotine|single\s+leg|double\s+leg|hip\s+escape|upa\s+escape)\b/gi),
  ]
    .map((match) => normalizeWhitespace(match[0]))
    .slice(0, 12);

  return [...new Set([...byBullet, ...byPattern])].slice(0, 16);
};

const detectGiOrNoGi = (text: string): SessionMetrics['giOrNoGi'] => {
  const lowered = text.toLowerCase();
  if (/\bno[ -]?gi\b/.test(lowered)) return 'no-gi';
  return 'gi';
};

const detectIntensity = (text: string): number => {
  const explicit = text.match(/intensity\s*[:=-]?\s*(\d{1,2})/i);
  if (explicit) {
    const parsed = Number.parseInt(explicit[1], 10);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.min(10, parsed));
    }
  }

  if (/exhausted|gassed|dead tired|very hard roll/.test(text.toLowerCase())) return 8;
  if (/light drill|flow roll/.test(text.toLowerCase())) return 4;
  return 6;
};

const parseLegacyContent = (
  sourceType: LegacyImportSourceType,
  rawContent: string,
  sourceTitle: string | undefined,
  nowIso: string,
): LegacyImportDraftEntry => {
  const normalizedRaw = sourceType === 'google-doc' ? stripHtml(rawContent) : rawContent;
  const frontMatterParsed = splitFrontMatter(normalizedRaw);
  const cleaned = normalizeWhitespace(stripMarkdown(frontMatterParsed.body));
  const sectionsShared = frontMatterParsed.meta.shared ?? frontMatterParsed.meta.summary ?? cleaned.slice(0, 1400);
  const sectionsPrivate = frontMatterParsed.meta.private ?? frontMatterParsed.meta.notes ?? cleaned.slice(0, 1600);

  const roundsFromText = cleaned.match(/(\d{1,2})\s+rounds?/i)?.[1];
  const durationFromText = cleaned.match(/(\d{2,3})\s*(?:min|minutes)/i)?.[1];

  const draft: LegacyImportDraftEntry = {
    quickAdd: {
      time: parseDate(frontMatterParsed.meta.date ?? frontMatterParsed.meta.time, nowIso),
      class: frontMatterParsed.meta.class ?? frontMatterParsed.meta.session ?? sourceTitle ?? 'Imported legacy note',
      gym: frontMatterParsed.meta.gym ?? 'Imported source',
      partners: parsePartners(frontMatterParsed.meta.partners),
      rounds: parseNumber(frontMatterParsed.meta.rounds ?? roundsFromText, 0),
      notes: normalizeWhitespace(frontMatterParsed.meta.quickaddnotes ?? cleaned.slice(0, 600)),
    },
    tags: detectTags(cleaned),
    sections: {
      shared: normalizeWhitespace(sectionsShared),
      private: normalizeWhitespace(sectionsPrivate),
    },
    sessionMetrics: {
      durationMinutes: parseNumber(frontMatterParsed.meta.duration ?? durationFromText, 60),
      intensity: detectIntensity(cleaned),
      rounds: parseNumber(frontMatterParsed.meta.rounds ?? roundsFromText, 0),
      giOrNoGi: detectGiOrNoGi(cleaned),
      tags: detectTags(cleaned),
    },
    rawTechniqueMentions: detectTechniqueMentions(frontMatterParsed.body),
  };

  if (!draft.quickAdd.notes) {
    draft.quickAdd.notes = draft.sections.shared || 'Imported note';
  }

  return draft;
};

type GPTMappedPreview = {
  structured?: EntryStructuredFields;
  tags?: LegacyImportDraftEntry['tags'];
  rawTechniqueMentions?: string[];
  quickAdd?: Partial<EntryQuickAdd>;
  sessionMetrics?: Partial<SessionMetrics>;
  confidenceFlags?: Array<{ field: EntryStructuredFieldKey; confidence: 'high' | 'medium' | 'low'; note?: string }>;
};

const parseGptPreview = (text: string): GPTMappedPreview | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const value = parsed as Record<string, unknown>;
  const structuredRaw = value.structured;
  const structured: EntryStructuredFields = {};
  if (structuredRaw && typeof structuredRaw === 'object' && !Array.isArray(structuredRaw)) {
    for (const field of STRUCTURED_FIELDS) {
      const maybe = (structuredRaw as Record<string, unknown>)[field];
      if (typeof maybe === 'string' && maybe.trim()) {
        structured[field] = maybe.trim();
      }
    }
  }

  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is LegacyImportDraftEntry['tags'][number] => typeof tag === 'string' && ENTRY_TAG_VALUES.has(tag as LegacyImportDraftEntry['tags'][number]))
    : undefined;

  const rawTechniqueMentions = Array.isArray(value.rawTechniqueMentions)
    ? value.rawTechniqueMentions.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : undefined;

  const quickAdd = value.quickAdd && typeof value.quickAdd === 'object' && !Array.isArray(value.quickAdd)
    ? (value.quickAdd as Partial<EntryQuickAdd>)
    : undefined;
  const sessionMetrics = value.sessionMetrics && typeof value.sessionMetrics === 'object' && !Array.isArray(value.sessionMetrics)
    ? (value.sessionMetrics as Partial<SessionMetrics>)
    : undefined;

  const confidenceFlags = Array.isArray(value.confidenceFlags)
    ? value.confidenceFlags
        .map((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
          const raw = item as Record<string, unknown>;
          const field = typeof raw.field === 'string' ? raw.field.trim() : '';
          const confidence = typeof raw.confidence === 'string' ? raw.confidence.trim() : '';
          if (!STRUCTURED_FIELDS.includes(field as EntryStructuredFieldKey)) return null;
          if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') return null;
          return {
            field: field as EntryStructuredFieldKey,
            confidence: confidence as 'high' | 'medium' | 'low',
            ...(typeof raw.note === 'string' && raw.note.trim() ? { note: raw.note.trim() } : {}),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : undefined;

  return {
    ...(Object.keys(structured).length > 0 ? { structured } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(rawTechniqueMentions && rawTechniqueMentions.length > 0 ? { rawTechniqueMentions } : {}),
    ...(quickAdd ? { quickAdd } : {}),
    ...(sessionMetrics ? { sessionMetrics } : {}),
    ...(confidenceFlags ? { confidenceFlags } : {}),
  };
};

const requestGptMapping = async (request: LegacyImportPreviewRequest): Promise<GPTMappedPreview | null> => {
  const apiKey = await getOpenAIApiKey();
  const prompt = [
    'Map this BJJ legacy training note into structured session fields.',
    'Return strict JSON only with keys: structured, tags, rawTechniqueMentions, quickAdd, sessionMetrics, confidenceFlags.',
    'structured can include: position, technique, outcome, problem, cue.',
    'tags must be from: guard-type, top, bottom, submission, sweep, pass, escape, takedown.',
    'sessionMetrics.giOrNoGi must be gi or no-gi.',
    'confidenceFlags must include field + confidence (high/medium/low) and optional note.',
    `sourceType: ${request.sourceType}`,
    `sourceTitle: ${request.sourceTitle ?? ''}`,
    'raw note:',
    request.rawContent,
  ].join('\n');

  const gptResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: prompt }],
        },
      ],
    }),
  });

  if (!gptResponse.ok) {
    throw new Error('GPT mapping request failed');
  }

  const payload = (await gptResponse.json()) as { output_text?: string };
  if (!payload.output_text) {
    return null;
  }

  return parseGptPreview(payload.output_text);
};

const mergeDraftWithGpt = (draft: LegacyImportDraftEntry, gpt: GPTMappedPreview | null): LegacyImportDraftEntry => {
  if (!gpt) {
    return draft;
  }

  return {
    ...draft,
    quickAdd: {
      ...draft.quickAdd,
      ...(gpt.quickAdd ?? {}),
      notes: typeof gpt.quickAdd?.notes === 'string' && gpt.quickAdd.notes.trim() ? gpt.quickAdd.notes.trim() : draft.quickAdd.notes,
    },
    sessionMetrics: {
      ...draft.sessionMetrics,
      ...(gpt.sessionMetrics ?? {}),
      giOrNoGi: gpt.sessionMetrics?.giOrNoGi === 'no-gi' ? 'no-gi' : gpt.sessionMetrics?.giOrNoGi === 'gi' ? 'gi' : draft.sessionMetrics.giOrNoGi,
      intensity:
        typeof gpt.sessionMetrics?.intensity === 'number' && Number.isFinite(gpt.sessionMetrics.intensity)
          ? Math.max(1, Math.min(10, Math.round(gpt.sessionMetrics.intensity)))
          : draft.sessionMetrics.intensity,
    },
    tags: gpt.tags && gpt.tags.length > 0 ? [...new Set(gpt.tags)] : draft.tags,
    rawTechniqueMentions:
      gpt.rawTechniqueMentions && gpt.rawTechniqueMentions.length > 0
        ? [...new Set(gpt.rawTechniqueMentions)]
        : draft.rawTechniqueMentions,
    ...(gpt.structured ? { structured: gpt.structured } : {}),
  };
};

const buildPreviewConfidence = (
  extractionFlags: LegacyImportPreview['confidenceFlags'],
  gptFlags: GPTMappedPreview['confidenceFlags'] | undefined,
): LegacyImportPreview['confidenceFlags'] => {
  if (!gptFlags || gptFlags.length === 0) {
    return extractionFlags;
  }

  const byField = new Map(extractionFlags.map((flag) => [flag.field, flag]));
  gptFlags.forEach((flag) => {
    byField.set(flag.field, flag);
  });
  return [...byField.values()];
};

const listEntriesForAthlete = async (athleteId: string): Promise<Entry[]> => {
  const result = await queryItems({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :entryPrefix)',
    ExpressionAttributeValues: {
      ':pk': `USER#${athleteId}`,
      ':entryPrefix': 'ENTRY#',
    },
    ScanIndexForward: false,
  });

  return (
    result.Items?.filter((item) => item.entityType === 'ENTRY').map((item) => parseEntryRecord(item as Record<string, unknown>)) ?? []
  );
};

const findPotentialDuplicates = (
  existingEntries: Entry[],
  previewDraft: LegacyImportDraftEntry,
  sourceHash: string,
): { dedupStatus: LegacyImportDedupStatus; duplicateEntryIds: string[] } => {
  const sameSource = existingEntries.filter((entry) => entry.importMetadata?.source.contentHash === sourceHash);
  if (sameSource.length > 0) {
    return {
      dedupStatus: 'duplicate-source',
      duplicateEntryIds: sameSource.map((entry) => entry.entryId),
    };
  }

  const previewNotes = normalizeForHash(previewDraft.quickAdd.notes);
  const previewDate = previewDraft.quickAdd.time.slice(0, 10);
  const contentMatches = existingEntries.filter((entry) => {
    const entryNotes = normalizeForHash(entry.quickAdd.notes);
    const sameDate = entry.quickAdd.time.slice(0, 10) === previewDate;
    if (!sameDate) {
      return false;
    }
    if (!previewNotes || !entryNotes) {
      return false;
    }
    return entryNotes.includes(previewNotes.slice(0, 80)) || previewNotes.includes(entryNotes.slice(0, 80));
  });

  if (contentMatches.length > 0) {
    return {
      dedupStatus: 'duplicate-content',
      duplicateEntryIds: contentMatches.map((entry) => entry.entryId),
    };
  }

  return {
    dedupStatus: 'new',
    duplicateEntryIds: [],
  };
};

const mergeSections = (base: EntrySections, override: Partial<EntrySections> | undefined): EntrySections => ({
  shared: typeof override?.shared === 'string' && override.shared.trim() ? override.shared.trim() : base.shared,
  private: typeof override?.private === 'string' && override.private.trim() ? override.private.trim() : base.private,
});

const mergeQuickAdd = (base: EntryQuickAdd, override: Partial<EntryQuickAdd> | undefined): EntryQuickAdd => ({
  time: typeof override?.time === 'string' && override.time.trim() ? override.time.trim() : base.time,
  class: typeof override?.class === 'string' && override.class.trim() ? override.class.trim() : base.class,
  gym: typeof override?.gym === 'string' && override.gym.trim() ? override.gym.trim() : base.gym,
  partners: Array.isArray(override?.partners)
    ? override.partners.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : base.partners,
  rounds:
    typeof override?.rounds === 'number' && Number.isFinite(override.rounds)
      ? Math.max(0, Math.round(override.rounds))
      : base.rounds,
  notes: typeof override?.notes === 'string' && override.notes.trim() ? override.notes.trim() : base.notes,
});

const mergeSessionMetrics = (base: SessionMetrics, override: Partial<SessionMetrics> | undefined): SessionMetrics => ({
  durationMinutes:
    typeof override?.durationMinutes === 'number' && Number.isFinite(override.durationMinutes)
      ? Math.max(1, Math.round(override.durationMinutes))
      : base.durationMinutes,
  intensity:
    typeof override?.intensity === 'number' && Number.isFinite(override.intensity)
      ? Math.max(1, Math.min(10, Math.round(override.intensity)))
      : base.intensity,
  rounds:
    typeof override?.rounds === 'number' && Number.isFinite(override.rounds)
      ? Math.max(0, Math.round(override.rounds))
      : base.rounds,
  giOrNoGi: override?.giOrNoGi === 'no-gi' ? 'no-gi' : override?.giOrNoGi === 'gi' ? 'gi' : base.giOrNoGi,
  tags: Array.isArray(override?.tags)
    ? override.tags.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : base.tags,
});

const sanitizeTagList = (tags: unknown): LegacyImportDraftEntry['tags'] => {
  if (!Array.isArray(tags)) {
    return [];
  }

  return [...new Set(tags.filter((item): item is LegacyImportDraftEntry['tags'][number] => typeof item === 'string' && ENTRY_TAG_VALUES.has(item as LegacyImportDraftEntry['tags'][number])))];
};

const mergeCoachReview = (override: CoachReviewState | undefined, requiresReview: boolean): CoachReviewState | undefined => {
  if (!override && !requiresReview) {
    return undefined;
  }

  return {
    requiresReview,
    ...(override?.coachNotes?.trim() ? { coachNotes: override.coachNotes.trim() } : {}),
    ...(override?.reviewedAt?.trim() ? { reviewedAt: override.reviewedAt.trim() } : {}),
  };
};

export const buildLegacyImportPreview = async (
  athleteId: string,
  request: LegacyImportPreviewRequest,
): Promise<LegacyImportPreview> => {
  if (!request.rawContent || !request.rawContent.trim()) {
    invalid('rawContent is required.');
  }
  if (request.sourceType !== 'markdown' && request.sourceType !== 'google-doc') {
    invalid('sourceType must be markdown or google-doc.');
  }

  const nowIso = new Date().toISOString();
  const capturedRaw = request.rawContent.trim();
  const sourceHash = hashContent(normalizeForHash(capturedRaw));
  const source = {
    sourceType: request.sourceType,
    ...(request.sourceId?.trim() ? { sourceId: request.sourceId.trim() } : {}),
    ...(request.sourceUrl?.trim() ? { sourceUrl: request.sourceUrl.trim() } : {}),
    ...(request.sourceTitle?.trim() ? { sourceTitle: request.sourceTitle.trim() } : {}),
    capturedAt: nowIso,
    contentHash: sourceHash,
  };

  const heuristicDraft = parseLegacyContent(request.sourceType, capturedRaw, request.sourceTitle, nowIso);
  const warnings: string[] = [];
  let mode: LegacyImportMode = 'heuristic';
  let gptMapped: GPTMappedPreview | null = null;

  if (request.useGpt !== false) {
    try {
      gptMapped = await requestGptMapping(request);
      if (gptMapped) {
        mode = 'gpt-assisted';
      }
    } catch {
      warnings.push('GPT mapping unavailable. Preview uses heuristic parsing.');
    }
  }

  const draft = mergeDraftWithGpt(heuristicDraft, gptMapped);
  const extraction = extractStructuredMetadata(
    {
      quickAdd: draft.quickAdd,
      sections: draft.sections,
      rawTechniqueMentions: draft.rawTechniqueMentions,
      structured: draft.structured,
      structuredMetadataConfirmations: draft.structuredMetadataConfirmations,
    },
    { nowIso, actorRole: 'athlete' },
  );

  const existing = await listEntriesForAthlete(athleteId);
  const dedupe = findPotentialDuplicates(existing, draft, sourceHash);
  const confidenceFlags = buildPreviewConfidence(extraction.extraction.confidenceFlags, gptMapped?.confidenceFlags);

  const conflictStatus =
    dedupe.dedupStatus === 'new'
      ? confidenceFlags.some((flag) => flag.confidence === 'low')
        ? 'requires-review'
        : 'none'
      : 'possible-duplicate';

  return {
    importId: uuidv4(),
    mode,
    draftEntry: {
      ...draft,
      structured: extraction.structured,
    },
    structuredExtraction: {
      ...extraction.extraction,
      confidenceFlags,
    },
    confidenceFlags,
    dedupStatus: dedupe.dedupStatus,
    duplicateEntryIds: dedupe.duplicateEntryIds,
    conflictStatus,
    requiresCoachReview: conflictStatus !== 'none',
    source,
    warnings,
  };
};

export const finalizeLegacyImportEntry = (
  athleteId: string,
  request: LegacyImportCommitRequest,
  options?: { nowIso?: string },
): Entry => {
  const nowIso = options?.nowIso ?? new Date().toISOString();
  const preview = request.preview;
  if (!preview || !preview.importId) {
    invalid('preview payload is required.');
  }

  if (preview.dedupStatus !== 'new' && request.duplicateResolution !== 'allow') {
    invalid('Potential duplicate detected. Set duplicateResolution to allow or skip this import.');
  }

  if (preview.conflictStatus === 'requires-review' && request.conflictResolution !== 'commit' && request.conflictResolution !== 'save-as-draft') {
    invalid('conflictResolution must be commit or save-as-draft for review-required imports.');
  }

  const mergedStructured: EntryStructuredFields | undefined = {
    ...(preview.draftEntry.structured ?? {}),
    ...(request.corrections?.structured ?? {}),
  };

  const draft = {
    quickAdd: mergeQuickAdd(preview.draftEntry.quickAdd, request.corrections?.quickAdd),
    tags: sanitizeTagList(request.corrections?.tags ?? preview.draftEntry.tags),
    structured: mergedStructured,
    structuredMetadataConfirmations:
      request.corrections?.confirmations && request.corrections.confirmations.length > 0
        ? request.corrections.confirmations
        : preview.draftEntry.structuredMetadataConfirmations,
    sections: mergeSections(preview.draftEntry.sections, request.corrections?.sections),
    sessionMetrics: mergeSessionMetrics(preview.draftEntry.sessionMetrics, request.corrections?.sessionMetrics),
    rawTechniqueMentions:
      request.corrections?.rawTechniqueMentions && request.corrections.rawTechniqueMentions.length > 0
        ? [...new Set(request.corrections.rawTechniqueMentions.map((item) => item.trim()).filter(Boolean))]
        : preview.draftEntry.rawTechniqueMentions,
  };

  const extraction = extractStructuredMetadata(
    {
      quickAdd: draft.quickAdd,
      sections: draft.sections,
      rawTechniqueMentions: draft.rawTechniqueMentions,
      structured: draft.structured,
      structuredMetadataConfirmations: draft.structuredMetadataConfirmations,
    },
    { nowIso, actorRole: 'athlete' },
  );

  return withCurrentEntrySchemaVersion({
    entryId: uuidv4(),
    athleteId,
    createdAt: nowIso,
    updatedAt: nowIso,
    quickAdd: draft.quickAdd,
    tags: draft.tags,
    structured: extraction.structured,
    structuredExtraction: extraction.extraction,
    sections: draft.sections,
    sessionMetrics: draft.sessionMetrics,
    rawTechniqueMentions: draft.rawTechniqueMentions,
    importMetadata: {
      importId: preview.importId,
      mode: preview.mode,
      source: preview.source,
      dedupStatus: preview.dedupStatus === 'new' ? 'override-imported' : preview.dedupStatus,
      conflictStatus: preview.conflictStatus,
      requiresCoachReview: request.corrections?.requiresCoachReview ?? preview.requiresCoachReview,
      ...(mergeCoachReview(
        request.corrections?.coachReview,
        request.corrections?.requiresCoachReview ?? preview.requiresCoachReview,
      )
        ? {
            coachReview: mergeCoachReview(
              request.corrections?.coachReview,
              request.corrections?.requiresCoachReview ?? preview.requiresCoachReview,
            ),
          }
        : {}),
    },
  });
};
