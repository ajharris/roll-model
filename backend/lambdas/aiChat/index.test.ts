import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, putItem, queryItems } from '../../shared/db';
import { callOpenAI, resetOpenAIApiKeyCache } from '../../shared/openai';
import type { Entry } from '../../shared/types';

import { buildPromptContext, handler, sanitizeContext, storeMessage } from './index';

jest.mock('../../shared/db');
jest.mock('../../shared/retrieval', () => ({
  batchGetEntries: jest.fn(),
  queryKeywordMatches: jest.fn()
}));
jest.mock('../../shared/openai', () => {
  const actual = jest.requireActual('../../shared/openai');
  return {
    ...actual,
    callOpenAI: jest.fn()
  };
});

jest.mock('uuid', () => ({
  v4: jest.fn()
}));

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);
const mockQueryItems = jest.mocked(queryItems);
const mockCallOpenAI = jest.mocked(callOpenAI);

const buildEvent = (role: 'athlete' | 'coach', body: Record<string, unknown>): APIGatewayProxyEvent =>
  ({
    body: JSON.stringify(body),
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'athlete' ? 'athlete-1' : 'coach-1',
          'custom:role': role
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('aiChat context/privacy', () => {
  it('athlete can include private notes when requested', () => {
    const ctx = sanitizeContext('athlete', 'athlete-1', { includePrivate: true });
    expect(ctx).toEqual({
      athleteId: 'athlete-1',
      includePrivate: true,
      entryIds: undefined,
      from: undefined,
      to: undefined,
      keywords: []
    });

    const entries: Entry[] = [
      {
        entryId: 'e1',
        athleteId: 'athlete-1',
        schemaVersion: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        quickAdd: {
          time: '2026-01-01T18:00:00.000Z',
          class: 'Open mat',
          gym: 'North Academy',
          partners: ['Alex'],
          rounds: 5,
          notes: 'shared text'
        },
        tags: [],
        sections: { private: 'private text', shared: 'shared text' },
        sessionMetrics: {
          durationMinutes: 60,
          intensity: 7,
          rounds: 5,
          giOrNoGi: 'gi',
          tags: []
        },
        rawTechniqueMentions: []
      }
    ];

    const prompt = JSON.parse(buildPromptContext(entries, true)) as Array<{
      sections: { private?: string; shared: string };
    }>;
    expect(prompt[0].sections.private).toBe('private text');
  });

  it('coach cannot access private notes', () => {
    const ctx = sanitizeContext('coach', 'coach-1', {
      athleteId: 'athlete-9',
      includePrivate: true
    });

    expect(ctx.includePrivate).toBe(false);
    expect(ctx.athleteId).toBe('athlete-9');
  });
});

describe('aiChat storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetOpenAIApiKeyCache();
  });

  it('stores messages in required AI_MESSAGE format', async () => {
    await storeMessage({
      messageId: 'msg-1',
      threadId: 'thread-1',
      role: 'user',
      content: 'hello',
      visibilityScope: 'shared',
      createdAt: '2026-01-02T00:00:00.000Z'
    });

    expect(putItem).toHaveBeenCalledWith({
      Item: {
        PK: 'AI_THREAD#thread-1',
        SK: 'MSG#2026-01-02T00:00:00.000Z#msg-1',
        entityType: 'AI_MESSAGE',
        messageId: 'msg-1',
        threadId: 'thread-1',
        role: 'user',
        content: 'hello',
        visibilityScope: 'shared',
        createdAt: '2026-01-02T00:00:00.000Z'
      }
    });
  });
});

