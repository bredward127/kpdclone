export const NAMED_FIXTURE_PROJECT = {
  id: "fixture-coloring-book-24",
  name: "Garden Friends — 24-page Coloring Book",
  bookType: "activity_book" as const,
  trimWidthInches: 8.5,
  trimHeightInches: 11,
  pageCount: 24,
  readingDirection: "ltr" as const,
  referenceId: "fixture-reference-1",
  pagePlanId: "fixture-page-1",
  promptVersionId: "fixture-prompt-1",
  modelEndpoint: "fixture/mock-image",
  coverPlanVersionId: "fixture-cover-plan-1",
};

export const FIXTURE_ACCEPTANCE_STEPS = [
  "create project",
  "save brief",
  "upload one reference",
  "compose a page prompt",
  "generate one page",
  "approve one page",
  "assemble approved interior fixture set",
  "build interior PDF",
  "build full-wrap cover PDF",
  "run KDP preflight",
  "create ZIP package",
  "download every expected artifact as the authorized owner",
] as const;
