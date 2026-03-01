import { v4 as uuidv4 } from 'uuid';

import { getOpenAIApiKey } from './openai';
import type {
  CoachQuestion,
  CoachQuestionEvidence,
  CoachQuestionGenerationReason,
  CoachQuestionRubricScore,
  CoachQuestionSet,
  CoachQuestionSignalType,
  ConfidenceLevel,
  Entry
} from './types';

export const COACH_QUESTION_SET_SK_PREFIX = 'COACH_QUESTION_SET#';
export const COACH_QUESTION_META_PK_PREFIX = 'COACH_QUESTION_SET#';
export const COACH_QUESTION_PROMPT_VERSION = 1;
export const COACH_QUESTION_MODEL = 'gpt-4.1-mini';

const MAX_SOURCE_ENTRIES = 5;
const MIN_SNIPPET_LENGTH = 12;
const MAX_SNIPPET_LENGTH = 240;

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'of',
  'for',
  'in',
  'on',
  'with',
  'at',
  'from',
  'that',
  'this',
  'is',
  'are',
  'be',
  'by',
  'as',
  'it',
  'you',
  'your',
  'when',
  'what',
  'which',
  'how'
]);

const ACTION_VERBS = [
  'test',
  'drill',
  'apply',
  'adjust',
  'commit',
  'track',
  'measure',
  'start',
  'switch',
  'frame',
  'grip',
  'posture',
  'recover',
  'escape'
];

const DECISION_MARKERS = ['decide', 'decision', 'hesitate', 'choose', 'if', 'when', 'trigger'];
const FAILURE_MARKERS = ['stuck', 'failed', 'couldn\'t', 'cannot', 'lost', 'problem', 'leak'];

type CoachSignal = {
  issueKey: string;
  signalType: CoachQuestionSignalType;
  count: number;
  latestCreatedAt: string;
  evidence: CoachQuestionEvidence[];
};

type RawAIQuestion = {
  text?: unknown;
  signalType?: unknown;
  issueKey?: unknown;
  confidence?: unknown;
  evidence?: unknown;
};

const normalizeText = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeKey = (value: string): string =>
  normalizeText(value)
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');

const clip = (value: string, maxLen: number): string =>
  value.length <= maxLen ? value : `${value.slice(0, maxLen - 3).trimEnd()}...`;

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()) : [];

const tokenize = (text: string): string[] =>
  normalizeText(text)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

const coerceSignalType = (value: unknown): CoachQuestionSignalType | null => {
  if (value === 'unresolved_blocker' || value === 'repeated_failure' || value === 'decision_point') {
    return value;
  }
  return null;
};

const coerceConfidence = (value: unknown): ConfidenceLevel => {
  if (value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return 'medium';
};

const latestIso = (current: string, candidate: string): string => (candidate > current ? candidate : current);

const toEvidenceSnippet = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.length < MIN_SNIPPET_LENGTH) {
    return null;
  }

  return clip(trimmed, MAX_SNIPPET_LENGTH);
};

const buildEntrySignals = (entry: Entry): Array<{ signalType: CoachQuestionSignalType; excerpt: string }> => {
  const signals: Array<{ signalType: CoachQuestionSignalType; excerpt: string }> = [];

  const structured = entry.structured ?? {};
  const actionPack = entry.actionPackFinal?.actionPack;
  const sessionReview = entry.sessionReviewFinal?.review;

  const blockers = [
    structured.problem,
    ...asStringArray(actionPack?.leaks),
    ...asStringArray(sessionReview?.promptSet.whatFailed),
    ...(entry.partnerOutcomes ?? []).flatMap((outcome) => outcome.whatFailed)
  ]
    .map((value) => asString(value))
    .filter(Boolean);

  for (const blocker of blockers) {
    const snippet = toEvidenceSnippet(blocker);
    if (!snippet) continue;
    signals.push({ signalType: 'unresolved_blocker', excerpt: snippet });
  }

  const sharedText = asString(entry.sections.shared);
  for (const sentence of sharedText.split(/[.!?\n]+/)) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();
    if (FAILURE_MARKERS.some((marker) => lower.includes(marker))) {
      const snippet = toEvidenceSnippet(trimmed);
      if (snippet) {
        signals.push({ signalType: 'unresolved_blocker', excerpt: snippet });
      }
    }

    if (DECISION_MARKERS.some((marker) => lower.includes(marker))) {
      const snippet = toEvidenceSnippet(trimmed);
      if (snippet) {
        signals.push({ signalType: 'decision_point', excerpt: snippet });
      }
    }
  }

  const decisions = [structured.cue, structured.constraint, actionPack?.fallbackDecisionGuidance]
    .map((value) => asString(value))
    .filter(Boolean);

  for (const decision of decisions) {
    const snippet = toEvidenceSnippet(decision);
    if (!snippet) continue;
    signals.push({ signalType: 'decision_point', excerpt: snippet });
  }

  return signals;
};

