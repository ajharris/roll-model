import type { QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { putItem, queryItems } from '../../shared/db';
import { callOpenAI } from '../../shared/openai';
import { recomputeAndPersistProgressViews } from '../../shared/progressStore';

import { handler } from './index';

jest.mock('../../shared/db');
jest.mock('../../shared/openai');
jest.mock('../../shared/progressStore');

const mockPutItem = jest.mocked(putItem);
const mockQueryItems = jest.mocked(queryItems);
const mockCallOpenAI = jest.mocked(callOpenAI);
const mockRecompute = jest.mocked(recomputeAndPersistProgressViews);

const buildEvent = (): APIGatewayProxyEvent =>
  ({
    pathParameters: { notificationId: 'n-1' },
    body: JSON.stringify({
      notes: 'Lost underhook when passing half guard and got swept.',
      quickAdd: { class: 'No-gi', rounds: 5 },
      sessionMetrics: { intensity: 7, giOrNoGi: 'no-gi', tags: ['passing'] }
    }),
    requestContext: {
      authorizer: {
        claims: {
          sub: 'athlete-1',
          'custom:role': 'athlete'
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('captureAfterClassReminder handler', () => {
  beforeEach(() => {
    mockPutItem.mockReset();
    mockQueryItems.mockReset();
    mockCallOpenAI.mockReset();
    mockRecompute.mockReset();
    mockPutItem.mockResolvedValue();
    mockRecompute.mockResolvedValue({} as never);
  });

  it('creates an entry via GPT extraction and marks reminder as acted', async () => {
    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'USER#athlete-1',
          SK: 'NOTIFICATION#AFTER_CLASS#2026-03-01',
          entityType: 'AUTOMATION_NOTIFICATION',
          notificationId: 'n-1',
          athleteId: 'athlete-1',
          kind: 'after-class-reminder',
          status: 'sent',
          title: 'After-class log reminder',
          body: 'Log your notes.',
          localDate: '2026-03-01',
          localTime: '21:00',
          timezone: 'America/New_York',
          dispatchKey: '2026-03-01',
          createdAt: '2026-03-02T00:00:00.000Z',
          updatedAt: '2026-03-02T00:00:00.000Z'
        }
      ]
    } as unknown as QueryCommandOutput);

    mockCallOpenAI.mockResolvedValueOnce({
      text: 'Captured.',
      extracted_updates: {
        summary: 'summary',
        actionPack: {
          wins: ['timing improved'],
          leaks: ['underhook lost'],
          oneFocus: 'head first',
          drills: ['knee cut reps'],
          positionalRequests: ['half guard top'],
          fallbackDecisionGuidance: 'recover frames',
          confidenceFlags: []
        },
        sessionReview: {
          promptSet: {
            whatWorked: ['entry timing'],
            whatFailed: ['underhook control'],
            whatToAskCoach: [],
            whatToDrillSolo: ['pummel reps']
          },
          oneThing: 'Win underhook before hip switch',
          confidenceFlags: []
        },
        suggestedFollowUpQuestions: []
      },
      suggested_prompts: []
    });

    const result = (await handler(buildEvent(), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(201);

    const body = JSON.parse(result.body) as { entry: { entryId: string }; reminderStatus: string };
    expect(body.entry.entryId).toBeTruthy();
    expect(body.reminderStatus).toBe('acted');

    expect(mockCallOpenAI).toHaveBeenCalledTimes(1);
    expect(mockPutItem).toHaveBeenCalledTimes(3);
    expect(mockRecompute).toHaveBeenCalledWith('athlete-1');
  });

  it('rejects reminders that were already acted', async () => {
    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'USER#athlete-1',
          SK: 'NOTIFICATION#AFTER_CLASS#2026-03-01',
          entityType: 'AUTOMATION_NOTIFICATION',
          notificationId: 'n-1',
          athleteId: 'athlete-1',
          kind: 'after-class-reminder',
          status: 'acted',
          title: 'After-class log reminder',
          body: 'Log your notes.',
          localDate: '2026-03-01',
          localTime: '21:00',
          timezone: 'America/New_York',
          dispatchKey: '2026-03-01',
          createdAt: '2026-03-02T00:00:00.000Z',
          updatedAt: '2026-03-02T00:00:00.000Z'
        }
      ]
    } as unknown as QueryCommandOutput);

    const result = (await handler(buildEvent(), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
    expect(mockPutItem).not.toHaveBeenCalled();
  });
});
