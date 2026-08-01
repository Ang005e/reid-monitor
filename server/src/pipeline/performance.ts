import type { CleanedReading, RulePerformance } from '../types.js';

/**
 * Alert-rule scorecard — port of notebook cell 21.
 *
 * Scores the pipeline's own `derived_alert` against the dataset's ground-truth
 * `system_status`: an alert is "correct" when the row really was not stable.
 *
 * This only works because the hackathon dataset ships labels. A real deployment
 * has no ground truth to score against, so treat this as a demo artifact that
 * shows the rules were validated — not as a live quality metric.
 */
export function computeRulePerformance(readings: readonly CleanedReading[]): RulePerformance {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let trueNegatives = 0;

  for (const r of readings) {
    const alerted = r.alert_raised;
    const actualProblem = r.system_status !== 'stable';

    if (alerted && actualProblem) truePositives += 1;
    else if (alerted && !actualProblem) falsePositives += 1;
    else if (!alerted && actualProblem) falseNegatives += 1;
    else trueNegatives += 1;
  }

  // Guard the denominators: a run with no alerts yet (or no readings at all)
  // would otherwise serve NaN, which is not valid JSON and breaks the dashboard.
  const ratio = (numerator: number, denominator: number): number | null =>
    denominator === 0 ? null : numerator / denominator;

  return {
    true_positives: truePositives,
    false_positives: falsePositives,
    false_negatives: falseNegatives,
    true_negatives: trueNegatives,
    precision: ratio(truePositives, truePositives + falsePositives),
    recall: ratio(truePositives, truePositives + falseNegatives),
    accuracy: ratio(truePositives + trueNegatives, readings.length),
  };
}