export const selectRecentEntriesForQuestions = (entries: Entry[]): Entry[] =>
  entries
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((entry) => entry.structured || entry.actionPackFinal || entry.sessionReviewFinal)
    .slice(0, MAX_SOURCE_ENTRIES);

export const extractCoachSignals = (entries: Entry[]): CoachSignal[] => {
  const map = new Map<string, CoachSignal>();

  for (const entry of entries) {
    const entrySignals = buildEntrySignals(entry);

    for (const signal of entrySignals) {
      const issueKey = normalizeKey(signal.excerpt);
      if (!issueKey) continue;

      const key = `${signal.signalType}:${issueKey}`;
      const existing = map.get(key) ?? {
        issueKey,
        signalType: signal.signalType,
        count: 0,
        latestCreatedAt: entry.createdAt,
        evidence: []
      };

      existing.count += 1;
      existing.latestCreatedAt = latestIso(existing.latestCreatedAt, entry.createdAt);
      existing.evidence.push({
        entryId: entry.entryId,
        createdAt: entry.createdAt,
        signalType: signal.signalType,
        excerpt: signal.excerpt
      });

      map.set(key, existing);
    }
  }

  const promoted: CoachSignal[] = [];
  for (const signal of map.values()) {
    if (signal.signalType === 'unresolved_blocker' && signal.count >= 2) {
      promoted.push({
        ...signal,
        signalType: 'repeated_failure',
        issueKey: `repeated-${signal.issueKey}`
      });
      continue;
    }

    promoted.push(signal);
  }

  const scoreSignal = (signal: CoachSignal): number => {
    const base = signal.signalType === 'repeated_failure' ? 300 : signal.signalType === 'unresolved_blocker' ? 200 : 120;
    return base + signal.count * 25;
  };

  return promoted
    .map((signal) => ({
      ...signal,
      evidence: signal.evidence
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .filter((item, index, list) => list.findIndex((v) => v.entryId === item.entryId) === index)
        .slice(0, 3)
    }))
    .sort((a, b) => {
      const byScore = scoreSignal(b) - scoreSignal(a);
      if (byScore !== 0) return byScore;
      return b.latestCreatedAt.localeCompare(a.latestCreatedAt);
    });
};

const buildFallbackQuestion = (signal: CoachSignal): Omit<CoachQuestion, 'questionId' | 'priority' | 'rubric'> => {
  const exemplar = signal.evidence[0]?.excerpt ?? signal.issueKey.replace(/-/g, ' ');

  const text =
    signal.signalType === 'repeated_failure'
      ? `The pattern "${clip(exemplar, 90)}" keeps recurring. What one decision rule will you test first in your next two rounds to interrupt it?`
      : signal.signalType === 'decision_point'
        ? `When "${clip(exemplar, 90)}" appears, which cue will trigger your next action, and what result will confirm the cue worked?`
        : `What single adjustment will you test next session to address "${clip(exemplar, 90)}", and how will you measure if it improved?`;

  return {
    text,
    signalType: signal.signalType,
    issueKey: signal.issueKey,
    confidence: signal.count >= 2 ? 'high' : 'medium',
    evidence: signal.evidence
  };
};

