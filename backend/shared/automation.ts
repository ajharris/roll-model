import { v4 as uuidv4 } from 'uuid';

import { getOpenAIApiKey } from './openai';
import { ApiError } from './responses';
import type {
  AutomationNotification,
  AutomationSettings,
  AutomationSettingsUpdateRequest,
  Checkoff,
  Entry,
  WeeklyDigestArtifact,
  WeeklyDigestRecommendation,
  WeeklyPlan
} from './types';

const DOW_MIN = 1;
const DOW_MAX = 7;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sanitizeStringArray = (value: unknown, max = 8): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    deduped.add(trimmed);
    if (deduped.size >= max) {
      break;
    }
  }

  return [...deduped];
};

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const parseMinuteOfDay = (value: string): number | null => {
  const match = value.match(TIME_REGEX);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const mapWeekdayToIso = (weekday: string): number => {
  switch (weekday.toLowerCase()) {
    case 'mon':
      return 1;
    case 'tue':
      return 2;
    case 'wed':
      return 3;
    case 'thu':
      return 4;
    case 'fri':
      return 5;
    case 'sat':
      return 6;
    default:
      return 7;
  }
};

export interface ZonedNow {
  timezone: string;
  localDate: string;
  localTime: string;
  minuteOfDay: number;
  dayOfWeek: number;
}

export const getZonedNow = (nowIso: string, timezone: string): ZonedNow => {
  const date = new Date(nowIso);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Invalid date value.',
      statusCode: 400
    });
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short'
  });

  const parts = formatter.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  const year = lookup('year');
  const month = lookup('month');
  const day = lookup('day');
  const hour = lookup('hour');
  const minute = lookup('minute');
  const weekday = lookup('weekday');

  const localTime = `${hour}:${minute}`;
  const minuteOfDay = parseMinuteOfDay(localTime) ?? 0;

  return {
    timezone,
    localDate: `${year}-${month}-${day}`,
    localTime,
    minuteOfDay,
    dayOfWeek: mapWeekdayToIso(weekday)
  };
};

const isValidTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const normalizeDaySet = (value: unknown, fallback: number[]): number[] => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const out = new Set<number>();
  for (const day of value) {
    if (typeof day !== 'number' || !Number.isInteger(day)) {
      continue;
    }
    if (day < DOW_MIN || day > DOW_MAX) {
      continue;
    }
    out.add(day);
  }

  return out.size > 0 ? [...out].sort((a, b) => a - b) : [...fallback];
};

export const defaultAutomationSettings = (athleteId: string, nowIso: string, updatedBy: string): AutomationSettings => ({
  athleteId,
  timezone: 'UTC',
  afterClassReminder: {
    enabled: false,
    daysOfWeek: [1, 2, 3, 4, 5],
    localTime: '20:00',
    remindAfterMinutes: 90
  },
  weeklyDigest: {
    enabled: false,
    dayOfWeek: 1,
    localTime: '19:00'
  },
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '07:00'
  },
  updatedAt: nowIso,
  updatedBy
});

