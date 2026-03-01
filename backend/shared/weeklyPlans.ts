import { v4 as uuidv4 } from 'uuid';

import { extractEntryOneThingCue } from './sessionReview';
import type {
  Checkoff,
  CurriculumGraph,
  CurriculumGraphNode,
  Entry,
  WeeklyPlan,
  WeeklyPlanExplainabilityItem,
  WeeklyPlanItemStatus,
  WeeklyPlanMenuItem,
  WeeklyPlanReference,
  WeeklyPositionalFocusCard,
  WeeklyPlanSelectionType,
  WeeklyPlanStatus
} from './types';

type SkillCandidate = {
  skillId: string;
  label: string;
  score: number;
  reasons: string[];
  references: WeeklyPlanReference[];
};

type BuilderSignal = {
  entries: Entry[];
  checkoffs: Checkoff[];
  curriculumGraph: CurriculumGraph | null;
  priorPlans: WeeklyPlan[];
  weekOf: string;
  nowIso: string;
};

type ActionPackLike = {
  leaks: string[];
  wins: string[];
  oneFocus: string;
  drills: string[];
  positionalRequests: string[];
  fallbackDecisionGuidance: string;
};

const MAX_PRIMARY_SKILLS = 2;
const MAX_POSITIONAL_FOCUS_CARDS = 4;
const MAX_ONE_THING_CUES = 3;

type FocusSignalBucket = {
  key: string;
  statement: string;
  count: number;
  references: WeeklyPlanReference[];
  recurringFailures: string[];
  positions: string[];
  contexts: string[];
  lastSeenAt: string;
  oneThingMatches: number;
};

const asSkillId = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'general-fundamentals';

