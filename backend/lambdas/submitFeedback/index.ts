import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { APIGatewayProxyEvent, APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { getAuthContext, requireRole } from '../../shared/auth';
import { putItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';

type FeedbackType = 'bug' | 'feature';
type FeedbackSeverity = 'low' | 'medium' | 'high' | 'critical';
type ReviewerRole = 'coach' | 'admin';

type ScreenshotAttachment = {
  url: string;
  caption?: string;
};

type ReviewerWorkflow = {
  requiresReview: boolean;
  reviewerRole?: ReviewerRole;
  note?: string;
};

type FeedbackRequestPayload = {
  type: FeedbackType;
  problem: string;
  proposedChange: string;
  contextSteps: string;
  severity: FeedbackSeverity;
  screenshots: ScreenshotAttachment[];
  reviewerWorkflow?: ReviewerWorkflow;
  normalization?: {
    usedGpt: boolean;
    originalProblem?: string;
    originalProposedChange?: string;
  };
  previewConfirmed: boolean;
};

type ParsedFeedbackRequest = FeedbackRequestPayload & {
  feedbackId: string;
  submittedAt: string;
};

const MIN_REQUIRED_TEXT_LENGTH = 12;
const MAX_REQUIRED_TEXT_LENGTH = 3000;
const MAX_SCREENSHOTS = 5;

const parseRequiredText = (value: unknown, fieldName: string): string => {
  const parsed = typeof value === 'string' ? value.trim() : '';
  if (parsed.length < MIN_REQUIRED_TEXT_LENGTH) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: `${fieldName} must be at least ${MIN_REQUIRED_TEXT_LENGTH} characters.`,
      statusCode: 400
    });
  }

  if (parsed.length > MAX_REQUIRED_TEXT_LENGTH) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: `${fieldName} must be ${MAX_REQUIRED_TEXT_LENGTH} characters or fewer.`,
      statusCode: 400
    });
  }

  return parsed;
};

const parseOptionalText = (value: unknown, fieldName: string, maxLength = 800): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === 'string' ? value.trim() : '';
  if (!parsed) return undefined;
  if (parsed.length > maxLength) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: `${fieldName} must be ${maxLength} characters or fewer.`,
      statusCode: 400
    });
  }
  return parsed;
};

const parseScreenshot = (value: unknown, index: number): ScreenshotAttachment => {
  const record = value as Record<string, unknown>;
  const url = typeof record?.url === 'string' ? record.url.trim() : '';
  const caption = parseOptionalText(record?.caption, `screenshots[${index}].caption`, 240);

  if (!url) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: `screenshots[${index}].url is required.`,
      statusCode: 400
    });
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new Error('invalid protocol');
    }
  } catch {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: `screenshots[${index}].url must be a valid https URL.`,
      statusCode: 400
    });
  }

  return {
    url,
    ...(caption ? { caption } : {})
  };
};

const parseReviewerWorkflow = (value: unknown): ReviewerWorkflow | undefined => {
  if (value === undefined || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record?.requiresReview !== 'boolean') {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'reviewerWorkflow.requiresReview must be a boolean when reviewerWorkflow is provided.',
      statusCode: 400
    });
  }

  const reviewerRoleRaw = record.reviewerRole;
  const reviewerRole =
    reviewerRoleRaw === 'coach' || reviewerRoleRaw === 'admin'
      ? reviewerRoleRaw
      : record.requiresReview
        ? undefined
        : undefined;
  const note = parseOptionalText(record.note, 'reviewerWorkflow.note', 500);

  if (record.requiresReview && !reviewerRole) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'reviewerWorkflow.reviewerRole is required when requiresReview is true.',
      statusCode: 400
    });
  }

  return {
    requiresReview: record.requiresReview,
    ...(reviewerRole ? { reviewerRole } : {}),
    ...(note ? { note } : {})
  };
};

