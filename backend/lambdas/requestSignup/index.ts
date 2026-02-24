import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import type { APIGatewayProxyEvent, APIGatewayProxyHandler } from 'aws-lambda';
import { withRequestLogging } from '../../shared/logger';

import { ApiError, errorResponse, response } from '../../shared/responses';

type SignupRequest = {
  email: string;
  name?: string;
  notes?: string;
  intendedRole?: string;
};

const ses = new SESClient({});

const parseBody = (event: APIGatewayProxyEvent): SignupRequest => {
  if (!event.body) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400
    });
  }

  const parsed = JSON.parse(event.body) as Partial<SignupRequest>;

  if (!parsed.email || typeof parsed.email !== 'string') {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Email is required.',
      statusCode: 400
    });
  }

  const email = parsed.email.trim();
  if (!email.includes('@')) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Email is invalid.',
      statusCode: 400
    });
  }

  const name = typeof parsed.name === 'string' ? parsed.name.trim() : undefined;
  const notes = typeof parsed.notes === 'string' ? parsed.notes.trim() : undefined;
  const intendedRole = typeof parsed.intendedRole === 'string' ? parsed.intendedRole.trim() : undefined;

  return {
    email,
    name: name || undefined,
    notes: notes || undefined,
    intendedRole: intendedRole || undefined
  };
};

const buildEmailBody = (request: SignupRequest, submittedAt: string) => {
  const lines = [
    'New Roll Model sign-up request',
    '',
    `Submitted at: ${submittedAt}`,
    `Email: ${request.email}`,
    request.name ? `Name: ${request.name}` : 'Name: (not provided)',
    request.intendedRole ? `Intended role: ${request.intendedRole}` : 'Intended role: (not provided)',
    request.notes ? `Notes: ${request.notes}` : 'Notes: (not provided)',
    '',
    'Reply with APPROVE or DECLINE to this message.'
  ];

  return lines.join('\n');
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const approvalEmail = process.env.SIGNUP_APPROVAL_EMAIL;
    const sourceEmail = process.env.SIGNUP_SOURCE_EMAIL;

    if (!approvalEmail || !sourceEmail) {
      throw new ApiError({
        code: 'CONFIGURATION_ERROR',
        message: 'Signup approval email settings are missing.',
        statusCode: 500
      });
    }

    const payload = parseBody(event);
    const submittedAt = new Date().toISOString();

    await ses.send(
      new SendEmailCommand({
        Destination: { ToAddresses: [approvalEmail] },
        Source: sourceEmail,
        Message: {
          Subject: {
            Data: `Roll Model sign-up request: ${payload.email}`
          },
          Body: {
            Text: {
              Data: buildEmailBody(payload, submittedAt)
            }
          }
        },
        ReplyToAddresses: [approvalEmail]
      })
    );

    return response(202, { status: 'queued' });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('requestSignup', baseHandler);
