// Phase 1: workspace == better-auth `organization` (org plugin tables in `auth.ts`).
// We do NOT introduce a separate `workspace` table — the plan says "workspace = org".
//
// Phase 2 will add ticket/message/etc. tables here, all carrying `workspaceID` (= organization.id).
// Kept as an empty barrel for now so future imports don't break.
export {};
