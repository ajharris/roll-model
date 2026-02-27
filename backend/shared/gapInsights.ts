import { ApiError } from './responses';
import type {
  Checkoff,
  CheckoffEvidence,
  GapInsightItem,
  GapInsightSourceLink,
  GapInsightsReport,
  GapInsightsThresholds,
  GapPriorityOverride,
} from './types';

export const GAP_PRIORITY_SK_PREFIX = 'GAP_PRIORITY#';

export const DEFAULT_GAP_THRESHOLDS: GapInsightsThresholds = {
  staleDays: 30,
  lookbackDays: 30,
  repeatFailureWindowDays: 30,
  repeatFailureMinCount: 2,
  topN: 10,
};

const DAY_MS = 24 * 60 * 60 * 1000;

const invalid = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400,
  });
};

const normalizeText = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const toFiniteDaysSince = (valueIso: string | undefined, nowMs: number): number => {
  if (!valueIso) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(valueIso);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((nowMs - parsed) / DAY_MS));
};

const dedupeSourceLinks = (links: GapInsightSourceLink[], limit: number): GapInsightSourceLink[] => {
  const seen = new Set<string>();
  const deduped: GapInsightSourceLink[] = [];
  for (const link of links) {
    const key = [link.entryId, link.evidenceId ?? '', link.excerpt ?? ''].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(link);
    if (deduped.length >= limit) break;
  }
  return deduped;
};

const impactFromScore = (score: number): 'high' | 'medium' | 'low' => {
  if (score >= 80) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
};

const parsePositiveInt = (
  raw: string | undefined,
  field: keyof GapInsightsThresholds,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    invalid(`${field} must be an integer between ${min} and ${max}.`);
  }

  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    invalid(`${field} must be an integer between ${min} and ${max}.`);
  }

  return parsed;
};

export const parseGapInsightsThresholds = (
  query: Record<string, string | undefined> | null | undefined,
): GapInsightsThresholds => ({
  staleDays: parsePositiveInt(query?.staleDays, 'staleDays', DEFAULT_GAP_THRESHOLDS.staleDays, 1, 365),
  lookbackDays: parsePositiveInt(query?.lookbackDays, 'lookbackDays', DEFAULT_GAP_THRESHOLDS.lookbackDays, 1, 365),
  repeatFailureWindowDays: parsePositiveInt(
    query?.repeatFailureWindowDays,
    'repeatFailureWindowDays',
    DEFAULT_GAP_THRESHOLDS.repeatFailureWindowDays,
    1,
    365,
  ),
  repeatFailureMinCount: parsePositiveInt(
    query?.repeatFailureMinCount,
    'repeatFailureMinCount',
    DEFAULT_GAP_THRESHOLDS.repeatFailureMinCount,
    2,
    20,
  ),
  topN: parsePositiveInt(query?.topN, 'topN', DEFAULT_GAP_THRESHOLDS.topN, 1, 50),
});

export const parseGapPriorityRows = (rows: Array<Record<string, unknown>>): GapPriorityOverride[] =>
  rows
    .filter((row) => row.entityType === 'GAP_PRIORITY')
    .map((row) => {
      const status = row.status;
      if (status !== 'accepted' && status !== 'watch' && status !== 'dismissed') {
        return null;
      }
      const updatedByRole = row.updatedByRole;
      if (updatedByRole !== 'athlete' && updatedByRole !== 'coach') {
        return null;
      }
      if (typeof row.gapId !== 'string' || typeof row.updatedAt !== 'string' || typeof row.updatedBy !== 'string') {
        return null;
      }

      return {
        gapId: row.gapId,
        status,
        manualPriority: typeof row.manualPriority === 'number' ? row.manualPriority : undefined,
        note: typeof row.note === 'string' ? row.note : undefined,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
        updatedByRole,
      } as GapPriorityOverride;
    })
    .filter((item): item is GapPriorityOverride => item !== null);

const sortByScoreAndPriority = (a: GapInsightItem, b: GapInsightItem): number => {
  const aAccepted = a.priority?.status === 'accepted';
  const bAccepted = b.priority?.status === 'accepted';
  if (aAccepted && bAccepted) {
    const aManual = a.priority?.manualPriority ?? Number.POSITIVE_INFINITY;
    const bManual = b.priority?.manualPriority ?? Number.POSITIVE_INFINITY;
    if (aManual !== bManual) return aManual - bManual;
  }
  if (a.score !== b.score) return b.score - a.score;
  return a.title.localeCompare(b.title);
};

