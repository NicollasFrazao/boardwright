/** The verdict the review stage reaches; it is recorded, never turned into an approval. */
export type ReviewVerdict = 'approve' | 'changes';

/** What the review stage records in the body of each review it posts. */
export interface ReviewMarker {
  readonly verdict: ReviewVerdict;
  readonly headSha: string;
}

const REVIEW_MARKER_VERSION = 1;

const REVIEW_MARKER_PATTERN = /<!-- boardwright:review v=(?<version>\d+) verdict=(?<verdict>[a-z]+) head=(?<head>[0-9a-f]{7,64}) -->/u;

/**
 * Writes the hidden marker that starts a review's body.
 *
 * @remarks
 * Like the run marker, it is a public contract: the merge policy (#7) reads the verdict for the head
 * commit from it.
 */
export function formatReviewMarker(marker: ReviewMarker): string {
  return `<!-- boardwright:review v=${REVIEW_MARKER_VERSION} verdict=${marker.verdict} head=${marker.headSha} -->`;
}

/** Reads the review marker in a review body; `undefined` when there is none or it is unknown. */
export function parseReviewMarker(body: string): ReviewMarker | undefined {
  const groups = REVIEW_MARKER_PATTERN.exec(body)?.groups;
  const verdict = groups?.verdict;

  if (
    groups?.version !== String(REVIEW_MARKER_VERSION)
    || groups.head === undefined
    || (verdict !== 'approve'
    && verdict !== 'changes')
  ) {
    return undefined;
  }

  return {
    verdict,
    headSha: groups.head,
  };
}