export const parseAutomationSettingsRecord = (item: Record<string, unknown>): AutomationSettings | null => {
  if (item.entityType !== 'AUTOMATION_SETTINGS' || typeof item.athleteId !== 'string') {
    return null;
  }

  const nowIso = typeof item.updatedAt === 'string' ? item.updatedAt : new Date(0).toISOString();
  const base = defaultAutomationSettings(
    item.athleteId,
    nowIso,
    typeof item.updatedBy === 'string' ? item.updatedBy : item.athleteId
  );

  const timezone = typeof item.timezone === 'string' && isValidTimezone(item.timezone) ? item.timezone : base.timezone;
  const afterClassReminder = isRecord(item.afterClassReminder) ? item.afterClassReminder : {};
  const weeklyDigest = isRecord(item.weeklyDigest) ? item.weeklyDigest : {};
  const quietHours = isRecord(item.quietHours) ? item.quietHours : {};

  const parsedAfterClassTime =
    typeof afterClassReminder.localTime === 'string' && parseMinuteOfDay(afterClassReminder.localTime) !== null
      ? afterClassReminder.localTime
      : base.afterClassReminder.localTime;
  const parsedWeeklyDigestTime =
    typeof weeklyDigest.localTime === 'string' && parseMinuteOfDay(weeklyDigest.localTime) !== null
      ? weeklyDigest.localTime
      : base.weeklyDigest.localTime;
  const parsedQuietStart =
    typeof quietHours.start === 'string' && parseMinuteOfDay(quietHours.start) !== null
      ? quietHours.start
      : base.quietHours.start;
  const parsedQuietEnd =
    typeof quietHours.end === 'string' && parseMinuteOfDay(quietHours.end) !== null ? quietHours.end : base.quietHours.end;

  return {
    athleteId: item.athleteId,
    timezone,
    afterClassReminder: {
      enabled: Boolean(afterClassReminder.enabled),
      daysOfWeek: normalizeDaySet(afterClassReminder.daysOfWeek, base.afterClassReminder.daysOfWeek),
      localTime: parsedAfterClassTime,
      remindAfterMinutes:
        typeof afterClassReminder.remindAfterMinutes === 'number' && Number.isFinite(afterClassReminder.remindAfterMinutes)
          ? clamp(Math.floor(afterClassReminder.remindAfterMinutes), 0, 720)
          : base.afterClassReminder.remindAfterMinutes
    },
    weeklyDigest: {
      enabled: Boolean(weeklyDigest.enabled),
      dayOfWeek:
        typeof weeklyDigest.dayOfWeek === 'number' &&
        Number.isInteger(weeklyDigest.dayOfWeek) &&
        weeklyDigest.dayOfWeek >= DOW_MIN &&
        weeklyDigest.dayOfWeek <= DOW_MAX
          ? weeklyDigest.dayOfWeek
          : base.weeklyDigest.dayOfWeek,
      localTime: parsedWeeklyDigestTime
    },
    quietHours: {
      enabled: Boolean(quietHours.enabled),
      start: parsedQuietStart,
      end: parsedQuietEnd
    },
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : nowIso,
    updatedBy: typeof item.updatedBy === 'string' ? item.updatedBy : base.updatedBy
  };
};

export const buildAutomationSettingsRecord = (settings: AutomationSettings): Record<string, unknown> => ({
  PK: `USER#${settings.athleteId}`,
  SK: 'AUTOMATION_SETTINGS',
  GSI1PK: 'AUTOMATION_SETTINGS',
  GSI1SK: `USER#${settings.athleteId}`,
  entityType: 'AUTOMATION_SETTINGS',
  ...settings
});

export const mergeAutomationSettings = (
  existing: AutomationSettings,
  patch: AutomationSettingsUpdateRequest,
  nowIso: string,
  updatedBy: string
): AutomationSettings => {
  const timezone =
    typeof patch.timezone === 'string' && patch.timezone.trim() && isValidTimezone(patch.timezone.trim())
      ? patch.timezone.trim()
      : existing.timezone;

  const parsePatchedTime = (value: unknown, fallback: string): string =>
    typeof value === 'string' && parseMinuteOfDay(value) !== null ? value : fallback;

  return {
    athleteId: existing.athleteId,
    timezone,
    afterClassReminder: {
      enabled:
        typeof patch.afterClassReminder?.enabled === 'boolean'
          ? patch.afterClassReminder.enabled
          : existing.afterClassReminder.enabled,
      daysOfWeek:
        patch.afterClassReminder?.daysOfWeek !== undefined
          ? normalizeDaySet(patch.afterClassReminder.daysOfWeek, existing.afterClassReminder.daysOfWeek)
          : existing.afterClassReminder.daysOfWeek,
      localTime: parsePatchedTime(patch.afterClassReminder?.localTime, existing.afterClassReminder.localTime),
      remindAfterMinutes:
        typeof patch.afterClassReminder?.remindAfterMinutes === 'number' &&
        Number.isFinite(patch.afterClassReminder.remindAfterMinutes)
          ? clamp(Math.floor(patch.afterClassReminder.remindAfterMinutes), 0, 720)
          : existing.afterClassReminder.remindAfterMinutes
    },
    weeklyDigest: {
      enabled:
        typeof patch.weeklyDigest?.enabled === 'boolean' ? patch.weeklyDigest.enabled : existing.weeklyDigest.enabled,
      dayOfWeek:
        typeof patch.weeklyDigest?.dayOfWeek === 'number' &&
        Number.isInteger(patch.weeklyDigest.dayOfWeek) &&
        patch.weeklyDigest.dayOfWeek >= DOW_MIN &&
        patch.weeklyDigest.dayOfWeek <= DOW_MAX
          ? patch.weeklyDigest.dayOfWeek
          : existing.weeklyDigest.dayOfWeek,
      localTime: parsePatchedTime(patch.weeklyDigest?.localTime, existing.weeklyDigest.localTime)
    },
    quietHours: {
      enabled: typeof patch.quietHours?.enabled === 'boolean' ? patch.quietHours.enabled : existing.quietHours.enabled,
      start: parsePatchedTime(patch.quietHours?.start, existing.quietHours.start),
      end: parsePatchedTime(patch.quietHours?.end, existing.quietHours.end)
    },
    updatedAt: nowIso,
    updatedBy
  };
};

