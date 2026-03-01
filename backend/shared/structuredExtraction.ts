import type {
  ConfidenceLevel,
  CreateEntryRequest,
  EntryStructuredExtraction,
  EntryStructuredFieldKey,
  EntryStructuredFields,
  EntryStructuredMetadataConfirmation,
  EntryStructuredSuggestion,
} from './types';

const STRUCTURED_FIELDS: EntryStructuredFieldKey[] = ['position', 'technique', 'outcome', 'problem', 'cue'];

const POSITION_PATTERNS: Array<{ pattern: RegExp; value: string; confidence: ConfidenceLevel }> = [
  { pattern: /half\s*guard\s*(bottom|from bottom)?/i, value: 'half guard bottom', confidence: 'high' },
  { pattern: /half\s*guard\s*(top|from top)/i, value: 'half guard top', confidence: 'high' },
  { pattern: /closed\s*guard/i, value: 'closed guard', confidence: 'high' },
  { pattern: /open\s*guard/i, value: 'open guard', confidence: 'medium' },
  { pattern: /side\s*control\s*(bottom|from bottom)/i, value: 'side control bottom', confidence: 'high' },
  { pattern: /side\s*control\s*(top|from top)?/i, value: 'side control top', confidence: 'medium' },
  { pattern: /mount\s*(bottom|from bottom)/i, value: 'mount bottom', confidence: 'high' },
  { pattern: /mount\s*(top|from top)?/i, value: 'mount top', confidence: 'medium' },
  { pattern: /back\s*(control|takes?|attacks?)/i, value: 'back control', confidence: 'medium' },
  { pattern: /turtle/i, value: 'turtle', confidence: 'medium' },
  { pattern: /de\s*la\s*riva/i, value: 'de la riva guard', confidence: 'high' },
  { pattern: /single\s*leg\s*x/i, value: 'single leg x', confidence: 'high' },
];

const TECHNIQUE_PATTERNS: Array<{ pattern: RegExp; value: string; confidence: ConfidenceLevel }> = [
  { pattern: /knee\s*(cut|slice)/i, value: 'knee cut pass', confidence: 'high' },
  { pattern: /cross\s*collar\s*choke/i, value: 'cross collar choke', confidence: 'high' },
  { pattern: /arm\s*bar|juji\s*gatame/i, value: 'armbar', confidence: 'high' },
  { pattern: /triangle/i, value: 'triangle choke', confidence: 'high' },
  { pattern: /guillotine/i, value: 'guillotine', confidence: 'high' },
  { pattern: /kimura/i, value: 'kimura', confidence: 'high' },
  { pattern: /omoplata/i, value: 'omoplata', confidence: 'high' },
  { pattern: /single\s*leg/i, value: 'single leg takedown', confidence: 'medium' },
  { pattern: /double\s*leg/i, value: 'double leg takedown', confidence: 'medium' },
  { pattern: /hip\s*escape|shrimp/i, value: 'hip escape', confidence: 'medium' },
  { pattern: /bridge\s*and\s*roll|upa/i, value: 'upa escape', confidence: 'medium' },
];

const OUTCOME_PATTERNS: Array<{ pattern: RegExp; value: string; confidence: ConfidenceLevel }> = [
  { pattern: /tapped|submitted|got\s+the\s+tap|finish(ed)?/i, value: 'submission finish', confidence: 'high' },
  { pattern: /sweep(ed)?/i, value: 'sweep success', confidence: 'high' },
  { pattern: /pass(ed)?/i, value: 'guard pass success', confidence: 'medium' },
  { pattern: /escap(ed|e)\s+(mount|side control|back)/i, value: 'escape success', confidence: 'high' },
  { pattern: /got\s+passed|pass\s+was\s+too\s+easy/i, value: 'guard passed', confidence: 'high' },
  { pattern: /got\s+swept/i, value: 'swept', confidence: 'high' },
  { pattern: /stalled|couldn't?\s+finish/i, value: 'stalled attack', confidence: 'medium' },
];

const CONCEPT_PATTERNS = [
  /frame(s|ing)?/i,
  /underhook(s)?/i,
  /inside\s+position/i,
  /timing/i,
  /distance\s+management/i,
  /hip\s+line/i,
  /posture/i,
  /head\s+position/i,
  /base/i,
];

const CONDITIONING_PATTERNS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /gassed|gas\s+tank|out\s+of\s+breath|cardio/i, value: 'cardio fatigue' },
  { pattern: /forearm(s)?\s+pump|grip\s+fatigue/i, value: 'grip fatigue' },
  { pattern: /slow\s+reaction|late\s+reaction/i, value: 'reaction speed drop' },
  { pattern: /hips?\s+(felt\s+)?heavy/i, value: 'hip mobility fatigue' },
];

