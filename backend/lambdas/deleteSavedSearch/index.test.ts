import type { GetCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { deleteItem, getItem } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockDeleteItem = jest.mocked(deleteItem);

const buildEvent = (savedSearchId = 's1'): APIGatewayProxyEvent =>
  ({
    pathParameters: { savedSearchId },
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          'custom:role': 'athlete'
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('deleteSavedSearch handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockDeleteItem.mockReset();
    mockDeleteItem.mockResolvedValue();
  });

  it('deletes an existing saved search', async () => {
    mockGetItem.mockResolvedValueOnce({
      Item: {
        PK: 'USER#user-123',
        SK: 'SAVED_SEARCH#s1',
        entityType: 'SAVED_SEARCH'
      }
    } as unknown as GetCommandOutput);

    const result = (await handler(buildEvent(), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(204);
    expect(mockDeleteItem).toHaveBeenCalledWith({
      Key: {
        PK: 'USER#user-123',
        SK: 'SAVED_SEARCH#s1'
      }
    });
  });

  it('returns 404 when the saved search does not exist', async () => {
    mockGetItem.mockResolvedValueOnce({} as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('missing'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(404);
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });
});