const buildSignalSummary = (signals: CoachSignal[]): string =>
  JSON.stringify(
    signals.slice(0, 8).map((signal) => ({
      signalType: signal.signalType,
      issueKey: signal.issueKey,
      count: signal.count,
      evidence: signal.evidence.map((item) => ({
        entryId: item.entryId,
        createdAt: item.createdAt,
        excerpt: item.excerpt
      }))
    }))
  );

const buildPromptContext = (entries: Entry[]): string =>
  JSON.stringify(
    entries.map((entry) => ({
      entryId: entry.entryId,
      createdAt: entry.createdAt,
      structured: entry.structured,
      shared: entry.sections.shared,
      actionPackFinal: entry.actionPackFinal?.actionPack,
      sessionReviewFinal: entry.sessionReviewFinal?.review,
      partnerOutcomes: entry.partnerOutcomes?.map((item) => ({
        partnerDisplayName: item.partnerDisplayName,
        whatWorked: item.whatWorked,
        whatFailed: item.whatFailed
      }))
    }))
  );

const buildCoachQuestionsSystemPrompt = (): string =>
  [
    'You generate coach-ready questions from athlete journal entries.',
    'Return strict JSON only with shape: ',
    '{"questions":[{"text":string,"signalType":"unresolved_blocker"|"repeated_failure"|"decision_point","issueKey":string,"confidence":"high"|"medium"|"low","evidence":[{"entryId":string,"createdAt":string,"excerpt":string}]}]}',
    'Rules:',
    '1) Return exactly 3 questions.',
    '2) Prioritize unresolved blockers, repeated failures, and decision points.',
    '3) Questions must be specific, testable in the next 1-2 sessions, and coach-actionable.',
    '4) Keep each question under 200 characters and avoid duplicates.',
    '5) Attach at least one evidence item per question from provided entry IDs only.',
    '6) Do not include markdown or additional keys.'
  ].join(' ');

