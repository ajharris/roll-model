import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { handler } from './index';

var sendMock: jest.Mock;

jest.mock('@aws-sdk/client-ses', () => {
  sendMock = jest.fn();
  return {
    SESClient: jest.fn(() => ({ send: sendMock })),
    SendEmailCommand: jest.fn((input) => input)
  };
});

const buildEvent = (body?: Record<string, unknown>): APIGatewayProxyEvent =>
  ({
    body: body ? JSON.stringify(body) : null
  }) as unknown as APIGatewayProxyEvent;

describe('requestSignup handler', () => {
  beforeEach(() => {
    sendMock.mockReset();
    process.env.SIGNUP_APPROVAL_EMAIL = 'approvals@example.com';
    process.env.SIGNUP_SOURCE_EMAIL = 'no-reply@example.com';
  });

  it('queues a signup request email', async () => {
    const result = (await handler(
      buildEvent({ email: 'new.user@example.com', name: 'New User', notes: 'Interested', intendedRole: 'athlete' }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(202);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const commandInput = sendMock.mock.calls[0]?.[0] as {
      Destination: { ToAddresses: string[] };
      Source: string;
      Message: { Subject: { Data: string }; Body: { Text: { Data: string } } };
    };
    expect(commandInput.Destination.ToAddresses).toEqual(['approvals@example.com']);
    expect(commandInput.Source).toBe('no-reply@example.com');
    expect(commandInput.Message.Subject.Data).toContain('new.user@example.com');
    expect(commandInput.Message.Body.Text.Data).toContain('New Roll Model sign-up request');
  });

  it('rejects invalid payloads', async () => {
    const result = (await handler(buildEvent({ name: 'No Email' }), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('requires email configuration', async () => {
    delete process.env.SIGNUP_APPROVAL_EMAIL;
    delete process.env.SIGNUP_SOURCE_EMAIL;

    const result = (await handler(
      buildEvent({ email: 'new.user@example.com' }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('CONFIGURATION_ERROR');
  });
});