const labelFromSkillId = (value: string): string =>
  value
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const truncate = (value: string, max = 160): string => {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - 3)).trim()}...`;
};

const getActionPack = (entry: Entry): ActionPackLike | null => {
  if (entry.actionPackFinal?.actionPack) {
    return entry.actionPackFinal.actionPack;
  }
  if (entry.actionPackDraft) {
    return entry.actionPackDraft;
  }
  return null;
};

const buildCandidateMap = (): Map<string, SkillCandidate> => new Map<string, SkillCandidate>();

const ensureCandidate = (
  candidateMap: Map<string, SkillCandidate>,
  skillId: string,
  label: string,
): SkillCandidate => {
  const normalized = asSkillId(skillId);
  const existing = candidateMap.get(normalized);
  if (existing) {
    return existing;
  }

  const created: SkillCandidate = {
    skillId: normalized,
    label: label.trim() || labelFromSkillId(normalized),
    score: 0,
    reasons: [],
    references: []
  };

  candidateMap.set(normalized, created);
  return created;
};

const pushReference = (candidate: SkillCandidate, reference: WeeklyPlanReference): void => {
  if (candidate.references.some((item) => item.sourceType === reference.sourceType && item.sourceId === reference.sourceId)) {
    return;
  }
  candidate.references.push(reference);
};

const scoreFromCheckoffStatus = (status: Checkoff['status']): number => {
  if (status === 'superseded') return 4;
  if (status === 'pending') return 3;
  if (status === 'earned') return -2;
  return -1;
};

const inferConstraintFromLeak = (leakStatements: string[]): string => {
  const lower = leakStatements.map((item) => item.toLowerCase());
  if (lower.some((item) => item.includes('gas') || item.includes('tired') || item.includes('fatigue') || item.includes('pace'))) {
    return 'Gas tank: keep first two rounds at 70-80% pace and recover through nasal breathing between exchanges.';
  }
  if (lower.some((item) => item.includes('head') || item.includes('posture') || item.includes('chin'))) {
    return 'Head position: establish forehead/chin line before grips, then move hips.';
  }
  if (lower.some((item) => item.includes('frame') || item.includes('underhook') || item.includes('elbow'))) {
    return 'Frames first: win inside frame position before any escape or attack attempt.';
  }
  return 'Decision speed: within 3 seconds choose attack, recover, or stand-up before stalling in neutral exchanges.';
};

const toMenuItems = (values: string[], prefix: string): WeeklyPlanMenuItem[] =>
  values
    .map((value, index) => ({
      id: `${prefix}-${index + 1}`,
      label: truncate(value, 140),
      status: 'pending' as const
    }))
    .slice(0, 4);

const addExplainability = (
  explainability: WeeklyPlanExplainabilityItem[],
  selectionType: WeeklyPlanSelectionType,
  selectedValue: string,
  reason: string,
  references: WeeklyPlanReference[]
): void => {
  explainability.push({
    selectionType,
    selectedValue,
    reason,
    references: references.slice(0, 3)
  });
};

const normalizeWeekDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + offset);
  return utc.toISOString().slice(0, 10);
};

const mostRecentReference = (references: WeeklyPlanReference[]): WeeklyPlanReference[] => {
  if (references.length <= 3) {
    return references;
  }

  return [...references].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')).reverse().slice(0, 3);
};

const addGraphNodeScore = (
  candidateMap: Map<string, SkillCandidate>,
  node: CurriculumGraphNode,
  graphUpdatedAt: string
): void => {
  const candidate = ensureCandidate(candidateMap, node.skillId, node.label);
  candidate.score += Math.max(0, node.priority) * 2;
  candidate.reasons.push(`Curriculum priority ${node.priority}`);
  pushReference(candidate, {
    sourceType: 'curriculum-graph',
    sourceId: node.skillId,
    createdAt: graphUpdatedAt,
    summary: `Curriculum graph node: ${node.label}`
  });
};

const ensureNonEmpty = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  return trimmed || fallback;
};

const uniqueStrings = (values: string[], max = 3): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) {
      break;
    }
  }
  return out;
};

const aggregateSignal = (
  map: Map<string, FocusSignalBucket>,
  signal: {
    statement: string;
    entry: Entry;
    position: string;
    context: string;
    oneThingCueTokens: string[];
  },
  kind: 'failure' | 'win'
): void => {
  const normalizedStatement = truncate(signal.statement, 120);
  const key = asSkillId(normalizedStatement);
  const existing = map.get(key);
  const oneThingMatch = signal.oneThingCueTokens.some((token) => normalizedStatement.toLowerCase().includes(token)) ? 1 : 0;

  if (!existing) {
    map.set(key, {
      key,
      statement: normalizedStatement,
      count: 1,
      references: [
        {
          sourceType: 'entry-action-pack',
          sourceId: signal.entry.entryId,
          createdAt: signal.entry.createdAt,
          summary: `${kind === 'failure' ? 'Failure' : 'Win'}: ${normalizedStatement}`
        }
      ],
      recurringFailures: kind === 'failure' ? [normalizedStatement] : [],
      positions: signal.position ? [signal.position] : [],
      contexts: signal.context ? [signal.context] : [],
      lastSeenAt: signal.entry.createdAt,
      oneThingMatches: oneThingMatch
    });
    return;
  }

  existing.count += 1;
  existing.lastSeenAt = existing.lastSeenAt.localeCompare(signal.entry.createdAt) > 0 ? existing.lastSeenAt : signal.entry.createdAt;
  existing.oneThingMatches += oneThingMatch;
  if (!existing.references.some((item) => item.sourceId === signal.entry.entryId)) {
    existing.references.push({
      sourceType: 'entry-action-pack',
      sourceId: signal.entry.entryId,
      createdAt: signal.entry.createdAt,
      summary: `${kind === 'failure' ? 'Failure' : 'Win'}: ${normalizedStatement}`
    });
  }
  if (kind === 'failure') {
    existing.recurringFailures.push(normalizedStatement);
  }
  if (signal.position.trim()) {
    existing.positions.push(signal.position);
  }
  if (signal.context.trim()) {
    existing.contexts.push(signal.context);
  }
};

const extractEntryFailureStatements = (entry: Entry, actionPack: ActionPackLike): string[] => {
  const failures = [...actionPack.leaks];
  const whatFailedFromFinal = entry.sessionReviewFinal?.review.promptSet.whatFailed ?? [];
  const whatFailedFromDraft = entry.sessionReviewDraft?.promptSet.whatFailed ?? [];
  failures.push(...whatFailedFromFinal, ...whatFailedFromDraft);
  return failures.filter((item) => item.trim());
};

const extractPositionAndContext = (entry: Entry, actionPack: ActionPackLike): { position: string; context: string } => {
  const position =
    actionPack.positionalRequests.find((item) => item.trim()) ??
    entry.structured?.position ??
    entry.sessionMetrics.tags.find((item) => item.trim()) ??
    'mixed-position';
  const contextParts = [entry.quickAdd.class, entry.sessionContext?.ruleset, entry.quickAdd.gym].filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  );
  return {
    position: truncate(position, 80),
    context: truncate(contextParts.join(' | ') || 'live rounds', 100)
  };
};

const buildWeeklyPositionalFocusCards = (
  entries: Entry[],
  priorPlans: WeeklyPlan[],
  oneFocuses: string[],
  primarySkills: string[],
  nowIso: string
): WeeklyPositionalFocusCard[] => {
  const recentEntries = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 16);
  const oneThingCues = uniqueStrings(
    recentEntries.map((entry) => extractEntryOneThingCue(entry) ?? '').filter((item) => item.trim()),
    MAX_ONE_THING_CUES
  );
  const cueTokens = oneThingCues
    .flatMap((cue) => cue.toLowerCase().split(/[^a-z0-9]+/g))
    .filter((token) => token.length >= 4);

  const failureMap = new Map<string, FocusSignalBucket>();
  const winMap = new Map<string, FocusSignalBucket>();

  for (const entry of recentEntries) {
    const actionPack = getActionPack(entry);
    if (!actionPack) {
      continue;
    }
    const { position, context } = extractPositionAndContext(entry, actionPack);
    for (const statement of extractEntryFailureStatements(entry, actionPack)) {
      aggregateSignal(
        failureMap,
        {
          statement,
          entry,
          position,
          context,
          oneThingCueTokens: cueTokens
        },
        'failure'
      );
    }

    for (const statement of actionPack.wins.filter((item) => item.trim())) {
      aggregateSignal(
        winMap,
        {
          statement,
          entry,
          position,
          context,
          oneThingCueTokens: cueTokens
        },
        'win'
      );
    }
  }

  const carryOverCards = priorPlans
    .slice(0, 2)
    .flatMap((plan) => plan.positionalFocus?.cards ?? [])
    .filter((card) => card.status === 'pending');
  const carryOverByKey = new Map<string, WeeklyPositionalFocusCard[]>();
  for (const card of carryOverCards) {
    const key = asSkillId(card.title);
    const existing = carryOverByKey.get(key) ?? [];
    existing.push(card);
    carryOverByKey.set(key, existing);
  }

  const scoreFailure = (bucket: FocusSignalBucket): number => {
    const recencyDays = Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(bucket.lastSeenAt)) / (24 * 60 * 60 * 1000)));
    const recencyScore = recencyDays <= 7 ? 2 : recencyDays <= 14 ? 1 : 0;
    const carryOverScore = (carryOverByKey.get(bucket.key)?.length ?? 0) * 2;
    return bucket.count * 3 + bucket.oneThingMatches + recencyScore + carryOverScore;
  };

  const scoreWin = (bucket: FocusSignalBucket): number => {
    const recencyDays = Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(bucket.lastSeenAt)) / (24 * 60 * 60 * 1000)));
    const recencyScore = recencyDays <= 7 ? 2 : recencyDays <= 14 ? 1 : 0;
    return bucket.count * 2 + recencyScore;
  };

  const remediationBuckets = [...failureMap.values()].sort((a, b) => scoreFailure(b) - scoreFailure(a)).slice(0, 2);
  const reinforcementBucket = [...winMap.values()]
    .sort((a, b) => scoreWin(b) - scoreWin(a))
    .find((candidate) => !remediationBuckets.some((item) => item.key === candidate.key));

  const cards: WeeklyPositionalFocusCard[] = [];

  for (const bucket of remediationBuckets) {
    const carryOverCount = carryOverByKey.get(bucket.key)?.length ?? 0;
    const title = carryOverCount > 0 ? `Carry over: ${bucket.statement}` : `Fix: ${bucket.statement}`;
    cards.push({
      id: `focus-${cards.length + 1}`,
      title: truncate(title, 120),
      focusType: carryOverCount > 0 ? 'carry-over' : 'remediate-weakness',
      priority: cards.length + 1,
      position: uniqueStrings(bucket.positions, 1)[0] ?? 'mixed-position',
      context: uniqueStrings(bucket.contexts, 1)[0] ?? 'live rounds',
      successCriteria: [
        `Run 4 positional rounds from ${uniqueStrings(bucket.positions, 1)[0] ?? 'assigned position'}.`,
        'Keep failed outcomes to 1 or fewer per round in at least 3 rounds.',
        'Capture at least 2 successful corrections in the session log.'
      ],
      rationale: truncate(
        `Recurring failures (${bucket.count}) plus active one-thing cues indicate this is the highest remediation need this week.`,
        180
      ),
      linkedOneThingCues: oneThingCues,
      recurringFailures: uniqueStrings(bucket.recurringFailures, 3),
      references: mostRecentReference(bucket.references),
      status: 'pending'
    });
  }

  if (cards.length === 0 && carryOverCards.length > 0) {
    const carry = carryOverCards[0];
    cards.push({
      ...carry,
      id: `focus-${cards.length + 1}`,
      priority: cards.length + 1,
      focusType: 'carry-over',
      rationale: truncate(
        carry.rationale || 'Carry-over card kept active because prior weekly focus remained incomplete.',
        180
      ),
      linkedOneThingCues: uniqueStrings([...carry.linkedOneThingCues, ...oneThingCues], MAX_ONE_THING_CUES),
      status: 'pending'
    });
  }

  if (reinforcementBucket) {
    cards.push({
      id: `focus-${cards.length + 1}`,
      title: truncate(`Reinforce: ${reinforcementBucket.statement}`, 120),
      focusType: 'reinforce-strength',
      priority: cards.length + 1,
      position: uniqueStrings(reinforcementBucket.positions, 1)[0] ?? primarySkills[0] ?? 'mixed-position',
      context: uniqueStrings(reinforcementBucket.contexts, 1)[0] ?? 'live rounds',
      successCriteria: [
        'Start 3 rounds in this position/context.',
        'Hit the target success sequence at least 2 times under resistance.',
        'Document the trigger and finish details in post-session notes.'
      ],
      rationale: truncate(
        `Recent wins (${reinforcementBucket.count}) justify reinforcement to preserve strengths while remediation work is in progress.`,
        180
      ),
      linkedOneThingCues: oneThingCues,
      recurringFailures: [],
      references: mostRecentReference(reinforcementBucket.references),
      status: 'pending'
    });
  }

  if (cards.length === 0) {
    cards.push({
      id: 'focus-1',
      title: `Reinforce: ${primarySkills[0] ?? oneFocuses[0] ?? 'base positioning'}`,
      focusType: 'reinforce-strength',
      priority: 1,
      position: 'mixed-position',
      context: 'live rounds',
      successCriteria: [
        'Start 3 rounds from the assigned position.',
        'Track 2 successful executions with clean decision timing.'
      ],
      rationale: 'Fallback focus generated because recent logs lacked recurring signal density.',
      linkedOneThingCues: uniqueStrings(oneFocuses, MAX_ONE_THING_CUES),
      recurringFailures: [],
      references: [],
      status: 'pending'
    });
  }

  return cards.slice(0, MAX_POSITIONAL_FOCUS_CARDS);
};

export const buildWeeklyPlanFromSignals = (signal: BuilderSignal): WeeklyPlan => {
  const explainability: WeeklyPlanExplainabilityItem[] = [];
  const candidateMap = buildCandidateMap();
  const leaks: string[] = [];
  const wins: string[] = [];
  const oneFocuses: string[] = [];
  const drillHints: string[] = [];
  const positionalHints: string[] = [];
  const fallbackHints: string[] = [];

  for (const entry of signal.entries) {
    const actionPack = getActionPack(entry);
    if (!actionPack) {
      continue;
    }

    for (const leak of actionPack.leaks) {
      if (!leak.trim()) continue;
      leaks.push(leak);
      const candidate = ensureCandidate(candidateMap, leak, leak);
      candidate.score += 4;
      candidate.reasons.push('Frequent leak in recent GPT action packs');
      pushReference(candidate, {
        sourceType: 'entry-action-pack',
        sourceId: entry.entryId,
        createdAt: entry.createdAt,
        summary: truncate(leak, 120)
      });
    }

    for (const win of actionPack.wins) {
      if (!win.trim()) continue;
      wins.push(win);
      const candidate = ensureCandidate(candidateMap, win, win);
      candidate.score += 1;
      candidate.reasons.push('Recent win to reinforce');
      pushReference(candidate, {
        sourceType: 'entry-action-pack',
        sourceId: entry.entryId,
        createdAt: entry.createdAt,
        summary: truncate(win, 120)
      });
    }

    if (actionPack.oneFocus.trim()) {
      oneFocuses.push(actionPack.oneFocus.trim());
      const candidate = ensureCandidate(candidateMap, actionPack.oneFocus, actionPack.oneFocus);
      candidate.score += 3;
      candidate.reasons.push('One-focus cue from structured session');
      pushReference(candidate, {
        sourceType: 'entry-action-pack',
        sourceId: entry.entryId,
        createdAt: entry.createdAt,
        summary: truncate(actionPack.oneFocus, 120)
      });
    }

    drillHints.push(...actionPack.drills.filter((item) => item.trim()));
    positionalHints.push(...actionPack.positionalRequests.filter((item) => item.trim()));
    if (actionPack.fallbackDecisionGuidance.trim()) {
      fallbackHints.push(actionPack.fallbackDecisionGuidance.trim());
    }
  }

  for (const checkoff of signal.checkoffs) {
    const candidate = ensureCandidate(candidateMap, checkoff.skillId, checkoff.skillId);
    const statusScore = scoreFromCheckoffStatus(checkoff.status);
    candidate.score += statusScore;
    candidate.reasons.push(`Checkoff status ${checkoff.status}`);
    pushReference(candidate, {
      sourceType: 'checkoff',
      sourceId: checkoff.checkoffId,
      createdAt: checkoff.updatedAt,
      summary: `Checkoff ${checkoff.status} (${checkoff.confirmedEvidenceCount}/${checkoff.minEvidenceRequired})`
    });
  }

  if (signal.curriculumGraph) {
    for (const node of signal.curriculumGraph.nodes) {
      addGraphNodeScore(candidateMap, node, signal.curriculumGraph.updatedAt);
    }
  }

  for (const priorPlan of signal.priorPlans) {
    const incompleteItems = [...priorPlan.drills, ...priorPlan.positionalRounds, ...priorPlan.constraints].filter(
      (item) => item.status === 'pending'
    ).length;

    for (const skill of priorPlan.primarySkills) {
      const candidate = ensureCandidate(candidateMap, skill, skill);
      candidate.score += incompleteItems > 0 ? 2 : -1;
      candidate.reasons.push(
        incompleteItems > 0
          ? 'Prior weekly plan has incomplete work'
          : 'Prior weekly plan completed; lower immediate priority'
      );
      pushReference(candidate, {
        sourceType: 'weekly-plan',
        sourceId: priorPlan.planId,
        createdAt: priorPlan.updatedAt,
        summary: `Prior week status ${priorPlan.status}`
      });
    }
  }

  const sortedCandidates = [...candidateMap.values()].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.references.length - a.references.length;
  });

  const positive = sortedCandidates.filter((candidate) => candidate.score > 0);
  const chosen = (positive.length > 0 ? positive : sortedCandidates).slice(0, MAX_PRIMARY_SKILLS);
  if (chosen.length === 0) {
    chosen.push({
      skillId: 'base-positioning',
      label: 'Base positioning',
      score: 1,
      reasons: ['Fallback baseline skill'],
      references: []
    });
  }

  const primarySkills = chosen.map((candidate) => ensureNonEmpty(candidate.label, labelFromSkillId(candidate.skillId)));

  for (const primary of chosen) {
    addExplainability(
      explainability,
      'primary-skill',
      primary.label,
      primary.reasons.slice(0, 2).join('; '),
      mostRecentReference(primary.references)
    );
  }

  const graphNodeBySkill = new Map(
    (signal.curriculumGraph?.nodes ?? []).map((node) => [asSkillId(node.skillId), node] as const)
  );

  const firstPrimary = chosen[0];
  const firstGraphNode = firstPrimary ? graphNodeBySkill.get(firstPrimary.skillId) : undefined;
  const supportingConcept =
    firstGraphNode?.supportingConcepts?.find((item) => item.trim()) ??
    oneFocuses.find((item) => item.trim()) ??
    'Win inside position before adding speed.';

  const supportingReferences: WeeklyPlanReference[] = [];
  if (firstGraphNode?.supportingConcepts?.length) {
    supportingReferences.push({
      sourceType: 'curriculum-graph',
      sourceId: firstGraphNode.skillId,
      createdAt: signal.curriculumGraph?.updatedAt,
      summary: truncate(firstGraphNode.supportingConcepts[0], 120)
    });
  } else if (signal.entries[0]) {
    supportingReferences.push({
      sourceType: 'entry-action-pack',
      sourceId: signal.entries[0].entryId,
      createdAt: signal.entries[0].createdAt,
      summary: truncate(oneFocuses[0] ?? supportingConcept, 120)
    });
  }
  addExplainability(
    explainability,
    'supporting-concept',
    supportingConcept,
    'Selected from curriculum node concept or most recent one-focus cue.',
    supportingReferences
  );

  const conditioningConstraint =
    firstGraphNode?.conditioningConstraints?.find((item) => item.trim()) ?? inferConstraintFromLeak(leaks);
  const constraintReferences: WeeklyPlanReference[] = [];
  if (firstGraphNode?.conditioningConstraints?.length) {
    constraintReferences.push({
      sourceType: 'curriculum-graph',
      sourceId: firstGraphNode.skillId,
      createdAt: signal.curriculumGraph?.updatedAt,
      summary: truncate(firstGraphNode.conditioningConstraints[0], 120)
    });
  } else if (signal.entries[0]) {
    constraintReferences.push({
      sourceType: 'entry-action-pack',
      sourceId: signal.entries[0].entryId,
      createdAt: signal.entries[0].createdAt,
      summary: truncate(leaks[0] ?? conditioningConstraint, 120)
    });
  }
  addExplainability(
    explainability,
    'conditioning-constraint',
    conditioningConstraint,
    'Constraint tied to conditioning leak patterns or curriculum defaults.',
    constraintReferences
  );

  const drills = toMenuItems(
    [
      ...chosen.map(
        (candidate) =>
          drillHints.find((hint) => hint.toLowerCase().includes(candidate.skillId.replace(/-/g, ' '))) ??
          `3 x 2m isolated reps focused on ${candidate.label}.`
      ),
      ...drillHints,
      ...oneFocuses.map((focus) => `Decision drill: ${focus}`)
    ],
    'drill'
  );

  const constraints = toMenuItems(
    [
      conditioningConstraint,
      ...fallbackHints.map((hint) => `Fallback rule: ${hint}`),
      `Coaching cue: ${supportingConcept}`
    ],
    'constraint'
  );

  const positionalFocusCards = buildWeeklyPositionalFocusCards(
    signal.entries,
    signal.priorPlans,
    oneFocuses,
    primarySkills,
    signal.nowIso
  );

  const positionalRounds = toMenuItems(
    [
      ...positionalHints,
      ...positionalFocusCards.map((card) => `${card.position}: ${card.title}`),
      ...chosen.map((candidate) => `2 x 5m positional rounds centered on ${candidate.label}.`)
    ],
    'round'
  );

  for (const drill of drills) {
    addExplainability(
      explainability,
      'drill',
      drill.label,
      'Drill selected to reinforce top primary skill and one-focus cue.',
      chosen[0]?.references.slice(0, 2) ?? []
    );
  }

  for (const round of positionalRounds) {
    addExplainability(
      explainability,
      'positional-round',
      round.label,
      'Positional round aligns to repeated failure positions in structured sessions.',
      signal.entries.slice(0, 2).map((entry) => ({
        sourceType: 'entry-action-pack',
        sourceId: entry.entryId,
        createdAt: entry.createdAt,
        summary: truncate((getActionPack(entry)?.positionalRequests?.[0] ?? round.label), 120)
      }))
    );
  }

  for (const card of positionalFocusCards) {
    addExplainability(
      explainability,
      'positional-round',
      card.title,
      card.rationale,
      card.references
    );
  }

  for (const constraint of constraints) {
    addExplainability(
      explainability,
      'training-constraint',
      constraint.label,
      'Constraint keeps conditioning and decision-quality aligned to current leaks.',
      constraintReferences
    );
  }

  return {
    planId: uuidv4(),
    athleteId: signal.entries[0]?.athleteId ?? signal.checkoffs[0]?.athleteId ?? signal.curriculumGraph?.athleteId ?? 'unknown',
    weekOf: normalizeWeekDate(signal.weekOf),
    generatedAt: signal.nowIso,
    updatedAt: signal.nowIso,
    status: 'active',
    primarySkills,
    supportingConcept: truncate(supportingConcept, 140),
    conditioningConstraint: truncate(conditioningConstraint, 180),
    drills,
    positionalRounds,
    constraints,
    positionalFocus: {
      cards: positionalFocusCards,
      locked: false,
      updatedAt: signal.nowIso
    },
    explainability,
  };
};

export const weeklyPlanPk = (athleteId: string): string => `USER#${athleteId}`;
export const weeklyPlanSk = (weekOf: string, planId: string): string => `WEEKLY_PLAN#${weekOf}#${planId}`;
export const weeklyPlanMetaPk = (planId: string): string => `WEEKLY_PLAN#${planId}`;

