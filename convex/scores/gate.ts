export const CONFIDENCE_THRESHOLD = 0.7;

// How sure the model is about a noul judgment: a probability near either end of
// the range is far from a coin flip, so both ends read as certain.
export const certainty = (probability: number): number => Math.max(probability, 1 - probability);

export const isLowConfidence = (confidence: number): boolean => confidence < CONFIDENCE_THRESHOLD;
