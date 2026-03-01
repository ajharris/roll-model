import { createHash, createHmac } from 'crypto';

import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { APIGatewayProxyEvent, APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { getAuthContext, hasRole } from '../../shared/auth';
import { putItem, queryItems } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { getOpenAIApiKey } from '../../shared/openai';
import { ApiError, errorResponse, response } from '../../shared/responses';

type FeedbackType = 'bug' | 'feature' | 'ui' | 'other';
type SubmissionStatus = 'submitted' | 'pending_review' | 'blocked' | 'failed';

type FeedbackRequest = {
  type: FeedbackType;
  title: string;
  details: string;
  steps?: string;
  expected?: string;
  actual?: string;
  appVersion?: string;
  environment?: string;
};

type FeedbackNormalization = {
  title: string;
  details: string;
  steps?: string;
  expected?: string;
  actual?: string;
  confidence: 'high' | 'medium' | 'low';
  reason?: string;
};

type FeedbackArtifact = {
  submittedAt: string;
  submissionId: string;
  status: SubmissionStatus;
  userId: string;
  userRole: string;
  actorHash: string;
  type: FeedbackType;
  originalPayload: FeedbackRequest;
  normalizedPayload: FeedbackRequest;
  normalizedByGpt: boolean;
  labels: string[];
  appVersion: string;
  environment: string;
  throttled: boolean;
  abuseSignals: string[];
  issueNumber?: number;
  issueUrl?: string;
  issueState?: 'open' | 'pending_review' | 'not_created' | 'failed';
  createdAt: string;
  updatedAt: string;
};

type FeedbackHistoryItem = {
  submittedAt: string;
  fingerprint: string;
};

const parseBody = (event: APIGatewayProxyEvent): FeedbackRequest => {
  if (!event.body) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400
    });
  }

  const parsed = JSON.parse(event.body) as Partial<FeedbackRequest>;
  const type = parsed.type;
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const details = typeof parsed.details === 'string' ? parsed.details.trim() : '';

  if (type !== 'bug' && type !== 'feature' && type !== 'ui' && type !== 'other') {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Feedback type must be bug, feature, ui, or other.',
      statusCode: 400
    });
  }

  if (!title || !details) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Title and details are required.',
      statusCode: 400
    });
  }

  const steps = typeof parsed.steps === 'string' ? parsed.steps.trim() : undefined;
  const expected = typeof parsed.expected === 'string' ? parsed.expected.trim() : undefined;
  const actual = typeof parsed.actual === 'string' ? parsed.actual.trim() : undefined;
  const appVersion = typeof parsed.appVersion === 'string' ? parsed.appVersion.trim() : undefined;
  const environment = typeof parsed.environment === 'string' ? parsed.environment.trim() : undefined;

  return {
    type,
    title,
    details,
    steps: steps || undefined,
    expected: expected || undefined,
    actual: actual || undefined,
    appVersion: appVersion || undefined,
    environment: environment || undefined
  };
};