const applyPriority = (item: GapInsightItem, priorities: Map<string, GapPriorityOverride>): GapInsightItem => {
  const priority = priorities.get(item.gapId);
  if (!priority) return item;

  let delta = 0;
  if (priority.status === 'accepted') delta = 120;
  if (priority.status === 'watch') delta = 20;
  if (priority.status === 'dismissed') delta = -200;

  return {
    ...item,
    score: item.score + delta,
    impact: impactFromScore(item.score + delta),
    priority,
  };
};

const latestIso = (current: string | undefined, candidate: string): string => {
  if (!current) return candidate;
  return candidate > current ? candidate : current;
};

const scoreStaleSkill = (daysSinceLastSeen: number, deficit: number): number => {
  const boundedDays = Number.isFinite(daysSinceLastSeen) ? Math.min(daysSinceLastSeen, 180) : 180;
  return Math.min(100, Math.round(boundedDays * 1.1 + deficit * 12));
};

const scoreNotTraining = (daysSinceLastSeen: number, deficit: number, pendingCount: number): number => {
  const boundedDays = Number.isFinite(daysSinceLastSeen) ? Math.min(daysSinceLastSeen, 180) : 180;
  return Math.min(100, Math.round(deficit * 16 + pendingCount * 7 + boundedDays * 0.7));
};

const scoreRepeatedFailure = (count: number, lastSeenAt: string, nowMs: number): number => {
  const days = toFiniteDaysSince(lastSeenAt, nowMs);
  const recencyBoost = days <= 7 ? 25 : days <= 14 ? 15 : 8;
  return Math.min(100, Math.round(count * 22 + recencyBoost));
};

type BuildGapInsightsReportInput = {
  athleteId: string;
  entries: Array<Record<string, unknown>>;
  checkoffs: Checkoff[];
  evidence: CheckoffEvidence[];
  priorities: GapPriorityOverride[];
  thresholds: GapInsightsThresholds;
  nowIso?: string;
};