export const isWithinQuietHours = (zoned: ZonedNow, settings: AutomationSettings): boolean => {
  if (!settings.quietHours.enabled) {
    return false;
  }

  const start = parseMinuteOfDay(settings.quietHours.start);
  const end = parseMinuteOfDay(settings.quietHours.end);
  if (start === null || end === null) {
    return false;
  }

  if (start === end) {
    return false;
  }

  if (start < end) {
    return zoned.minuteOfDay >= start && zoned.minuteOfDay < end;
  }

  return zoned.minuteOfDay >= start || zoned.minuteOfDay < end;
};

const mondayForLocalDate = (localDate: string, dayOfWeek: number): string => {
  const [year, month, day] = localDate.split('-').map((value) => Number(value));
  const utc = new Date(Date.UTC(year, month - 1, day));
  const offset = dayOfWeek - 1;
  utc.setUTCDate(utc.getUTCDate() - offset);
  return utc.toISOString().slice(0, 10);
};

export interface DueAutomationSignals {
  afterClassDue: boolean;
  weeklyDigestDue: boolean;
  reminderDispatchKey: string;
  digestWeekOf: string;
}

export const evaluateAutomationDue = (settings: AutomationSettings, nowIso: string): DueAutomationSignals => {
  const zoned = getZonedNow(nowIso, settings.timezone);
  const inQuietHours = isWithinQuietHours(zoned, settings);

  const afterClassTime = parseMinuteOfDay(settings.afterClassReminder.localTime) ?? 0;
  const afterClassDueMinute = afterClassTime + settings.afterClassReminder.remindAfterMinutes;
  const afterClassDue =
    settings.afterClassReminder.enabled &&
    !inQuietHours &&
    settings.afterClassReminder.daysOfWeek.includes(zoned.dayOfWeek) &&
    zoned.minuteOfDay >= afterClassDueMinute;

  const digestTime = parseMinuteOfDay(settings.weeklyDigest.localTime) ?? 0;
  const weeklyDigestDue =
    settings.weeklyDigest.enabled &&
    !inQuietHours &&
    settings.weeklyDigest.dayOfWeek === zoned.dayOfWeek &&
    zoned.minuteOfDay >= digestTime;

  return {
    afterClassDue,
    weeklyDigestDue,
    reminderDispatchKey: `${zoned.localDate}`,
    digestWeekOf: mondayForLocalDate(zoned.localDate, zoned.dayOfWeek)
  };
};

export const notificationPk = (athleteId: string): string => `USER#${athleteId}`;
export const afterClassNotificationSk = (dispatchKey: string): string => `NOTIFICATION#AFTER_CLASS#${dispatchKey}`;
export const weeklyDigestNotificationSk = (weekOf: string): string => `NOTIFICATION#WEEKLY_DIGEST#${weekOf}`;