const FAILURE_SNIPPET_REGEX =
  /(?:couldn't?|failed\s+to|kept\s+getting|kept\s+losing|problem\s+was|issue\s+was|got\s+passed|got\s+swept)([^.\n]{0,120})/gi;

const normalizeSpace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const truncate = (value: string, max = 140): string => {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
};

const maybePrompt = (field: EntryStructuredFieldKey, value: string, confidence: ConfidenceLevel): string | undefined => {
  if (confidence === 'low') {
    return undefined;
  }

  return `This sounds like ${value} for ${field}. Confirm?`;
};

const normalizeFieldValue = (value: string): string => normalizeSpace(value).toLowerCase();

const pickByPatterns = (
  text: string,
  patterns: Array<{ pattern: RegExp; value: string; confidence: ConfidenceLevel }>
): { value: string; confidence: ConfidenceLevel; sourceExcerpt?: string } | null => {
  for (const candidate of patterns) {
    const match = text.match(candidate.pattern);
    if (match) {
      return {
        value: candidate.value,
        confidence: candidate.confidence,
        sourceExcerpt: truncate(match[0])
      };
    }
  }
  return null;
};

const pickTechnique = (text: string, rawTechniqueMentions: string[]): { value: string; confidence: ConfidenceLevel; sourceExcerpt?: string } | null => {
  const fromMentions = rawTechniqueMentions.map((item) => normalizeSpace(item)).find(Boolean);
  if (fromMentions) {
    return {
      value: fromMentions,
      confidence: 'high',
      sourceExcerpt: truncate(fromMentions)
    };
  }

  return pickByPatterns(text, TECHNIQUE_PATTERNS);
};

const extractFailures = (text: string): string[] => {
  const values: string[] = [];
  let match: RegExpExecArray | null = FAILURE_SNIPPET_REGEX.exec(text);
  while (match) {
    const snippet = normalizeSpace(`${match[0]}${match[1] ?? ''}`.replace(/[.,;:]+$/, ''));
    if (snippet) values.push(snippet);
    match = FAILURE_SNIPPET_REGEX.exec(text);
  }

  return [...new Set(values)].slice(0, 3);
};

const extractConcepts = (text: string): string[] => {
  const found = new Set<string>();
  for (const pattern of CONCEPT_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[0]) {
      found.add(normalizeSpace(match[0].toLowerCase()));
    }
  }
  return [...found].slice(0, 5);
};

const extractConditioningIssues = (text: string): string[] => {
  const found = new Set<string>();
  for (const candidate of CONDITIONING_PATTERNS) {
    if (candidate.pattern.test(text)) {
      found.add(candidate.value);
    }
  }
  return [...found].slice(0, 3);
};

