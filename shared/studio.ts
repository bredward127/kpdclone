export const lifecycleStatuses = [
  "draft",
  "queued",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
  "needs_review",
  "approved",
  "superseded",
  "archived",
] as const;

export type LifecycleStatus = (typeof lifecycleStatuses)[number];

export const aiProvenanceClassifications = [
  "ai_generated",
  "human_created",
  "human_edited_ai",
  "provider_asset",
  "composite",
  "unknown",
] as const;

export type AiProvenanceClassification = (typeof aiProvenanceClassifications)[number];

export const pageApprovalStates = ["draft", "needs_review", "approved", "rejected", "superseded", "archived"] as const;
export type PageApprovalState = (typeof pageApprovalStates)[number];

export const transitionGraph: Record<LifecycleStatus, readonly LifecycleStatus[]> = {
  draft: ["queued", "cancelled", "archived"],
  queued: ["in_progress", "cancelled", "failed"],
  in_progress: ["completed", "failed", "cancelled"],
  completed: ["needs_review", "approved", "superseded", "archived"],
  failed: ["queued", "cancelled", "archived"],
  cancelled: ["queued", "archived"],
  needs_review: ["approved", "failed", "superseded", "archived"],
  approved: ["superseded", "archived"],
  superseded: ["archived"],
  archived: [],
};

export function canTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  return transitionGraph[from].includes(to);
}