export const buildAfterClassNotification = (
  athleteId: string,
  settings: AutomationSettings,
  nowIso: string,
  dispatchKey: string,
  hint = 'Log your session while details are fresh. Add quick notes and let GPT structure the review.'
): AutomationNotification => {
  const zoned = getZonedNow(nowIso, settings.timezone);
  return {
    notificationId: uuidv4(),
    athleteId,
    kind: 'after-class-reminder',
    status: 'sent',
    title: 'After-class log reminder',
    body: hint,
    localDate: zoned.localDate,
    localTime: zoned.localTime,
    timezone: settings.timezone,
    dispatchKey,
    createdAt: nowIso,
    updatedAt: nowIso,
    payload: {
      captureHint: hint
    }
  };
};

export const buildWeeklyDigestNotification = (
  athleteId: string,
  settings: AutomationSettings,
  nowIso: string,
  weekOf: string,
  digestId: string
): AutomationNotification => {
  const zoned = getZonedNow(nowIso, settings.timezone);
  return {
    notificationId: uuidv4(),
    athleteId,
    kind: 'weekly-digest',
    status: 'sent',
    title: 'Weekly review digest ready',
    body: 'Review trained/not-trained areas and carry your selected focus into next week.',
    localDate: zoned.localDate,
    localTime: zoned.localTime,
    timezone: settings.timezone,
    dispatchKey: weekOf,
    createdAt: nowIso,
    updatedAt: nowIso,
    payload: {
      digestId,
      weekOf
    }
  };
};

export const buildNotificationRecord = (
  athleteId: string,
  sk: string,
  notification: AutomationNotification
): Record<string, unknown> => ({
  PK: notificationPk(athleteId),
  SK: sk,
  entityType: 'AUTOMATION_NOTIFICATION',
  ...notification
});

