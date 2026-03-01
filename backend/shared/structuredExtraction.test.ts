import { extractStructuredMetadata } from './structuredExtraction';

describe('structured extraction', () => {
  it('extracts canonical fields from messy notes and raw mentions', () => {
    const result = extractStructuredMetadata({
      quickAdd: {
        time: '2026-02-26T18:00:00.000Z',
        class: 'Open mat',
        gym: 'North Academy',
        partners: ['Alex'],
        rounds: 6,
        notes: 'Half guard bottom rounds. Got passed when I lost underhook. Cue: pummel first.',
      },
      sections: {
        shared: 'Swept twice from half guard bottom and finished an arm bar once.',
        private: 'Cardio dipped and forearm pump late.',
      },
      rawTechniqueMentions: ['Armbar'],
    });

    expect(result.structured?.position).toBe('half guard bottom');
    expect(result.structured?.technique).toBe('Armbar');
    expect(result.structured?.cue?.toLowerCase()).toContain('pummel first');
    expect(result.extraction.concepts).toContain('underhook');
    expect(result.extraction.conditioningIssues).toEqual(expect.arrayContaining(['cardio fatigue', 'grip fatigue']));
  });

  it('marks corrected/confirmed statuses from user input in one step', () => {
    const result = extractStructuredMetadata({
      quickAdd: {
        time: '2026-02-26T18:00:00.000Z',
        class: 'Open mat',
        gym: 'North Academy',
        partners: ['Alex'],
        rounds: 6,
        notes: 'Half guard bottom then got passed.',
      },
      sections: {
        shared: 'Half guard bottom exchanges.',
        private: '',
      },
      rawTechniqueMentions: [],
      structured: {
        position: 'deep half guard',
      },
      structuredMetadataConfirmations: [
        {
          field: 'outcome',
          status: 'rejected',
          note: 'Not enough signal',
        },
      ],
    });

    const position = result.extraction.suggestions.find((item) => item.field === 'position');
    expect(position?.status).toBe('corrected');
    expect(position?.correctionValue).toBe('deep half guard');

    const outcome = result.extraction.suggestions.find((item) => item.field === 'outcome');
    expect(outcome?.status).toBe('rejected');
  });

  it('produces confidence flags for uncertain fields', () => {
    const result = extractStructuredMetadata({
      quickAdd: {
        time: '2026-02-26T18:00:00.000Z',
        class: 'Open mat',
        gym: 'North Academy',
        partners: ['Alex'],
        rounds: 6,
        notes: 'Mount top but stalled and could not finish.',
      },
      sections: {
        shared: 'Need better timing.',
        private: '',
      },
      rawTechniqueMentions: [],
    });

    expect(result.extraction.confidenceFlags.length).toBeGreaterThan(0);
    expect(result.extraction.suggestions.some((item) => item.confirmationPrompt)).toBe(true);
  });
});
