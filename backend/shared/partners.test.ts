import { normalizeTagList, parsePartnerUpsertPayload } from './partners';
import { ApiError } from './responses';

describe('partners helpers', () => {
  it('normalizes style tags and dedupes', () => {
    expect(normalizeTagList([' Pressure-Passer ', 'pressure-passer', 'leg-locker'], 'styleTags')).toEqual([
      'pressure-passer',
      'leg-locker',
    ]);
  });

  it('rejects invalid tags', () => {
    expect(() => normalizeTagList(['Bad Tag'], 'styleTags')).toThrow(ApiError);
  });

  it('parses payload with private visibility by default', () => {
    const payload = parsePartnerUpsertPayload(
      JSON.stringify({
        displayName: 'Alex',
        styleTags: ['pressure-passer'],
      }),
    );

    expect(payload.visibility).toBe('private');
    expect(payload.styleTags).toEqual(['pressure-passer']);
  });
});