export const parseNotificationRecord = (item: Record<string, unknown>): AutomationNotification | null => {
  if (item.entityType !== 'AUTOMATION_NOTIFICATION') {
    return null;
  }

  if (
    typeof item.notificationId !== 'string' ||
    typeof item.athleteId !== 'string' ||
    typeof item.kind !== 'string' ||
    typeof item.status !== 'string' ||
    typeof item.title !== 'string' ||
    typeof item.body !== 'string' ||
    typeof item.localDate !== 'string' ||
    typeof item.localTime !== 'string' ||
    typeof item.timezone !== 'string' ||
    typeof item.dispatchKey !== 'string' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  if (
    (item.kind !== 'after-class-reminder' && item.kind !== 'weekly-digest') ||
    (item.status !== 'sent' && item.status !== 'acted' && item.status !== 'dismissed')
  ) {
    return null;
  }

  return {
    notificationId: item.notificationId,
    athleteId: item.athleteId,
    kind: item.kind,
    status: item.status,
    title: item.title,
    body: item.body,
    localDate: item.localDate,
    localTime: item.localTime,
    timezone: item.timezone,
    dispatchKey: item.dispatchKey,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(typeof item.actedAt === 'string' ? { actedAt: item.actedAt } : {}),
    ...(isRecord(item.payload) ? { payload: item.payload as AutomationNotification['payload'] } : {})
  };
};

export const weeklyDigestSk = (weekOf: string, digestId: string): string => `WEEKLY_DIGEST#${weekOf}#${digestId}`;
export const weeklyDigestMetaPk = (digestId: string): string => `WEEKLY_DIGEST#${digestId}`;

export const buildWeeklyDigestRecord = (digest: WeeklyDigestArtifact): Record<string, unknown> => ({
  PK: `USER#${digest.athleteId}`,
  SK: weeklyDigestSk(digest.weekOf, digest.digestId),
  entityType: 'WEEKLY_DIGEST',
  ...digest
});

export const buildWeeklyDigestMetaRecord = (digest: WeeklyDigestArtifact): Record<string, unknown> => ({
  PK: weeklyDigestMetaPk(digest.digestId),
  SK: 'META',
  entityType: 'WEEKLY_DIGEST_META',
  athleteId: digest.athleteId,
  weekOf: digest.weekOf,
  createdAt: digest.generatedAt,
  updatedAt: digest.updatedAt
});

export const parseWeeklyDigestRecord = (item: Record<string, unknown>): WeeklyDigestArtifact | null => {
  if (item.entityType !== 'WEEKLY_DIGEST') {
    return null;
  }

  if (
    typeof item.digestId !== 'string' ||
    typeof item.athleteId !== 'string' ||
    typeof item.weekOf !== 'string' ||
    typeof item.timezone !== 'string' ||
    typeof item.generatedAt !== 'string' ||
    typeof item.updatedAt !== 'string' ||
    !Array.isArray(item.trained) ||
    !Array.isArray(item.notTrained) ||
    !Array.isArray(item.recommendedFocus) ||
    typeof item.summary !== 'string' ||
    !isRecord(item.sourceSummary) ||
    (item.generatedBy !== 'gpt' && item.generatedBy !== 'heuristic')
  ) {
    return null;
  }

  const recommendations: WeeklyDigestRecommendation[] = item.recommendedFocus
    .map((raw) => {
      if (!isRecord(raw) || typeof raw.recommendationId !== 'string' || typeof raw.text !== 'string') {
        return null;
      }
      return {
        recommendationId: raw.recommendationId,
        text: raw.text,
        selected: Boolean(raw.selected),
        ...(typeof raw.selectedAt === 'string' ? { selectedAt: raw.selectedAt } : {}),
        ...(typeof raw.selectedBy === 'string' ? { selectedBy: raw.selectedBy } : {})
      };
    })
    .filter((item): item is WeeklyDigestRecommendation => item !== null);

  return {
    digestId: item.digestId,
    athleteId: item.athleteId,
    weekOf: item.weekOf,
    timezone: item.timezone,
    generatedAt: item.generatedAt,
    updatedAt: item.updatedAt,
    trained: sanitizeStringArray(item.trained, 20),
    notTrained: sanitizeStringArray(item.notTrained, 20),
    recommendedFocus: recommendations,
    summary: item.summary,
    sourceSummary: {
      entryCount:
        typeof item.sourceSummary.entryCount === 'number' && Number.isFinite(item.sourceSummary.entryCount)
          ? Math.max(0, Math.floor(item.sourceSummary.entryCount))
          : 0,
      checkoffCount:
        typeof item.sourceSummary.checkoffCount === 'number' && Number.isFinite(item.sourceSummary.checkoffCount)
          ? Math.max(0, Math.floor(item.sourceSummary.checkoffCount))
          : 0,
      weeklyPlanCount:
        typeof item.sourceSummary.weeklyPlanCount === 'number' && Number.isFinite(item.sourceSummary.weeklyPlanCount)
          ? Math.max(0, Math.floor(item.sourceSummary.weeklyPlanCount))
          : 0
    },
    generatedBy: item.generatedBy,
    ...(isRecord(item.coachReview) &&
    typeof item.coachReview.reviewedBy === 'string' &&
    typeof item.coachReview.reviewedAt === 'string'
      ? {
          coachReview: {
            reviewedBy: item.coachReview.reviewedBy,
            reviewedAt: item.coachReview.reviewedAt,
            ...(typeof item.coachReview.notes === 'string' ? { notes: item.coachReview.notes } : {})
          }
        }
      : {})
  };
};

const compactStrings = (values: string[], max = 12): string[] => sanitizeStringArray(values, max);

const collectTrained = (entries: Entry[]): string[] => {
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.structured?.technique) out.push(entry.structured.technique);
    if (entry.structured?.position) out.push(entry.structured.position);
    for (const tag of entry.sessionMetrics.tags ?? []) {
      out.push(tag);
    }
    if (entry.actionPackFinal?.actionPack.oneFocus) {
      out.push(entry.actionPackFinal.actionPack.oneFocus);
    } else if (entry.actionPackDraft?.oneFocus) {
      out.push(entry.actionPackDraft.oneFocus);
    }
  }

  return compactStrings(out, 20);
};

const collectNotTrained = (weeklyPlans: WeeklyPlan[]): string[] => {
  const out: string[] = [];
  const latest = weeklyPlans[0];
  if (!latest) {
    return [];
  }

  for (const item of [...latest.drills, ...latest.positionalRounds, ...latest.constraints]) {
    if (item.status === 'pending') {
      out.push(item.label);
    }
  }

  for (const card of latest.positionalFocus.cards) {
    if (card.status === 'pending') {
      out.push(card.title);
    }
  }

  return compactStrings(out, 20);
};