const parseNormalization = (value: unknown): FeedbackRequestPayload['normalization'] | undefined => {
  if (value === undefined || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record?.usedGpt !== 'boolean') {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'normalization.usedGpt must be a boolean when normalization is provided.',
      statusCode: 400
    });
  }

  const originalProblem = parseOptionalText(record.originalProblem, 'normalization.originalProblem', 3000);
  const originalProposedChange = parseOptionalText(
    record.originalProposedChange,
    'normalization.originalProposedChange',
    3000
  );

  return {
    usedGpt: record.usedGpt,
    ...(originalProblem ? { originalProblem } : {}),
    ...(originalProposedChange ? { originalProposedChange } : {})
  };
};

const parseBody = (event: APIGatewayProxyEvent): ParsedFeedbackRequest => {
  if (!event.body) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400
    });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(event.body) as Record<string, unknown>;
  } catch {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body must be valid JSON.',
      statusCode: 400
    });
  }

  const type = parsed.type;

  if (type !== 'bug' && type !== 'feature') {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Feedback type must be bug or feature.',
      statusCode: 400
    });
  }

  const severity = parsed.severity;
  if (severity !== 'low' && severity !== 'medium' && severity !== 'high' && severity !== 'critical') {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Severity must be low, medium, high, or critical.',
      statusCode: 400
    });
  }

  const screenshotsRaw = parsed.screenshots;
  if (screenshotsRaw !== undefined && !Array.isArray(screenshotsRaw)) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'screenshots must be an array.',
      statusCode: 400
    });
  }
  if (Array.isArray(screenshotsRaw) && screenshotsRaw.length > MAX_SCREENSHOTS) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: `screenshots cannot include more than ${MAX_SCREENSHOTS} items.`,
      statusCode: 400
    });
  }

  if (parsed.previewConfirmed !== true) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Preview confirmation is required before submission.',
      statusCode: 400
    });
  }

  return {
    type,
    problem: parseRequiredText(parsed.problem, 'problem'),
    proposedChange: parseRequiredText(parsed.proposedChange, 'proposedChange'),
    contextSteps: parseRequiredText(parsed.contextSteps, 'contextSteps'),
    severity,
    screenshots: Array.isArray(screenshotsRaw) ? screenshotsRaw.map((item, index) => parseScreenshot(item, index)) : [],
    reviewerWorkflow: parseReviewerWorkflow(parsed.reviewerWorkflow),
    normalization: parseNormalization(parsed.normalization),
    previewConfirmed: true,
    feedbackId: uuidv4(),
    submittedAt: new Date().toISOString()
  };
};

const buildIssueBody = (
  payload: ParsedFeedbackRequest,
  reporter: { id: string; email?: string; role: string },
  submittedAt: string,
  feedbackId: string
) => {
  const sections = [
    `Feedback ID: ${feedbackId}`,
    `Submitted at: ${submittedAt}`,
    `Reporter ID: ${reporter.id}`,
    reporter.email ? `Reporter email: ${reporter.email}` : 'Reporter email: (not provided)',
    `Role: ${reporter.role}`,
    `Severity: ${payload.severity}`,
    '',
    '## Problem',
    payload.problem,
    '',
    '## Proposed change',
    payload.proposedChange,
    '',
    '## Reproduction steps / context',
    payload.contextSteps
  ];

  if (payload.screenshots.length > 0) {
    sections.push('', '## Screenshots');
    for (const screenshot of payload.screenshots) {
      const caption = screenshot.caption ? ` (${screenshot.caption})` : '';
      sections.push(`- ${screenshot.url}${caption}`);
    }
  }

  if (payload.reviewerWorkflow?.requiresReview) {
    sections.push(
      '',
      '## Reviewer routing',
      `- Requires review: yes`,
      `- Target role: ${payload.reviewerWorkflow.reviewerRole}`,
      ...(payload.reviewerWorkflow.note ? [`- Note: ${payload.reviewerWorkflow.note}`] : [])
    );
  }

  if (payload.normalization) {
    sections.push(
      '',
      '## GPT normalization',
      `- Used GPT normalization: ${payload.normalization.usedGpt ? 'yes' : 'no'}`,
      ...(payload.normalization.originalProblem ? [`- Original problem: ${payload.normalization.originalProblem}`] : []),
      ...(payload.normalization.originalProposedChange
        ? [`- Original proposed change: ${payload.normalization.originalProposedChange}`]
        : [])
    );
  }

  return sections.join('\n');
};