const callCoachQuestionModel = async (entries: Entry[], signals: CoachSignal[]): Promise<RawAIQuestion[]> => {
  const apiKey = await getOpenAIApiKey();

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: COACH_QUESTION_MODEL,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: buildCoachQuestionsSystemPrompt() }]
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Source entries: ${buildPromptContext(entries)}\nSignal summary: ${buildSignalSummary(signals)}`
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error('AI provider request failed.');
  }

  const raw = (await response.json()) as { output_text?: string };
  if (!raw.output_text) {
    throw new Error('AI provider returned empty output.');
  }

  const parsed = JSON.parse(raw.output_text) as { questions?: unknown };
  if (!Array.isArray(parsed.questions)) {
    throw new Error('AI payload missing questions array.');
  }

  return parsed.questions as RawAIQuestion[];
};

const normalizeEvidence = (
  signalType: CoachQuestionSignalType,
  value: unknown,
  signalByKey: Map<string, CoachSignal>
): CoachQuestionEvidence[] => {
  const evidenceCandidates = Array.isArray(value) ? value : [];

  const normalized = evidenceCandidates
    .map((item): CoachQuestionEvidence | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const candidate = item as Record<string, unknown>;
      const entryId = asString(candidate.entryId);
      const createdAt = asString(candidate.createdAt);
      const excerpt = toEvidenceSnippet(asString(candidate.excerpt));

      if (!entryId || !createdAt || !excerpt) {
        return null;
      }

      return { entryId, createdAt, signalType, excerpt };
    })
    .filter((item): item is CoachQuestionEvidence => item !== null)
    .slice(0, 3);

  if (normalized.length > 0) {
    return normalized;
  }

  for (const signal of signalByKey.values()) {
    if (signal.signalType === signalType) {
      return signal.evidence.slice(0, 2);
    }
  }

  return [];
};

const parseAiQuestions = (raw: RawAIQuestion[], signals: CoachSignal[]): Array<Omit<CoachQuestion, 'questionId' | 'priority' | 'rubric'>> => {
  const signalByKey = new Map(signals.map((signal) => [signal.issueKey, signal]));

  return raw
    .map((item): Omit<CoachQuestion, 'questionId' | 'priority' | 'rubric'> | null => {
      const text = asString(item.text);
      if (!text) {
        return null;
      }

      const signalType = coerceSignalType(item.signalType) ?? 'unresolved_blocker';
      const issueKeyRaw = asString(item.issueKey);
      const issueKey = normalizeKey(issueKeyRaw) || signals[0]?.issueKey || 'unspecified-issue';

      return {
        text: text.endsWith('?') ? text : `${text}?`,
        signalType,
        issueKey,
        confidence: coerceConfidence(item.confidence),
        evidence: normalizeEvidence(signalType, item.evidence, signalByKey)
      };
    })
    .filter((item): item is Omit<CoachQuestion, 'questionId' | 'priority' | 'rubric'> => item !== null);
};

export const jaccardSimilarity = (a: string, b: string): number => {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      intersection += 1;
    }
  }

  return intersection / (aTokens.size + bTokens.size - intersection);
};

export const hasDuplicateQuestions = (questions: string[]): boolean => {
  for (let i = 0; i < questions.length; i += 1) {
    for (let j = i + 1; j < questions.length; j += 1) {
      if (jaccardSimilarity(questions[i], questions[j]) >= 0.65) {
        return true;
      }
    }
  }

  return false;
};

export const scoreCoachQuestion = (
  question: Omit<CoachQuestion, 'questionId' | 'priority' | 'rubric'>,
  siblingQuestions: string[]
): CoachQuestionRubricScore => {
  const notes: string[] = [];
  const normalized = normalizeText(question.text);

  const specific = normalized.length >= 35 && normalized.length <= 220 ? 5 : 2;
  if (specific < 5) {
    notes.push('Question is too short or too long to be specific.');
  }

  const testable = /next|first|second|round|session|measure|track|confirm|result|metric/.test(normalized) ? 5 : 2;
  if (testable < 5) {
    notes.push('Question lacks a clear test condition.');
  }

  const coachActionable = ACTION_VERBS.some((verb) => normalized.includes(verb)) ? 5 : 2;
  if (coachActionable < 5) {
    notes.push('Question does not imply a coach-actionable intervention.');
  }

  const evidenceBacked = question.evidence.length >= 1 ? 5 : 1;
  if (evidenceBacked < 5) {
    notes.push('Question is missing evidence snippets.');
  }

  const nonDuplicative =
    siblingQuestions.filter((item) => jaccardSimilarity(question.text, item) >= 0.65).length > 0 ? 1 : 5;
  if (nonDuplicative < 5) {
    notes.push('Question is too similar to another generated question.');
  }

  const total = specific * 20 + testable * 20 + coachActionable * 20 + evidenceBacked * 25 + nonDuplicative * 15;

  return {
    specific,
    testable,
    coachActionable,
    evidenceBacked,
    nonDuplicative,
    total,
    needsRevision: total < 70,
    notes
  };
};

const finalizeQuestions = (
  candidates: Array<Omit<CoachQuestion, 'questionId' | 'priority' | 'rubric'>>,
  fallbackSignals: CoachSignal[]
): CoachQuestion[] => {
  const deduped: Array<Omit<CoachQuestion, 'questionId' | 'priority' | 'rubric'>> = [];

  for (const candidate of candidates) {
    if (!candidate.text) continue;
    if (deduped.some((item) => jaccardSimilarity(item.text, candidate.text) >= 0.65)) {
      continue;
    }
    deduped.push(candidate);
  }

  for (const signal of fallbackSignals) {
    if (deduped.length >= 3) break;
    const fallback = buildFallbackQuestion(signal);
    if (deduped.some((item) => jaccardSimilarity(item.text, fallback.text) >= 0.65)) {
      continue;
    }
    deduped.push(fallback);
  }

  while (deduped.length < 3) {
    const fillerText = `What concrete change will you test in your next session, and how will you measure whether it worked?`;
    if (!deduped.some((item) => jaccardSimilarity(item.text, fillerText) >= 0.65)) {
      deduped.push({
        text: fillerText,
        signalType: 'unresolved_blocker',
        issueKey: `general-improvement-${deduped.length + 1}`,
        confidence: 'low',
        evidence: []
      });
    } else {
      deduped.push({
        text: `Which coaching cue should you prioritize first next session, and what observable result will indicate progress?`,
        signalType: 'decision_point',
        issueKey: `general-decision-${deduped.length + 1}`,
        confidence: 'low',
        evidence: []
      });
    }
  }

  const top = deduped.slice(0, 3);
  return top.map((question, index) => {
    const siblings = top.filter((_, siblingIndex) => siblingIndex !== index).map((item) => item.text);
    return {
      ...question,
      questionId: uuidv4(),
      priority: (index + 1) as 1 | 2 | 3,
      rubric: scoreCoachQuestion(question, siblings)
    };
  });
};

export const buildCoachQuestionSetSk = (generatedAt: string, questionSetId: string): string =>
  `${COACH_QUESTION_SET_SK_PREFIX}${generatedAt}#${questionSetId}`;