describe('aiChat handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetOpenAIApiKeyCache();
    mockPutItem.mockResolvedValue();
    mockCallOpenAI.mockResolvedValue({
      text: 'Assistant reply',
      extracted_updates: {
        summary: 'Summary',
        actionPack: {
          wins: ['Maintained frames'],
          leaks: ['Late hip switch'],
          oneFocus: 'Early hip switch on knee cut',
          drills: ['Hip-switch reps x20'],
          positionalRequests: ['Start from knee-cut HQ'],
          fallbackDecisionGuidance: 'If knee line is lost, reset to shin shield.',
          confidenceFlags: [{ field: 'leaks', confidence: 'low', note: 'Could also be cardio pacing.' }],
        },
        sessionReview: {
          promptSet: {
            whatWorked: ['Frames held'],
            whatFailed: ['Late pummel'],
            whatToAskCoach: ['How to win underhook race?'],
            whatToDrillSolo: ['Early pummel reps'],
          },
          oneThing: 'Pummel first.',
          confidenceFlags: [{ field: 'oneThing', confidence: 'medium' }],
        },
        suggestedFollowUpQuestions: ['What cue helped your first frame?']
      },
      suggested_prompts: ['Ask about intensity']
    });
  });

  it('returns stable schema for athlete and includes private context when requested', async () => {
    const { v4 } = jest.requireMock('uuid') as { v4: jest.Mock };
    v4.mockReturnValueOnce('thread-1').mockReturnValueOnce('msg-1').mockReturnValueOnce('msg-2');

    mockQueryItems.mockImplementation(async (input) => {
      const values = input.ExpressionAttributeValues ?? {};
      if (values[':msgPrefix'] === 'MSG#') {
        return {
          Items: []
        } as never;
      }
      if (values[':entryPrefix'] === 'ENTRY#') {
        return {
          Items: [
            {
              entityType: 'ENTRY',
              PK: 'USER#athlete-1',
              SK: 'ENTRY#2026-01-01T00:00:00.000Z#entry-1',
              entryId: 'entry-1',
              athleteId: 'athlete-1',
              schemaVersion: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              sections: { private: 'private text', shared: 'shared text' },
              sessionMetrics: {
                durationMinutes: 60,
                intensity: 7,
                rounds: 5,
                giOrNoGi: 'gi',
                tags: []
              }
            }
          ]
        } as never;
      }
      return { Items: [] } as never;
    });

    const event = buildEvent('athlete', {
      message: 'Help me plan',
      context: { includePrivate: true }
    });

    const result = (await handler(event, {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      threadId: string;
      assistant_text: string;
      extracted_updates: {
        summary: string;
        actionPack: { wins: string[]; leaks: string[]; oneFocus: string };
        sessionReview?: { oneThing: string };
        suggestedFollowUpQuestions: string[];
      };
      suggested_prompts: string[];
    };
    expect(body.threadId).toBe('thread-1');
    expect(typeof body.assistant_text).toBe('string');
    expect(body.extracted_updates.summary).toBe('Summary');
    expect(body.extracted_updates.actionPack.oneFocus).toBe('Early hip switch on knee cut');
    expect(body.extracted_updates.sessionReview?.oneThing).toBe('Pummel first.');
    expect(Array.isArray(body.suggested_prompts)).toBe(true);

    const callArgs = mockCallOpenAI.mock.calls[0]?.[0] ?? [];
    const userMessage = callArgs.find((msg) => msg.role === 'user')?.content ?? '';
    expect(userMessage).toContain('private text');
    expect(userMessage).toContain('shared text');
  });

  it('rejects coaches with revoked links', async () => {
    mockGetItem.mockResolvedValueOnce({
      Item: { PK: 'USER#athlete-9', SK: 'COACH#coach-1', status: 'revoked' }
    } as never);

    const event = buildEvent('coach', {
      message: 'Check in',
      context: { athleteId: 'athlete-9' }
    });

    const result = (await handler(event, {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('prevents coach from accessing private content', async () => {
    const { v4 } = jest.requireMock('uuid') as { v4: jest.Mock };
    v4.mockReturnValueOnce('thread-2').mockReturnValueOnce('msg-3').mockReturnValueOnce('msg-4');

    mockGetItem.mockResolvedValueOnce({ Item: { PK: 'USER#athlete-9', SK: 'COACH#coach-1' } } as never);

    mockQueryItems.mockImplementation(async (input) => {
      const values = input.ExpressionAttributeValues ?? {};
      if (values[':msgPrefix'] === 'MSG#') {
        return { Items: [] } as never;
      }
      if (values[':entryPrefix'] === 'ENTRY#') {
        return {
          Items: [
            {
              entityType: 'ENTRY',
              PK: 'USER#athlete-9',
              SK: 'ENTRY#2026-01-01T00:00:00.000Z#entry-9',
              entryId: 'entry-9',
              athleteId: 'athlete-9',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              sections: { private: 'secret plan', shared: 'shared plan' },
              sessionMetrics: {
                durationMinutes: 45,
                intensity: 6,
                rounds: 4,
                giOrNoGi: 'no-gi',
                tags: []
              }
            }
          ]
        } as never;
      }
      return { Items: [] } as never;
    });

    const event = buildEvent('coach', {
      message: 'Coach check-in',
      context: { athleteId: 'athlete-9', includePrivate: true }
    });

    const result = (await handler(event, {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { assistant_text: string };
    expect(typeof body.assistant_text).toBe('string');

    const callArgs = mockCallOpenAI.mock.calls[0]?.[0] ?? [];
    const userMessage = callArgs.find((msg) => msg.role === 'user')?.content ?? '';
    expect(userMessage).not.toContain('secret plan');
    expect(userMessage).toContain('shared plan');
  });
});
