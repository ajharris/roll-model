import type { APIGatewayProxyResult } from 'aws-lambda';

import type { ApiErrorShape } from './types';

export class ApiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  public constructor(error: ApiErrorShape) {
    super(error.message);
    this.code = error.code;
    this.statusCode = error.statusCode;
  }
}

export const response = <T>(statusCode: number, payload: T): APIGatewayProxyResult => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(payload)
});

export const errorResponse = (error: unknown): APIGatewayProxyResult => {
  if (error instanceof ApiError) {
    return response(error.statusCode, {
      error: {
        code: error.code,
        message: error.message
      }
    });
  }

  return response(500, {
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.'
    }
  });
};
