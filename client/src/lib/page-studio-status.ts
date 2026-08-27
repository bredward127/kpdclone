export const pageStudioStatusLabels = {
  draft: "Draft",
  queued: "Queued",
  in_progress: "Generating",
  needs_review: "Needs Review",
  approved: "Approved",
  failed: "Failed",
  cancelled: "Cancelled",
  cancellation_requested: "Stopping",
  superseded: "Superseded",
} as const;

export type PageStudioStatus = keyof typeof pageStudioStatusLabels;

export function getPageStudioDisplayStatus(jobStatus?: string | null, assetStatus?: string | null): PageStudioStatus {
  const status = assetStatus ?? jobStatus ?? "draft";
  return status in pageStudioStatusLabels ? status as PageStudioStatus : "draft";
}