const buildLabels = (type: FeedbackType): string[] => {
  if (type === 'bug') return ['bug', 'user-reported'];
  return ['enhancement', 'user-reported'];
};

const addSeverityLabel = (labels: string[], severity: FeedbackSeverity): string[] => [...labels, `severity:${severity}`];

const addRoutingLabel = (labels: string[], workflow: ReviewerWorkflow | undefined): string[] => {
  if (!workflow?.requiresReview || !workflow.reviewerRole) return labels;
  return [...labels, `review:${workflow.reviewerRole}`];
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

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    console.log(
      JSON.stringify({
        msg: 'feedback.request.received',
        requestId: event.requestContext.requestId,
        method: event.httpMethod,
        path: event.path
      })
    );

    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach', 'admin']);
    const payload = parseBody(event);

    console.log(
      JSON.stringify({
        msg: 'feedback.request.parsed',
        requestId: event.requestContext.requestId,
        userId: auth.userId,
        role: auth.role,
        type: payload.type,
        problemLength: payload.problem.length,
        proposedChangeLength: payload.proposedChange.length,
        contextStepsLength: payload.contextSteps.length,
        severity: payload.severity,
        screenshotCount: payload.screenshots.length
      })
    );

    const token = await getGithubToken();
    const repo = process.env.GITHUB_REPO;

    if (!repo) {
      console.error(
        JSON.stringify({
          msg: 'feedback.config.missing',
          requestId: event.requestContext.requestId,
          hasGithubToken: true,
          hasGithubRepo: Boolean(repo)
        })
      );
      throw new ApiError({
        code: 'CONFIGURATION_ERROR',
        message: 'GitHub integration is not configured.',
        statusCode: 500
      });
    }

    const claims = event.requestContext.authorizer?.claims as Record<string, string> | undefined;
    const email = claims?.email;
    const submittedAt = payload.submittedAt;
    const labels = addRoutingLabel(addSeverityLabel(buildLabels(payload.type), payload.severity), payload.reviewerWorkflow);

    const issueResponse = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'roll-model-feedback',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: `[${payload.type}] ${payload.problem.slice(0, 90)}`,
        body: buildIssueBody(payload, { id: auth.userId, email, role: auth.role }, submittedAt, payload.feedbackId),
        labels
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

      console.error(
        JSON.stringify({
          msg: 'feedback.github.create_issue.failed',
          requestId: event.requestContext.requestId,
          status: issueResponse.status,
          statusText: issueResponse.statusText,
          repo,
          errorMessage: message
        })
      );

      throw new ApiError({
        code: 'GITHUB_ERROR',
        message,
        statusCode: 502
      });
    }

    const issue = (await issueResponse.json()) as { number: number; html_url: string };

    await putItem({
      Item: {
        PK: `USER#${auth.userId}`,
        SK: `FEEDBACK#${submittedAt}#${payload.feedbackId}`,
        entityType: 'FEEDBACK_SUBMISSION',
        feedbackId: payload.feedbackId,
        submittedAt,
        athleteId: auth.userId,
        reporterRole: auth.role,
        reporterEmail: email,
        payload: {
          type: payload.type,
          problem: payload.problem,
          proposedChange: payload.proposedChange,
          contextSteps: payload.contextSteps,
          severity: payload.severity,
          screenshots: payload.screenshots,
          reviewerWorkflow: payload.reviewerWorkflow,
          normalization: payload.normalization
        },
        github: {
          issueNumber: issue.number,
          issueUrl: issue.html_url,
          repo
        },
        status: payload.reviewerWorkflow?.requiresReview ? 'pending_reviewer_validation' : 'submitted_to_github',
        labels
      }
    });

    console.log(
      JSON.stringify({
        msg: 'feedback.github.create_issue.succeeded',
        requestId: event.requestContext.requestId,
        repo,
        issueNumber: issue.number,
        feedbackId: payload.feedbackId
      })
    );

    return response(201, {
      feedbackId: payload.feedbackId,
      issueNumber: issue.number,
      issueUrl: issue.html_url
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        msg: 'feedback.request.failed',
        requestId: event.requestContext.requestId,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: 'Unknown error', detail: String(error) }
      })
    );
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('submitFeedback', baseHandler);