const optionalHeader = (event: APIGatewayProxyEvent, headerName: string): string | undefined => {
  const target = headerName.toLowerCase();
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (name.toLowerCase() === target && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt((value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const parseCsv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const buildFingerprint = (payload: FeedbackRequest): string =>
  createHash('sha256')
    .update(`${payload.type}\n${payload.title.toLowerCase()}\n${payload.details.toLowerCase()}\n${payload.steps ?? ''}`)
    .digest('hex');

export const buildLabels = (type: FeedbackType): string[] => {
  if (type === 'bug') return ['bug', 'triage', 'user-feedback'];
  if (type === 'feature') return ['enhancement', 'triage', 'user-feedback'];
  if (type === 'ui') return ['ui-ux', 'triage', 'user-feedback'];
  return ['feedback', 'triage', 'user-feedback'];
};

const renderField = (value: string | undefined): string => (value && value.trim() ? value.trim() : '(not provided)');

const buildIssueBody = (params: {
  payload: FeedbackRequest;
  actorHash: string;
  actorRole: string;
  appVersion: string;
  environment: string;
  submittedAt: string;
  submissionId: string;
  normalizedByGpt: boolean;
}): string => {
  const {
    payload,
    actorHash,
    actorRole,
    appVersion,
    environment,
    submittedAt,
    submissionId,
    normalizedByGpt
  } = params;

  const sections = [
    '## Metadata',
    `- Submission ID: ${submissionId}`,
    `- Submitted at: ${submittedAt}`,
    `- App version: ${appVersion}`,
    `- Environment: ${environment}`,
    `- Actor role: ${actorRole}`,
    `- Actor hash: ${actorHash}`,
    `- Normalized by GPT: ${normalizedByGpt ? 'yes' : 'no'}`,
    '',
    '## Summary',
    payload.details
  ];

  if (payload.type === 'bug') {
    sections.push('', '## Steps to Reproduce', renderField(payload.steps));
    sections.push('', '## Expected Behavior', renderField(payload.expected));
    sections.push('', '## Actual Behavior', renderField(payload.actual));
  }

  if (payload.type === 'feature' || payload.type === 'ui' || payload.type === 'other') {
    sections.push('', '## Requested Outcome', renderField(payload.expected));
    sections.push('', '## Current Experience', renderField(payload.actual));
  }

  return sections.join('\n');
};

const ssm = new SSMClient({});
let cachedGithubToken: string | null = null;

const getGithubToken = async (): Promise<string> => {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  if (cachedGithubToken) {
    return cachedGithubToken;
  }

  const parameterName = process.env.GITHUB_TOKEN_SSM_PARAM;
  if (!parameterName) {
    throw new ApiError({
      code: 'CONFIGURATION_ERROR',
      message: 'GitHub integration is not configured.',
      statusCode: 500
    });
  }

  const result = await ssm.send(
    new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true
    })
  );

  const value = result.Parameter?.Value?.trim();
  if (!value) {
    throw new ApiError({
      code: 'CONFIGURATION_ERROR',
      message: 'GitHub integration is not configured.',
      statusCode: 500
    });
  }

  cachedGithubToken = value;
  return value;
};

const shouldNormalizeWithGpt = (payload: FeedbackRequest): boolean => {
  const mode = (process.env.FEEDBACK_NORMALIZE_MODE ?? 'auto').trim().toLowerCase();
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return payload.type === 'other' || payload.details.length > 500 || payload.title.length > 90;
};

const parseNormalizationPayload = (raw: unknown): FeedbackNormalization | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const details = typeof record.details === 'string' ? record.details.trim() : '';
  if (!title || !details) return null;

  const steps = typeof record.steps === 'string' ? record.steps.trim() : undefined;
  const expected = typeof record.expected === 'string' ? record.expected.trim() : undefined;
  const actual = typeof record.actual === 'string' ? record.actual.trim() : undefined;
  const confidenceRaw = typeof record.confidence === 'string' ? record.confidence.trim().toLowerCase() : '';
  const confidence =
    confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low' ? confidenceRaw : 'low';
  const reason = typeof record.reason === 'string' ? record.reason.trim() : undefined;

  return {
    title,
    details,
    steps: steps || undefined,
    expected: expected || undefined,
    actual: actual || undefined,
    confidence,
    reason: reason || undefined
  };
};

const normalizeWithGpt = async (payload: FeedbackRequest): Promise<FeedbackNormalization | null> => {
  const apiKey = await getOpenAIApiKey();
  const model = process.env.FEEDBACK_OPENAI_MODEL ?? 'gpt-4.1-mini';

  const prompt = [
    'Normalize this in-app product feedback into triage-ready fields.',
    'Return ONLY valid JSON with keys: title, details, steps, expected, actual, confidence, reason.',
    'Rules:',
    '1) Keep intent unchanged.',
    '2) Keep concise and actionable.',
    '3) Never add personal identity details.',
    '',
    `type: ${payload.type}`,
    `title: ${payload.title}`,
    `details: ${payload.details}`,
    `steps: ${payload.steps ?? ''}`,
    `expected: ${payload.expected ?? ''}`,
    `actual: ${payload.actual ?? ''}`
  ].join('\n');

  const result = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: prompt }]
        }
      ]
    })
  });

  if (!result.ok) {
    return null;
  }

  const parsed = (await result.json()) as { output_text?: string };
  if (!parsed.output_text) return null;

  try {
    return parseNormalizationPayload(JSON.parse(parsed.output_text));
  } catch {
    return null;
  }
};

