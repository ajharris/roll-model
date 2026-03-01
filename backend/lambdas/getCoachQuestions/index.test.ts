import type { GetCommandOutput, QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { generateCoachQuestionSet } from '../../shared/coachQuestions';
import { getItem, putItem, queryItems } from '../../shared/db';
import type { CoachQuestionSet } from '../../shared/types';

import { handler } from './index';

jest.mock('../../shared/db');
jest.mock('../../shared/coachQuestions', () => {
  const actual = jest.requireActual('../../shared/coachQuestions');
  return {
    ...actual,
    generateCoachQuestionSet: jest.fn()
  };
});

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);
const mockQueryItems = jest.mocked(queryItems);
const mockGenerateCoachQuestionSet = jest.mocked(generateCoachQuestionSet);

const buildEvent = (
  role: 'athlete' | 'coach',
  options: {
    athleteId?: string;
    regenerate?: boolean;
  } = {}
): APIGatewayProxyEvent =>
  ({
    pathParameters: options.athleteId ? { athleteId: options.athleteId } : undefined,
    queryStringParameters: options.regenerate ? { regenerate: 'true' } : undefined,
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'athlete' ? 'athlete-1' : 'coach-1',
          'custom:role': role
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

const existingSet: CoachQuestionSet = {
  questionSetId: 'set-1',
  athleteId: 'athlete-1',
  generatedAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
  sourceEntryIds: ['entry-1'],
  generationReason: 'initial',
  generatedBy: 'athlete-1',
  generatedByRole: 'athlete',
  model: 'gpt-4.1-mini',
  promptVersion: 1,
  qualitySummary: {
    averageScore: 86,
    minScore: 84,
    hasDuplicates: false,
    lowConfidenceCount: 0
  },
  questions: [
    {
      questionId: 'q-1',
      text: 'What cue will you test next session to stop losing inside elbow position?',
      priority: 1,
      signalType: 'repeated_failure',
      issueKey: 'inside-elbow-position',
      confidence: 'high',
      evidence: [
        {
          entryId: 'entry-1',
          createdAt: '2026-02-25T10:00:00.000Z',
          signalType: 'repeated_failure',
          excerpt: 'I kept losing inside elbow position when passing half guard.'
        }
      ],
      rubric: {
        specific: 5,
        testable: 5,
        coachActionable: 5,
        evidenceBacked: 5,
        nonDuplicative: 5,
        total: 100,
        needsRevision: false,
        notes: []
      }
    }
  ]
};

describe('getCoachQuestions handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
    mockQueryItems.mockReset();
    mockGenerateCoachQuestionSet.mockReset();
  });

  it('returns latest persisted question set when regenerate is false', async () => {
    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'USER#athlete-1',
          SK: 'COACH_QUESTION_SET#2026-03-01T10:00:00.000Z#set-1',
          entityType: 'COACH_QUESTION_SET',
          ...existingSet
        }
      ]
    } as unknown as QueryCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { questionSet: { questionSetId: string } };
    expect(body.questionSet.questionSetId).toBe('set-1');
    expect(mockGenerateCoachQuestionSet).not.toHaveBeenCalled();
  });

  it('regenerates and persists a new set when requested', async () => {
    mockQueryItems
      .mockResolvedValueOnce({
        Items: [
          {
            PK: 'USER#athlete-1',
            SK: 'COACH_QUESTION_SET#2026-03-01T10:00:00.000Z#set-1',
            entityType: 'COACH_QUESTION_SET',
            ...existingSet
          }
        ]
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: [
          {
            entityType: 'ENTRY',
            entryId: 'entry-1',
            athleteId: 'athlete-1',
            schemaVersion: 4,
            createdAt: '2026-02-25T10:00:00.000Z',
            updatedAt: '2026-02-25T10:00:00.000Z',
            quickAdd: {
              time: '10:00',
              class: 'Class',
              gym: 'Gym',
              partners: [],
              rounds: 5,
              notes: ''
            },
            tags: [],
            sections: { private: '', shared: 'I lost inside elbow position repeatedly.' },
            sessionMetrics: {
              durationMinutes: 60,
              intensity: 7,
              rounds: 5,
              giOrNoGi: 'gi',
              tags: []
            },
            rawTechniqueMentions: []
          }
        ]
      } as unknown as QueryCommandOutput);

    mockGenerateCoachQuestionSet.mockResolvedValueOnce({
      ...existingSet,
      questionSetId: 'set-2',
      generatedAt: '2026-03-01T11:00:00.000Z',
      updatedAt: '2026-03-01T11:00:00.000Z',
      generationReason: 'regenerate'
    });

    const result = (await handler(buildEvent('athlete', { regenerate: true }), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { questionSet: { questionSetId: string } };
    expect(body.questionSet.questionSetId).toBe('set-2');
    expect(mockGenerateCoachQuestionSet).toHaveBeenCalledTimes(1);
    expect(mockPutItem).toHaveBeenCalledTimes(2);
  });

  it('rejects unlinked coach access', async () => {
    mockGetItem.mockResolvedValueOnce({} as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('coach', { athleteId: 'athlete-1' }), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
  });
});