export const parseWeeklyPlanRecord = (item: Record<string, unknown>): WeeklyPlan => {
  const { PK: _pk, SK: _sk, entityType: _entityType, ...rest } = item;
  void _pk;
  void _sk;
  void _entityType;

  const record = rest as Partial<WeeklyPlan> & Record<string, unknown>;

  const parseMenu = (value: unknown): WeeklyPlanMenuItem[] => {
    if (!Array.isArray(value)) return [];
    return value
      .map((raw, index) => {
        if (typeof raw !== 'object' || raw === null) return null;
        const item = raw as Record<string, unknown>;
        const label = typeof item.label === 'string' ? item.label : '';
        if (!label.trim()) return null;
        const status = item.status;
        const parsedStatus: WeeklyPlanMenuItem['status'] =
          status === 'done' || status === 'skipped' || status === 'pending' ? status : 'pending';
        return {
          id: typeof item.id === 'string' && item.id.trim() ? item.id : `item-${index + 1}`,
          label: label.trim(),
          status: parsedStatus,
          ...(typeof item.completedAt === 'string' ? { completedAt: item.completedAt } : {}),
          ...(typeof item.coachNote === 'string' ? { coachNote: item.coachNote } : {})
        };
      })
      .filter((item): item is WeeklyPlanMenuItem => item !== null);
  };

  const parseStatus = (value: unknown): WeeklyPlanStatus =>
    value === 'draft' || value === 'active' || value === 'completed' ? value : 'active';

  const parsePositionalFocusCards = (value: unknown): WeeklyPositionalFocusCard[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((raw, index) => {
        if (typeof raw !== 'object' || raw === null) {
          return null;
        }
        const card = raw as Record<string, unknown>;
        const title = typeof card.title === 'string' ? card.title.trim() : '';
        if (!title) {
          return null;
        }
        const status = card.status;
        const parsedStatus: WeeklyPlanItemStatus =
          status === 'done' || status === 'skipped' || status === 'pending' ? status : 'pending';
        const priority = typeof card.priority === 'number' && Number.isInteger(card.priority) && card.priority > 0
          ? card.priority
          : index + 1;
        return {
          id: typeof card.id === 'string' && card.id.trim() ? card.id.trim() : `focus-${index + 1}`,
          title,
          focusType:
            card.focusType === 'remediate-weakness' ||
            card.focusType === 'reinforce-strength' ||
            card.focusType === 'carry-over'
              ? card.focusType
              : 'remediate-weakness',
          priority,
          position: typeof card.position === 'string' && card.position.trim() ? card.position.trim() : 'mixed-position',
          context: typeof card.context === 'string' && card.context.trim() ? card.context.trim() : 'live rounds',
          successCriteria: Array.isArray(card.successCriteria)
            ? card.successCriteria.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : [],
          rationale: typeof card.rationale === 'string' ? card.rationale : '',
          linkedOneThingCues: Array.isArray(card.linkedOneThingCues)
            ? card.linkedOneThingCues.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : [],
          recurringFailures: Array.isArray(card.recurringFailures)
            ? card.recurringFailures.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : [],
          references: Array.isArray(card.references) ? (card.references as WeeklyPlanReference[]) : [],
          status: parsedStatus,
          ...(typeof card.coachNote === 'string' && card.coachNote.trim() ? { coachNote: card.coachNote.trim() } : {})
        };
      })
      .filter((item): item is WeeklyPositionalFocusCard => item !== null);
  };

  const parsePositionalFocus = (
    value: unknown,
    fallbackRounds: WeeklyPlanMenuItem[]
  ): WeeklyPlan['positionalFocus'] => {
    if (typeof value === 'object' && value !== null) {
      const focus = value as Record<string, unknown>;
      const cards = parsePositionalFocusCards(focus.cards);
      if (cards.length > 0) {
        return {
          cards: cards
            .sort((a, b) => a.priority - b.priority)
            .map((card, index) => ({
              ...card,
              priority: index + 1
            })),
          locked: Boolean(focus.locked),
          ...(typeof focus.lockedAt === 'string' && focus.lockedAt.trim() ? { lockedAt: focus.lockedAt.trim() } : {}),
          ...(typeof focus.lockedBy === 'string' && focus.lockedBy.trim() ? { lockedBy: focus.lockedBy.trim() } : {}),
          updatedAt: typeof focus.updatedAt === 'string' && focus.updatedAt.trim() ? focus.updatedAt.trim() : new Date(0).toISOString()
        };
      }
    }

    return {
      cards: fallbackRounds.slice(0, 3).map((round, index) => ({
        id: `focus-${index + 1}`,
        title: round.label,
        focusType: 'remediate-weakness',
        priority: index + 1,
        position: round.label.split(':')[0]?.trim() || 'mixed-position',
        context: 'live rounds',
        successCriteria: ['Run 3 rounds from this starting position and log outcomes.'],
        rationale: 'Migrated from legacy positional rounds.',
        linkedOneThingCues: [],
        recurringFailures: [],
        references: [],
        status: round.status,
        ...(round.coachNote ? { coachNote: round.coachNote } : {})
      })),
      locked: false,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString()
    };
  };

  const parsedDrills = parseMenu(record.drills);
  const parsedPositionalRounds = parseMenu(record.positionalRounds);
  const parsedConstraints = parseMenu(record.constraints);

  return {
    planId: typeof record.planId === 'string' ? record.planId : uuidv4(),
    athleteId: typeof record.athleteId === 'string' ? record.athleteId : '',
    weekOf: typeof record.weekOf === 'string' ? record.weekOf : '',
    generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
    status: parseStatus(record.status),
    primarySkills: Array.isArray(record.primarySkills)
      ? record.primarySkills.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
    supportingConcept: typeof record.supportingConcept === 'string' ? record.supportingConcept : '',
    conditioningConstraint: typeof record.conditioningConstraint === 'string' ? record.conditioningConstraint : '',
    drills: parsedDrills,
    positionalRounds: parsedPositionalRounds,
    constraints: parsedConstraints,
    positionalFocus: parsePositionalFocus(record.positionalFocus, parsedPositionalRounds),
    explainability: Array.isArray(record.explainability)
      ? (record.explainability as WeeklyPlanExplainabilityItem[])
      : [],
    ...(typeof record.coachReview === 'object' && record.coachReview !== null
      ? { coachReview: record.coachReview as WeeklyPlan['coachReview'] }
      : {}),
    ...(typeof record.completion === 'object' && record.completion !== null
      ? { completion: record.completion as WeeklyPlan['completion'] }
      : {})
  };
};

export const buildWeeklyPlanRecord = (plan: WeeklyPlan): Record<string, unknown> => ({
  PK: weeklyPlanPk(plan.athleteId),
  SK: weeklyPlanSk(plan.weekOf, plan.planId),
  entityType: 'WEEKLY_PLAN',
  ...plan
});

export const buildWeeklyPlanMetaRecord = (plan: WeeklyPlan): Record<string, unknown> => ({
  PK: weeklyPlanMetaPk(plan.planId),
  SK: 'META',
  entityType: 'WEEKLY_PLAN_META',
  athleteId: plan.athleteId,
  weekOf: plan.weekOf,
  createdAt: plan.generatedAt,
  updatedAt: plan.updatedAt
});

export const buildGraphSk = (): string => 'CURRICULUM_GRAPH#ACTIVE';
