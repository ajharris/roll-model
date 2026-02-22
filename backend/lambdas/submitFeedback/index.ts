import type { APIGatewayProxyEvent, APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext } from '../../shared/auth';
import { ApiError, errorResponse, response } from '../../shared/responses';

type FeedbackType = 'bug' | 'feature' | 'other';

type FeedbackRequest = {
  type: FeedbackType;
  title: string;
  details: string;
  steps?: string;
  expected?: string;
  actual?: string;
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

  if (type !== 'bug' && type !== 'feature' && type !== 'other') {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Feedback type must be bug, feature, or other.',
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

  return {
    type,
    title,
    details,
    steps: steps || undefined,
    expected: expected || undefined,
    actual: actual || undefined
  };
};

const buildIssueBody = (
  payload: FeedbackRequest,
  reporter: { id: string; email?: string; role: string },
  submittedAt: string
) => {
  const sections = [
    `Submitted at: ${submittedAt}`,
    `Reporter ID: ${reporter.id}`,
    reporter.email ? `Reporter email: ${reporter.email}` : 'Reporter email: (not provided)',
    `Role: ${reporter.role}`,
    '',
    '## Details',
    payload.details
  ];

  if (payload.steps) {
    sections.push('', '## Steps to reproduce', payload.steps);
  }

  if (payload.expected) {
    sections.push('', '## Expected behavior', payload.expected);
  }

  if (payload.actual) {
    sections.push('', '## Actual behavior', payload.actual);
  }

  return sections.join('\n');
};

const buildLabels = (type: FeedbackType): string[] => {
  if (type === 'bug') return ['bug', 'user-reported'];
  if (type === 'feature') return ['enhancement', 'user-reported'];
  return ['user-reported'];
};

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    const payload = parseBody(event);

    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO;

    if (!token || !repo) {
      throw new ApiError({
        code: 'CONFIGURATION_ERROR',
        message: 'GitHub integration is not configured.',
        statusCode: 500
      });
    }

    const claims = event.requestContext.authorizer?.claims as Record<string, string> | undefined;
    const email = claims?.email;
    const submittedAt = new Date().toISOString();

    const issueResponse = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'roll-model-feedback',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: `[${payload.type}] ${payload.title}`,
        body: buildIssueBody(payload, { id: auth.userId, email, role: auth.role }, submittedAt),
        labels: buildLabels(payload.type)
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

    const issue = (await issueResponse.json()) as { number: number; html_url: string };

    return response(201, {
      issueNumber: issue.number,
      issueUrl: issue.html_url
    });
  } catch (error) {
    return errorResponse(error);
  }
};