const applyNormalization = (payload: FeedbackRequest, normalized: FeedbackNormalization | null): FeedbackRequest => {
  if (!normalized) {
    return payload;
  }

  return {
    ...payload,
    title: normalized.title,
    details: normalized.details,
    steps: normalized.steps ?? payload.steps,
    expected: normalized.expected ?? payload.expected,
    actual: normalized.actual ?? payload.actual
  };
};

const resolveFeedbackContext = (event: APIGatewayProxyEvent, payload: FeedbackRequest): { appVersion: string; environment: string } => {
  const appVersion =
    payload.appVersion ??
    optionalHeader(event, 'x-app-version') ??
    process.env.APP_VERSION?.trim() ??
    'unknown';

  const environment =
    payload.environment ??
    optionalHeader(event, 'x-app-environment') ??
    process.env.APP_ENV?.trim() ??
    event.requestContext.stage ??
    'unknown';

  return {
    appVersion,
    environment
  };
};

const buildActorHash = (userId: string, role: string): string => {
  const salt = process.env.FEEDBACK_ACTOR_HASH_SALT ?? process.env.GITHUB_REPO ?? 'roll-model-feedback-salt';
  return createHmac('sha256', salt).update(`${userId}:${role}`).digest('hex').slice(0, 24);
};

const readRecentHistory = async (userId: string, nowIso: string, dayWindowHours: number): Promise<FeedbackHistoryItem[]> => {
  const nowDate = new Date(nowIso);
  const sinceIso = new Date(nowDate.getTime() - dayWindowHours * 60 * 60 * 1000).toISOString();

  const result = await queryItems({
    KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
      ':start': `FEEDBACK_SUBMISSION#${sinceIso}`,
      ':end': 'FEEDBACK_SUBMISSION#~'
    },
    ScanIndexForward: false
  });

  return (
    result.Items?.flatMap((item) => {
      if (item.entityType !== 'FEEDBACK_SUBMISSION') {
        return [];
      }

      const submittedAt = typeof item.submittedAt === 'string' ? item.submittedAt : undefined;
      const fingerprint = typeof item.fingerprint === 'string' ? item.fingerprint : undefined;
      if (!submittedAt || !fingerprint) {
        return [];
      }

      return [{ submittedAt, fingerprint } satisfies FeedbackHistoryItem];
    }) ?? []
  );
};

const evaluateThrottling = (params: {
  history: FeedbackHistoryItem[];
  nowIso: string;
  fingerprint: string;
  perHourLimit: number;
  perDayLimit: number;
  duplicateWindowHours: number;
  duplicateLimit: number;
  cooldownSeconds: number;
}): { blocked: boolean; reasons: string[] } => {
  const nowMs = Date.parse(params.nowIso);
  const oneHourAgo = nowMs - 60 * 60 * 1000;
  const oneDayAgo = nowMs - 24 * 60 * 60 * 1000;
  const duplicateCutoff = nowMs - params.duplicateWindowHours * 60 * 60 * 1000;

  let perHour = 0;
  let perDay = 0;
  let duplicateCount = 0;
  let mostRecentMs = 0;

  for (const item of params.history) {
    const ts = Date.parse(item.submittedAt);
    if (!Number.isFinite(ts)) continue;

    if (ts > mostRecentMs) mostRecentMs = ts;
    if (ts >= oneHourAgo) perHour += 1;
    if (ts >= oneDayAgo) perDay += 1;
    if (ts >= duplicateCutoff && item.fingerprint === params.fingerprint) {
      duplicateCount += 1;
    }
  }

  const reasons: string[] = [];
  if (perHour >= params.perHourLimit) {
    reasons.push('rate_limit_hourly');
  }
  if (perDay >= params.perDayLimit) {
    reasons.push('rate_limit_daily');
  }
  if (duplicateCount >= params.duplicateLimit) {
    reasons.push('duplicate_feedback');
  }
  if (mostRecentMs > 0 && nowMs - mostRecentMs < params.cooldownSeconds * 1000) {
    reasons.push('submission_cooldown');
  }

  return {
    blocked: reasons.length > 0,
    reasons
  };
};