const extractProblem = (text: string, failures: string[]): { value: string; confidence: ConfidenceLevel; sourceExcerpt?: string } | null => {
  const cue = text.match(/(?:problem|issue|kept\s+getting|kept\s+losing|couldn't?)([^.\n]{3,140})/i);
  if (cue?.[0]) {
    return {
      value: truncate(normalizeSpace(cue[0])),
      confidence: 'medium',
      sourceExcerpt: truncate(cue[0])
    };
  }

  if (failures[0]) {
    return {
      value: failures[0],
      confidence: 'medium',
      sourceExcerpt: truncate(failures[0])
    };
  }

  return null;
};

const extractCue = (text: string): { value: string; confidence: ConfidenceLevel; sourceExcerpt?: string } | null => {
  const cue = text.match(/(?:cue|focus|remember|one\s+thing|key|next\s+time)\s*[:-]?\s*([^.\n]{3,140})/i);
  if (cue?.[1]) {
    return {
      value: truncate(normalizeSpace(cue[1])),
      confidence: 'high',
      sourceExcerpt: truncate(cue[0])
    };
  }

  const shorter = text.match(/(pummel\s+first|frame\s+first|elbow\s+knee\s+connection|head\s+position\s+first)/i);
  if (shorter?.[0]) {
    return {
      value: normalizeSpace(shorter[0]),
      confidence: 'medium',
      sourceExcerpt: truncate(shorter[0])
    };
  }

  return null;
};

const applyStructuredOverrides = (
  suggestions: EntryStructuredSuggestion[],
  structured: EntryStructuredFields,
  nowIso: string,
  actorRole: 'athlete' | 'coach'
): EntryStructuredSuggestion[] => {
  const byField = new Map<EntryStructuredFieldKey, EntryStructuredSuggestion>(suggestions.map((item) => [item.field, item]));

  for (const field of STRUCTURED_FIELDS) {
    const manual = structured[field]?.trim();
    if (!manual) {
      continue;
    }

    const existing = byField.get(field);
    if (!existing) {
      byField.set(field, {
        field,
        value: manual,
        confidence: 'high',
        status: 'corrected',
        correctionValue: manual,
        updatedAt: nowIso,
        updatedByRole: actorRole,
      });
      continue;
    }

    if (normalizeFieldValue(existing.value) === normalizeFieldValue(manual)) {
      byField.set(field, {
        ...existing,
        status: 'confirmed',
        updatedAt: nowIso,
        updatedByRole: actorRole,
      });
      continue;
    }

    byField.set(field, {
      ...existing,
      status: 'corrected',
      correctionValue: manual,
      updatedAt: nowIso,
      updatedByRole: actorRole,
    });
  }

  return STRUCTURED_FIELDS.map((field) => byField.get(field)).filter((item): item is EntryStructuredSuggestion => Boolean(item));
};

const applyConfirmations = (
  suggestions: EntryStructuredSuggestion[],
  confirmations: EntryStructuredMetadataConfirmation[] | undefined,
  nowIso: string,
  actorRole: 'athlete' | 'coach'
): EntryStructuredSuggestion[] => {
  if (!confirmations || confirmations.length === 0) {
    return suggestions;
  }

  const byField = new Map<EntryStructuredFieldKey, EntryStructuredSuggestion>(suggestions.map((item) => [item.field, item]));

  for (const confirmation of confirmations) {
    const existing = byField.get(confirmation.field);
    if (!existing) {
      continue;
    }

    const base = {
      ...existing,
      updatedAt: nowIso,
      updatedByRole: actorRole,
      ...(confirmation.note?.trim() ? { note: confirmation.note.trim() } : {}),
    };

    if (confirmation.status === 'confirmed') {
      byField.set(confirmation.field, {
        ...base,
        status: 'confirmed',
        correctionValue: undefined,
      });
      continue;
    }

    if (confirmation.status === 'rejected') {
      byField.set(confirmation.field, {
        ...base,
        status: 'rejected',
        correctionValue: undefined,
      });
      continue;
    }

    const correction = confirmation.correctionValue?.trim();
    if (correction) {
      byField.set(confirmation.field, {
        ...base,
        status: 'corrected',
        correctionValue: correction,
      });
    }
  }

  return STRUCTURED_FIELDS.map((field) => byField.get(field)).filter((item): item is EntryStructuredSuggestion => Boolean(item));
};

const toConfidenceFlags = (suggestions: EntryStructuredSuggestion[]): EntryStructuredExtraction['confidenceFlags'] =>
  suggestions
    .filter((item) => item.confidence !== 'high')
    .map((item) => ({
      field: item.field,
      confidence: item.confidence,
      ...(item.note ? { note: item.note } : {}),
    }));

export const applyStructuredSuggestionsToFields = (
  structured: EntryStructuredFields | undefined,
  suggestions: EntryStructuredSuggestion[]
): EntryStructuredFields | undefined => {
  const merged: EntryStructuredFields = {
    ...(structured ?? {}),
  };

  for (const suggestion of suggestions) {
    if (suggestion.status === 'rejected') {
      continue;
    }

    const finalValue = suggestion.status === 'corrected' ? suggestion.correctionValue : suggestion.value;
    if (!finalValue) {
      continue;
    }

    if (!merged[suggestion.field] || suggestion.status !== 'suggested') {
      merged[suggestion.field] = finalValue;
      continue;
    }

    if (suggestion.confidence !== 'low') {
      merged[suggestion.field] = finalValue;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
};

const buildSuggestion = (
  field: EntryStructuredFieldKey,
  value: string,
  confidence: ConfidenceLevel,
  nowIso: string,
  sourceExcerpt?: string
): EntryStructuredSuggestion => ({
  field,
  value: normalizeSpace(value),
  confidence,
  status: 'suggested',
  ...(maybePrompt(field, normalizeSpace(value), confidence) ? { confirmationPrompt: maybePrompt(field, normalizeSpace(value), confidence) } : {}),
  ...(sourceExcerpt ? { sourceExcerpt } : {}),
  updatedAt: nowIso,
});

export const extractStructuredMetadata = (
  input: Pick<CreateEntryRequest, 'quickAdd' | 'sections' | 'rawTechniqueMentions' | 'structured' | 'structuredMetadataConfirmations'>,
  options?: { nowIso?: string; actorRole?: 'athlete' | 'coach' }
): { structured: EntryStructuredFields | undefined; extraction: EntryStructuredExtraction } => {
  const nowIso = options?.nowIso ?? new Date().toISOString();
  const actorRole = options?.actorRole ?? 'athlete';
  const text = normalizeSpace([
    input.quickAdd.notes,
    input.sections.shared,
    input.sections.private,
    (input.rawTechniqueMentions ?? []).join(' '),
  ]
    .filter(Boolean)
    .join(' '));

  const position = pickByPatterns(text, POSITION_PATTERNS);
  const technique = pickTechnique(text, input.rawTechniqueMentions ?? []);
  const outcome = pickByPatterns(text, OUTCOME_PATTERNS);
  const failures = extractFailures(text);
  const problem = extractProblem(text, failures);
  const cue = extractCue(text);
  const concepts = extractConcepts(text);
  const conditioningIssues = extractConditioningIssues(text);

  const suggestions: EntryStructuredSuggestion[] = [];
  if (position) suggestions.push(buildSuggestion('position', position.value, position.confidence, nowIso, position.sourceExcerpt));
  if (technique) suggestions.push(buildSuggestion('technique', technique.value, technique.confidence, nowIso, technique.sourceExcerpt));
  if (outcome) suggestions.push(buildSuggestion('outcome', outcome.value, outcome.confidence, nowIso, outcome.sourceExcerpt));
  if (problem) suggestions.push(buildSuggestion('problem', problem.value, problem.confidence, nowIso, problem.sourceExcerpt));
  if (cue) suggestions.push(buildSuggestion('cue', cue.value, cue.confidence, nowIso, cue.sourceExcerpt));

  const withStructuredOverrides = applyStructuredOverrides(suggestions, input.structured ?? {}, nowIso, actorRole);
  const withConfirmations = applyConfirmations(
    withStructuredOverrides,
    input.structuredMetadataConfirmations,
    nowIso,
    actorRole
  );
  const structured = applyStructuredSuggestionsToFields(input.structured, withConfirmations);

  return {
    structured,
    extraction: {
      generatedAt: nowIso,
      suggestions: withConfirmations,
      concepts,
      failures,
      conditioningIssues,
      confidenceFlags: toConfidenceFlags(withConfirmations),
    },
  };
};

export const __test__ = {
  applyConfirmations,
  applyStructuredOverrides,
  extractConditioningIssues,
  extractConcepts,
  extractFailures,
  pickByPatterns,
};