const collectRecommendedFocus = (entries: Entry[], checkoffs: Checkoff[], weeklyPlans: WeeklyPlan[]): string[] => {
  const out: string[] = [];

  for (const checkoff of checkoffs) {
    if (checkoff.status === 'pending' || checkoff.status === 'superseded') {
      out.push(`${checkoff.skillId}: ${checkoff.status}`);
    }
  }

  const latest = weeklyPlans[0];
  if (latest) {
    out.push(...latest.primarySkills);
    for (const card of latest.positionalFocus.cards.slice(0, 3)) {
      out.push(card.title);
    }
  }

  const recentEntry = entries[0];
  if (recentEntry?.sessionReviewFinal?.review.oneThing) {
    out.push(recentEntry.sessionReviewFinal.review.oneThing);
  } else if (recentEntry?.sessionReviewDraft?.oneThing) {
    out.push(recentEntry.sessionReviewDraft.oneThing);
  }

  return compactStrings(out, 12);
};

const callOpenAIJson = async (systemPrompt: string, userPrompt: string): Promise<Record<string, unknown>> => {
  const apiKey = await getOpenAIApiKey();
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: systemPrompt }]
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: userPrompt }]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new ApiError({
      code: 'AI_PROVIDER_ERROR',
      message: 'Failed to generate weekly digest.',
      statusCode: 502
    });
  }

  const raw = (await response.json()) as { output_text?: string };
  if (!raw.output_text) {
    throw new ApiError({
      code: 'AI_PROVIDER_ERROR',
      message: 'Weekly digest response was empty.',
      statusCode: 502
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.output_text);
  } catch {
    throw new ApiError({
      code: 'AI_PROVIDER_ERROR',
      message: 'Weekly digest response was invalid JSON.',
      statusCode: 502
    });
  }

  if (!isRecord(parsed)) {
    throw new ApiError({
      code: 'AI_PROVIDER_ERROR',
      message: 'Weekly digest response format was invalid.',
      statusCode: 502
    });
  }

  return parsed;
};

const normalizeRecommendations = (values: string[], selectedByDefault = false): WeeklyDigestRecommendation[] =>
  values.slice(0, 8).map((text, index) => ({
    recommendationId: `focus-${index + 1}`,
    text,
    selected: selectedByDefault
  }));

export const buildWeeklyDigestHeuristic = (params: {
  athleteId: string;
  weekOf: string;
  timezone: string;
  nowIso: string;
  entries: Entry[];
  checkoffs: Checkoff[];
  weeklyPlans: WeeklyPlan[];
}): WeeklyDigestArtifact => {
  const trained = collectTrained(params.entries);
  const notTrained = collectNotTrained(params.weeklyPlans);
  const recommendedFocus = collectRecommendedFocus(params.entries, params.checkoffs, params.weeklyPlans);

  return {
    digestId: uuidv4(),
    athleteId: params.athleteId,
    weekOf: params.weekOf,
    timezone: params.timezone,
    generatedAt: params.nowIso,
    updatedAt: params.nowIso,
    trained,
    notTrained,
    recommendedFocus: normalizeRecommendations(recommendedFocus),
    summary:
      trained.length > 0
        ? `You trained ${trained.slice(0, 3).join(', ')}. Keep momentum by selecting 1-2 focus items for next week.`
        : 'No clear structured training signals were found. Log at least one session and select a starter focus.',
    sourceSummary: {
      entryCount: params.entries.length,
      checkoffCount: params.checkoffs.length,
      weeklyPlanCount: params.weeklyPlans.length
    },
    generatedBy: 'heuristic'
  };
};

