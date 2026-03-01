import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { recomputeAndPersistProgressViews, resolveProgressAccess } from '../../shared/progressStore';

import { handler } from './index';

jest.mock('../../shared/progressStore');

const mockResolveProgressAccess = jest.mocked(resolveProgressAccess);
const mockRecomputeAndPersistProgressViews = jest.mocked(recomputeAndPersistProgressViews);

const buildEvent = (role: 'athlete' | 'coach', athleteId?: string): APIGatewayProxyEvent =>
  ({
    pathParameters: athleteId ? { athleteId } : undefined,
    queryStringParameters: {
      contextTags: 'competition',
      giOrNoGi: 'gi'
    },
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'athlete' ? 'athlete-1' : 'coach-1',
          'custom:role': role
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('getProgressViews handler', () => {
  beforeEach(() => {
    mockResolveProgressAccess.mockReset();
    mockRecomputeAndPersistProgressViews.mockReset();
  });

  it('returns aggregated progress report payload', async () => {
    mockResolveProgressAccess.mockResolvedValueOnce({ athleteId: 'athlete-1', actingAsCoach: false });
    mockRecomputeAndPersistProgressViews.mockResolvedValueOnce({
      athleteId: 'athlete-1',
      generatedAt: '2026-02-24T00:00:00.000Z',
      filters: { contextTags: ['competition'], giOrNoGi: 'gi' },
      timeline: { events: [], cumulative: [] },
      positionHeatmap: { cells: [], maxTrainedCount: 0, neglectedThreshold: 0 },
      outcomeTrends: { points: [] },
      lowConfidenceFlags: [],
      coachAnnotations: [],
      sourceSummary: {
        sessionsConsidered: 0,
        structuredSessions: 0,
        checkoffsConsidered: 0
      }
    });

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    expect(mockRecomputeAndPersistProgressViews).toHaveBeenCalledWith('athlete-1', {
      contextTags: ['competition'],
      giOrNoGi: 'gi'
    });
  });
});