export const buildCoachQuestionMetaPk = (questionSetId: string): string => `${COACH_QUESTION_META_PK_PREFIX}${questionSetId}`;

export const buildCoachQuestionSetRecord = (set: CoachQuestionSet): Record<string, unknown> => ({
  PK: `USER#${set.athleteId}`,
  SK: buildCoachQuestionSetSk(set.generatedAt, set.questionSetId),
  entityType: 'COACH_QUESTION_SET',
  ...set
});

export const buildCoachQuestionMetaRecord = (set: CoachQuestionSet): Record<string, unknown> => ({
  PK: buildCoachQuestionMetaPk(set.questionSetId),
  SK: 'META',
  entityType: 'COACH_QUESTION_META',
  questionSetId: set.questionSetId,
  athleteId: set.athleteId,
  generatedAt: set.generatedAt
});

export const parseCoachQuestionSetRecord = (row: Record<string, unknown>): CoachQuestionSet | null => {
  if (row.entityType !== 'COACH_QUESTION_SET') {
    return null;
  }

  if (
    typeof row.questionSetId !== 'string' ||
    typeof row.athleteId !== 'string' ||
    typeof row.generatedAt !== 'string' ||
    typeof row.updatedAt !== 'string' ||
    !Array.isArray(row.sourceEntryIds) ||
    !Array.isArray(row.questions)
  ) {
    return null;
  }

  return row as unknown as CoachQuestionSet;
};

export const generateCoachQuestionSet = async (params: {
  athleteId: string;
  entries: Entry[];
  nowIso: string;
  generatedBy: string;
  generatedByRole: 'athlete' | 'coach';
  generationReason: CoachQuestionGenerationReason;
}): Promise<CoachQuestionSet> => {
  const recentEntries = selectRecentEntriesForQuestions(params.entries);
  const signals = extractCoachSignals(recentEntries);

  let aiCandidates: Array<Omit<CoachQuestion, 'questionId' | 'priority' | 'rubric'>> = [];
  try {
    const raw = await callCoachQuestionModel(recentEntries, signals);
    aiCandidates = parseAiQuestions(raw, signals);
  } catch {
    aiCandidates = [];
  }

  const questions = finalizeQuestions(aiCandidates, signals);

  const totals = questions.map((question) => question.rubric.total);
  const averageScore = totals.length > 0 ? Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length) : 0;
  const minScore = totals.length > 0 ? Math.min(...totals) : 0;

  return {
    questionSetId: uuidv4(),
    athleteId: params.athleteId,
    generatedAt: params.nowIso,
    updatedAt: params.nowIso,
    sourceEntryIds: recentEntries.map((entry) => entry.entryId),
    generationReason: params.generationReason,
    generatedBy: params.generatedBy,
    generatedByRole: params.generatedByRole,
    model: COACH_QUESTION_MODEL,
    promptVersion: COACH_QUESTION_PROMPT_VERSION,
    qualitySummary: {
      averageScore,
      minScore,
      hasDuplicates: hasDuplicateQuestions(questions.map((item) => item.text)),
      lowConfidenceCount: questions.filter((item) => item.confidence === 'low').length
    },
    questions
  };
};
