export type AnnotationReviewEligibility = {
  status: string;
  reviewJobReady: boolean;
  reviewSegments: string[];
};

export function canSelectAnnotationReviewItem(item: AnnotationReviewEligibility, segment: string): boolean {
  return ["review_pending", "approved", "rejected"].includes(item.status)
    && item.reviewJobReady
    && Array.isArray(item.reviewSegments)
    && item.reviewSegments.includes(segment);
}