export const buildWeeklyDigestWithGpt = async (params: {
  athleteId: string;
  weekOf: string;
  timezone: string;
  nowIso: string;
  entries: Entry[];
  checkoffs: Checkoff[];
  weeklyPlans: WeeklyPlan[];
}): Promise<WeeklyDigestArtifact> => {
  const heuristic = buildWeeklyDigestHeuristic(params);

  const digestInput = {
    weekOf: params.weekOf,
    timezone: params.timezone,
    sources: {
      entries: params.entries.map((entry) => ({
        entryId: entry.entryId,
        createdAt: entry.createdAt,
        structured: entry.structured,
        sessionMetrics: entry.sessionMetrics,
        actionPack: entry.actionPackFinal?.actionPack ?? entry.actionPackDraft,
        sessionReview: entry.sessionReviewFinal?.review ?? entry.sessionReviewDraft
      })),
      checkoffs: params.checkoffs,
      weeklyPlans: params.weeklyPlans.map((plan) => ({
        planId: plan.planId,
        weekOf: plan.weekOf,
        primarySkills: plan.primarySkills,
        drills: plan.drills,
        positionalRounds: plan.positionalRounds,
        constraints: plan.constraints,
        positionalFocus: plan.positionalFocus
      }))
    },
    fallback: {
      trained: heuristic.trained,
      notTrained: heuristic.notTrained,
      recommendedFocus: heuristic.recommendedFocus.map((item) => item.text)
    }
  };

  const parsed = await callOpenAIJson(
    [
      'You generate a weekly grappling training digest from structured records.',
      'Return strict JSON only with shape:',
      '{"summary": string, "trained": string[], "notTrained": string[], "recommendedFocus": string[]}',
      'Keep arrays concise (3-8 items each), concrete, and actionable.'
    ].join(' '),
    `Build weekly digest from this payload: ${JSON.stringify(digestInput)}`
  );

  const trained = compactStrings(Array.isArray(parsed.trained) ? (parsed.trained as unknown[]).map(String) : heuristic.trained, 16);
  const notTrained = compactStrings(
    Array.isArray(parsed.notTrained) ? (parsed.notTrained as unknown[]).map(String) : heuristic.notTrained,
    16
  );
  const recommendedFocus = compactStrings(
    Array.isArray(parsed.recommendedFocus)
      ? (parsed.recommendedFocus as unknown[]).map(String)
      : heuristic.recommendedFocus.map((item) => item.text),
    10
  );
  const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : heuristic.summary;

  return {
    ...heuristic,
    summary,
    trained: trained.length > 0 ? trained : heuristic.trained,
    notTrained: notTrained.length > 0 ? notTrained : heuristic.notTrained,
    recommendedFocus: normalizeRecommendations(recommendedFocus.length > 0 ? recommendedFocus : heuristic.recommendedFocus.map((item) => item.text)),
    generatedBy: 'gpt',
    updatedAt: params.nowIso
  };
};

export const applyWeeklyDigestSelection = (
  digest: WeeklyDigestArtifact,
  selectedRecommendationIds: string[] | undefined,
  actorId: string,
  nowIso: string
): WeeklyDigestArtifact => {
  if (!selectedRecommendationIds) {
    return digest;
  }

  const selected = new Set(selectedRecommendationIds);
  return {
    ...digest,
    recommendedFocus: digest.recommendedFocus.map((item) => ({
      ...item,
      selected: selected.has(item.recommendationId),
      ...(selected.has(item.recommendationId)
        ? {
            selectedAt: nowIso,
            selectedBy: actorId
          }
        : {
            selectedAt: undefined,
            selectedBy: undefined
          })
    })),
    updatedAt: nowIso
  };
};

export const applyWeeklyDigestEdits = (
  digest: WeeklyDigestArtifact,
  edits: Array<{ recommendationId: string; text: string }> | undefined,
  nowIso: string
): WeeklyDigestArtifact => {
  if (!edits || edits.length === 0) {
    return digest;
  }

  const editMap = new Map(edits.map((item) => [item.recommendationId, item.text.trim()]));
  return {
    ...digest,
    recommendedFocus: digest.recommendedFocus.map((item) => {
      const edited = editMap.get(item.recommendationId);
      return edited ? { ...item, text: edited } : item;
    }),
    updatedAt: nowIso
  };
};

export const selectedDigestFocus = (digest: WeeklyDigestArtifact): string[] =>
  digest.recommendedFocus.filter((item) => item.selected).map((item) => item.text);