export const buildGapInsightsReport = ({
  athleteId,
  entries,
  checkoffs,
  evidence,
  priorities,
  thresholds,
  nowIso,
}: BuildGapInsightsReportInput): GapInsightsReport => {
  const now = nowIso ?? new Date().toISOString();
  const nowMs = Date.parse(now);

  const evidenceBySkill = new Map<string, CheckoffEvidence[]>();
  const evidenceSkillByEntryId = new Map<string, Set<string>>();
  for (const row of evidence) {
    if (row.source !== 'gpt-structured' || row.mappingStatus === 'rejected') {
      continue;
    }
    const current = evidenceBySkill.get(row.skillId) ?? [];
    current.push(row);
    evidenceBySkill.set(row.skillId, current);

    const entrySkills = evidenceSkillByEntryId.get(row.entryId) ?? new Set<string>();
    entrySkills.add(row.skillId);
    evidenceSkillByEntryId.set(row.entryId, entrySkills);
  }

  const lastSkillSeenInEntries = new Map<string, string>();
  const repeatedFailures = new Map<
    string,
    {
      position: string;
      leak: string;
      count: number;
      lastSeenAt: string;
      sources: GapInsightSourceLink[];
    }
  >();

  for (const entry of entries) {
    if (entry.entityType !== 'ENTRY') continue;
    const entryId = typeof entry.entryId === 'string' ? entry.entryId : '';
    const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : '';
    if (!entryId || !createdAt) continue;

    const relatedSkills = evidenceSkillByEntryId.get(entryId);
    if (relatedSkills && relatedSkills.size > 0) {
      for (const skillId of relatedSkills) {
        const current = lastSkillSeenInEntries.get(skillId);
        lastSkillSeenInEntries.set(skillId, latestIso(current, createdAt));
      }
    }

    const actionPackFinal =
      typeof entry.actionPackFinal === 'object' && entry.actionPackFinal !== null
        ? (entry.actionPackFinal as Record<string, unknown>)
        : null;
    const actionPack =
      actionPackFinal && typeof actionPackFinal.actionPack === 'object' && actionPackFinal.actionPack !== null
        ? (actionPackFinal.actionPack as Record<string, unknown>)
        : null;

    if (!actionPack || !Array.isArray(actionPack.leaks)) {
      continue;
    }

    const positionCandidate =
      typeof entry.structured === 'object' && entry.structured !== null
        ? (entry.structured as Record<string, unknown>).position
        : undefined;
    const position = typeof positionCandidate === 'string' && positionCandidate.trim() ? positionCandidate.trim() : 'unspecified';

    for (const leak of actionPack.leaks) {
      if (typeof leak !== 'string' || !leak.trim()) continue;
      const normalizedLeak = normalizeText(leak);
      if (!normalizedLeak) continue;
      const key = `${normalizeText(position)}::${normalizedLeak}`;
      const current = repeatedFailures.get(key) ?? {
        position,
        leak: leak.trim(),
        count: 0,
        lastSeenAt: createdAt,
        sources: [],
      };

      current.count += 1;
      current.lastSeenAt = latestIso(current.lastSeenAt, createdAt);
      current.sources.push({
        entryId,
        createdAt,
        position,
        excerpt: leak.trim(),
      });
      repeatedFailures.set(key, current);
    }
  }

  const skillUniverse = new Set<string>();
  const checkoffStatsBySkill = new Map<string, { deficit: number; pendingCount: number; checkoffCount: number }>();
  for (const checkoff of checkoffs) {
    skillUniverse.add(checkoff.skillId);
    const stat = checkoffStatsBySkill.get(checkoff.skillId) ?? { deficit: 0, pendingCount: 0, checkoffCount: 0 };
    stat.checkoffCount += 1;
    const deficit = Math.max(0, checkoff.minEvidenceRequired - checkoff.confirmedEvidenceCount);
    stat.deficit += deficit;
    if (checkoff.status === 'pending') {
      stat.pendingCount += 1;
    }
    checkoffStatsBySkill.set(checkoff.skillId, stat);
  }

  for (const skillId of evidenceBySkill.keys()) {
    skillUniverse.add(skillId);
  }

  const staleSkills: GapInsightItem[] = [];
  const notTraining: GapInsightItem[] = [];

  for (const skillId of skillUniverse) {
    const lastSeenAt = lastSkillSeenInEntries.get(skillId) ?? evidenceBySkill.get(skillId)?.[0]?.createdAt;
    const daysSinceLastSeen = toFiniteDaysSince(lastSeenAt, nowMs);
    const checkoffStats = checkoffStatsBySkill.get(skillId) ?? { deficit: 0, pendingCount: 0, checkoffCount: 0 };
    const sourceLinks = dedupeSourceLinks(
      (evidenceBySkill.get(skillId) ?? [])
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((row) => ({
          entryId: row.entryId,
          createdAt: row.createdAt,
          evidenceId: row.evidenceId,
          checkoffId: row.checkoffId,
          skillId: row.skillId,
          excerpt: row.statement,
        })),
      5,
    );

    if (daysSinceLastSeen > thresholds.staleDays) {
      const staleScore = scoreStaleSkill(daysSinceLastSeen, checkoffStats.deficit);
      staleSkills.push({
        gapId: `stale-skill:${normalizeText(skillId)}`,
        type: 'stale_skill',
        title: `Stale skill: ${skillId}`,
        summary: `${skillId} has not appeared in structured training evidence for ${daysSinceLastSeen} days.`,
        score: staleScore,
        impact: impactFromScore(staleScore),
        skillId,
        daysSinceLastSeen,
        reasons: [
          `Last structured appearance: ${Number.isFinite(daysSinceLastSeen) ? `${daysSinceLastSeen} days ago` : 'never'}.`,
          checkoffStats.checkoffCount > 0
            ? `Curriculum graph has ${checkoffStats.checkoffCount} checkoff track(s) on this skill.`
            : 'No active checkoff tracks found; consider defining a checkoff track.',
        ],
        nextSteps: [
          `Add 2 sessions this week with ${skillId} as one-focus and capture GPT-structured evidence.`,
          'Log one drill and one live-roll attempt, then confirm mappings in checkoff review.',
        ],
        sourceLinks,
      });
    }

    if (checkoffStats.deficit > 0 && daysSinceLastSeen > thresholds.lookbackDays) {
      const notTrainingScore = scoreNotTraining(daysSinceLastSeen, checkoffStats.deficit, checkoffStats.pendingCount);
      notTraining.push({
        gapId: `not-training:${normalizeText(skillId)}`,
        type: 'not_training',
        title: `Not currently training: ${skillId}`,
        summary: `${skillId} is under-trained versus checkoff requirements in the last ${thresholds.lookbackDays} days.`,
        score: notTrainingScore,
        impact: impactFromScore(notTrainingScore),
        skillId,
        daysSinceLastSeen,
        reasons: [
          `${checkoffStats.deficit} confirmed evidence item(s) are still missing across active checkoffs.`,
          `${checkoffStats.pendingCount} checkoff(s) for this skill are still pending.`,
        ],
        nextSteps: [
          `Schedule focused reps for ${skillId} and target at least ${Math.min(3, checkoffStats.deficit)} confirmed evidence item(s).`,
          'Add explicit one-focus wording in your next journal entry to improve evidence mapping quality.',
        ],
        sourceLinks,
      });
    }
  }

  const repeatedFailureItems: GapInsightItem[] = [];
  for (const [key, value] of repeatedFailures.entries()) {
    const daysSinceLastFailure = toFiniteDaysSince(value.lastSeenAt, nowMs);
    if (daysSinceLastFailure > thresholds.repeatFailureWindowDays) {
      continue;
    }
    if (value.count < thresholds.repeatFailureMinCount) {
      continue;
    }

    const score = scoreRepeatedFailure(value.count, value.lastSeenAt, nowMs);
    repeatedFailureItems.push({
      gapId: `repeated-failure:${key}`,
      type: 'repeated_failure',
      title: `Repeated failure from ${value.position}`,
      summary: `"${value.leak}" appeared ${value.count} times in structured failures within the last ${thresholds.repeatFailureWindowDays} days.`,
      score,
      impact: impactFromScore(score),
      position: value.position,
      repeatCount: value.count,
      failureExamples: [value.leak],
      reasons: [
        `Pattern repeated ${value.count} times from the same position.`,
        `Most recent occurrence: ${toFiniteDaysSince(value.lastSeenAt, nowMs)} day(s) ago.`,
      ],
      nextSteps: [
        `Run 3 constrained rounds starting in ${value.position} focused on fixing: ${value.leak}.`,
        'Track whether the same leak appears in the next two sessions and update your one-focus if needed.',
      ],
      sourceLinks: dedupeSourceLinks(
        value.sources.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        5,
      ),
    });
  }

  const priorityMap = new Map(priorities.map((item) => [item.gapId, item]));
  const prioritizedNotTraining = notTraining.map((item) => applyPriority(item, priorityMap)).sort(sortByScoreAndPriority);
  const prioritizedStale = staleSkills.map((item) => applyPriority(item, priorityMap)).sort(sortByScoreAndPriority);
  const prioritizedRepeated = repeatedFailureItems.map((item) => applyPriority(item, priorityMap)).sort(sortByScoreAndPriority);

  const ranked = [...prioritizedNotTraining, ...prioritizedStale, ...prioritizedRepeated]
    .filter((item) => item.priority?.status !== 'dismissed')
    .sort(sortByScoreAndPriority)
    .slice(0, thresholds.topN);

  const acceptedItems = ranked
    .filter((item) => item.priority?.status === 'accepted')
    .sort(sortByScoreAndPriority);
  const weeklyBase = acceptedItems.length > 0 ? acceptedItems : ranked;

  const weeklyItems = weeklyBase.slice(0, 3).map((item) => ({
    gapId: item.gapId,
    title: item.title,
    reason: item.reasons[0] ?? item.summary,
    nextStep: item.nextSteps[0] ?? 'Review this gap and define a concrete next session objective.',
  }));

  return {
    athleteId,
    generatedAt: now,
    thresholds,
    summary: {
      totalGaps: ranked.length,
      staleSkillCount: prioritizedStale.length,
      repeatedFailureCount: prioritizedRepeated.length,
      notTrainingCount: prioritizedNotTraining.length,
    },
    sections: {
      notTraining: prioritizedNotTraining.slice(0, thresholds.topN),
      staleSkills: prioritizedStale.slice(0, thresholds.topN),
      repeatedFailures: prioritizedRepeated.slice(0, thresholds.topN),
    },
    ranked,
    weeklyFocus: {
      headline:
        acceptedItems.length > 0
          ? 'Weekly focus follows accepted gap priorities.'
          : 'Weekly focus is auto-ranked from highest-impact current gaps.',
      items: weeklyItems,
    },
  };
};

export const buildGapPrioritySk = (gapId: string): string => `${GAP_PRIORITY_SK_PREFIX}${gapId}`;