const shouldGateForReview = (environment: string, userRole: string): boolean => {
  const reviewRequiredEnvs = parseCsv(process.env.FEEDBACK_REVIEW_REQUIRED_ENVS);
  if (!reviewRequiredEnvs.length) return false;

  if (!reviewRequiredEnvs.includes(environment.toLowerCase())) {
    return false;
  }

  return userRole === 'athlete';
};

const saveArtifact = async (
  artifact: FeedbackArtifact,
  fingerprint: string,
): Promise<void> => {
  await putItem({
    Item: {
      PK: `USER#${artifact.userId}`,
      SK: `FEEDBACK_SUBMISSION#${artifact.submittedAt}#${artifact.submissionId}`,
      entityType: 'FEEDBACK_SUBMISSION',
      GSI1PK: `FEEDBACK#ENV#${artifact.environment}`,
      GSI1SK: `${artifact.status}#${artifact.submittedAt}#${artifact.submissionId}`,
      ...artifact,
      fingerprint
    }
  });
};

const createGitHubIssue = async (params: {
  repo: string;
  token: string;
  type: FeedbackType;
  title: string;
  issueBody: string;
  labels: string[];
}): Promise<{ number: number; html_url: string }> => {
  const issueResponse = await fetch(`https://api.github.com/repos/${params.repo}/issues`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.token}`,
      'User-Agent': 'roll-model-feedback',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: `[feedback:${params.type}] ${params.title}`,
      body: params.issueBody,
      labels: params.labels
    })
  });

  if (!issueResponse.ok) {
    let message = 'GitHub issue creation failed.';
    try {
      const json = (await issueResponse.json()) as { message?: string };
      message = json.message ?? message;
    } catch {
      // ignore
    }

    throw new ApiError({
      code: 'GITHUB_ERROR',
      message,
      statusCode: 502
    });
  }

  return (await issueResponse.json()) as { number: number; html_url: string };
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  const requestId = event.requestContext.requestId;
  const submissionId = uuidv4();

  try {
    console.log(
      JSON.stringify({
        msg: 'feedback.request.received',
        requestId,
        method: event.httpMethod,
        path: event.path
      })
    );

    const auth = getAuthContext(event);
    const payload = parseBody(event);
    const submittedAt = new Date().toISOString();
    const { appVersion, environment } = resolveFeedbackContext(event, payload);
    const actorHash = buildActorHash(auth.userId, auth.role);

    const shouldNormalize = shouldNormalizeWithGpt(payload);
    const normalization = shouldNormalize ? await normalizeWithGpt(payload) : null;
    const normalizedPayload = applyNormalization(payload, normalization);
    const labels = buildLabels(normalizedPayload.type);
    const fingerprint = buildFingerprint(normalizedPayload);

    const perHourLimit = parsePositiveInt(process.env.FEEDBACK_RATE_LIMIT_PER_HOUR, 6);
    const perDayLimit = parsePositiveInt(process.env.FEEDBACK_RATE_LIMIT_PER_DAY, 20);
    const cooldownSeconds = parsePositiveInt(process.env.FEEDBACK_COOLDOWN_SECONDS, 20);
    const duplicateWindowHours = parsePositiveInt(process.env.FEEDBACK_DUPLICATE_WINDOW_HOURS, 24);
    const duplicateLimit = parsePositiveInt(process.env.FEEDBACK_DUPLICATE_LIMIT, 2);

    const history = await readRecentHistory(auth.userId, submittedAt, Math.max(24, duplicateWindowHours));
    const throttle = evaluateThrottling({
      history,
      nowIso: submittedAt,
      fingerprint,
      perHourLimit,
      perDayLimit,
      duplicateWindowHours,
      duplicateLimit,
      cooldownSeconds
    });

    if (throttle.blocked) {
      await saveArtifact(
        {
          submittedAt,
          submissionId,
          status: 'blocked',
          userId: auth.userId,
          userRole: auth.role,
          actorHash,
          type: normalizedPayload.type,
          originalPayload: payload,
          normalizedPayload,
          normalizedByGpt: Boolean(normalization),
          labels,
          appVersion,
          environment,
          throttled: true,
          abuseSignals: throttle.reasons,
          issueState: 'not_created',
          createdAt: submittedAt,
          updatedAt: submittedAt
        },
        fingerprint
      );

      console.warn(
        JSON.stringify({
          msg: 'feedback.throttled',
          requestId,
          userId: auth.userId,
          reasons: throttle.reasons
        })
      );

      throw new ApiError({
        code: 'RATE_LIMITED',
        message: 'Feedback submission temporarily limited. Please try again later.',
        statusCode: 429
      });
    }

    const repo = process.env.GITHUB_REPO;
    if (!repo) {
      throw new ApiError({
        code: 'CONFIGURATION_ERROR',
        message: 'GitHub integration is not configured.',
        statusCode: 500
      });
    }

    const gateForReview = shouldGateForReview(environment, auth.role);

    if (gateForReview && !hasRole(auth, 'coach') && !hasRole(auth, 'admin')) {
      await saveArtifact(
        {
          submittedAt,
          submissionId,
          status: 'pending_review',
          userId: auth.userId,
          userRole: auth.role,
          actorHash,
          type: normalizedPayload.type,
          originalPayload: payload,
          normalizedPayload,
          normalizedByGpt: Boolean(normalization),
          labels,
          appVersion,
          environment,
          throttled: false,
          abuseSignals: [],
          issueState: 'pending_review',
          createdAt: submittedAt,
          updatedAt: submittedAt
        },
        fingerprint
      );

      return response(201, {
        submissionId,
        status: 'pending_review',
        issueNumber: null,
        issueUrl: null
      });
    }

    const token = await getGithubToken();
    const issueBody = buildIssueBody({
      payload: normalizedPayload,
      actorHash,
      actorRole: auth.role,
      appVersion,
      environment,
      submittedAt,
      submissionId,
      normalizedByGpt: Boolean(normalization)
    });

    const issue = await createGitHubIssue({
      repo,
      token,
      type: normalizedPayload.type,
      title: normalizedPayload.title,
      issueBody,
      labels
    });

    await saveArtifact(
      {
        submittedAt,
        submissionId,
        status: 'submitted',
        userId: auth.userId,
        userRole: auth.role,
        actorHash,
        type: normalizedPayload.type,
        originalPayload: payload,
        normalizedPayload,
        normalizedByGpt: Boolean(normalization),
        labels,
        appVersion,
        environment,
        throttled: false,
        abuseSignals: [],
        issueNumber: issue.number,
        issueUrl: issue.html_url,
        issueState: 'open',
        createdAt: submittedAt,
        updatedAt: submittedAt
      },
      fingerprint
    );

    return response(201, {
      submissionId,
      status: 'submitted',
      issueNumber: issue.number,
      issueUrl: issue.html_url
    });
  } catch (error) {
    if (error instanceof ApiError && error.code !== 'RATE_LIMITED') {
      console.error(
        JSON.stringify({
          msg: 'feedback.request.failed',
          requestId,
          submissionId,
          error: { name: error.name, code: error.code, message: error.message }
        })
      );
    }

    if (!(error instanceof ApiError)) {
      console.error(
        JSON.stringify({
          msg: 'feedback.request.failed',
          requestId,
          submissionId,
          error: error instanceof Error ? { name: error.name, message: error.message } : { detail: String(error) }
        })
      );
    }

    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('submitFeedback', baseHandler);
