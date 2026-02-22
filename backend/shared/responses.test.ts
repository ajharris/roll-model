import { ApiError, errorResponse, response } from './responses';

describe('responses helpers', () => {
  it('builds JSON responses with CORS headers', () => {
    const result = response(200, { ok: true });

    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Authorization-Bearer',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    });
    expect(result.body).toBe(JSON.stringify({ ok: true }));
  });

  it('formats ApiError payloads with the original status code', () => {
    const result = errorResponse(
      new ApiError({
        code: 'FORBIDDEN',
        message: 'Denied.',
        statusCode: 403
      })
    );

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body)).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Denied.'
      }
    });
    expect(result.headers).toBeDefined();
    expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
  });

  it('falls back to INTERNAL_SERVER_ERROR for unknown errors', () => {
    const result = errorResponse(new Error('boom'));

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred.'
      }
    });
    expect(result.headers).toBeDefined();
    expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
  });
});
