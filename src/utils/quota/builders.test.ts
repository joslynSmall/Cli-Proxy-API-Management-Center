import { describe, expect, it } from 'vitest';

import { buildGeminiCliQuotaBuckets } from './builders';

describe('buildGeminiCliQuotaBuckets', () => {
  it('uses the real model id as the primary label for a single-model bucket', () => {
    const buckets = buildGeminiCliQuotaBuckets([
      {
        modelId: 'gemini-2.5-flash',
        tokenType: null,
        remainingFraction: 1,
        remainingAmount: null,
        resetTime: '2026-04-25T01:30:00Z',
      },
    ]);

    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.label).toBe('gemini-2.5-flash');
  });
});
