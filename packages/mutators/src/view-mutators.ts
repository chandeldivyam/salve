// Phase 40 — saved view mutators.
//
// View shape lives in `view`. Per-agent ordering / hide state lives in
// `view_member` (custom views) and `builtin_view_member` (built-ins). Every
// mutator funnels its auth check through `assertHasWorkspace`; cross-workspace
// reads are blocked by `assertViewInWorkspace`.

import {
  builder,
  DEFAULT_DISPLAY_PROPS,
  DEFAULT_VIEW_SORT,
  type DisplayProps,
  displayPropsZ,
  groupByZ,
  type ViewQuery,
  type ViewSort,
  viewQueryZ,
  viewSortZ,
} from '@opendesk/zero-schema';
import { defineMutator, type Transaction } from '@rocicorp/zero';
import { z } from 'zod';
import { assertHasWorkspace, type WorkspaceAuthData } from './auth.js';
import { MutationError, MutationErrorCode } from './error.js';

const idArg = z.string().min(1);
const labelArg = z.string().trim().min(1).max(120);
const descriptionArg = z.string().trim().max(500).optional();
const iconArg = z.string().trim().max(80).optional();
const colorArg = z.string().trim().max(40).optional();
const scopeArg = z.enum(['workspace', 'personal']);

// Wire-shape coercion. Strict `viewQueryZ` doesn't carry an index signature so
// it doesn't satisfy `ReadonlyJSONValue`. Same trick as `ticketsForViewArg`:
// accept `z.any()` here, validate strictly inside the mutator body.
const looseQuery = z.any();
const looseSort = z.any();
const looseDisplayProps = z.any();
const looseGroupBy = z.union([z.string(), z.null()]).optional();

export const viewCreateArgsSchema = z.object({
  id: idArg,
  scope: scopeArg,
  label: labelArg,
  description: descriptionArg,
  icon: iconArg,
  color: colorArg,
  query: looseQuery,
  sort: looseSort.optional(),
  groupBy: looseGroupBy,
  displayProps: looseDisplayProps.optional(),
});
export type ViewCreateArgs = z.infer<typeof viewCreateArgsSchema>;

export const viewUpdateArgsSchema = z.object({
  id: idArg,
  label: labelArg.optional(),
  description: descriptionArg,
  icon: iconArg,
  color: colorArg,
  query: looseQuery.optional(),
  sort: looseSort.optional(),
  groupBy: looseGroupBy,
  displayProps: looseDisplayProps.optional(),
});
export type ViewUpdateArgs = z.infer<typeof viewUpdateArgsSchema>;

export const viewIDOnlyArgsSchema = z.object({ id: idArg });

export const viewReorderArgsSchema = z.object({
  // ordered list of `view.id` (custom) and/or `builtin:<key>` strings.
  // The mutator writes `position = i` for each id in order; ids not in the
  // list are untouched.
  orderedIDs: z.array(z.string()).max(400),
});
export type ViewReorderArgs = z.infer<typeof viewReorderArgsSchema>;

export const viewDuplicateArgsSchema = z.object({
  id: idArg,
  newID: idArg,
});
export type ViewDuplicateArgs = z.infer<typeof viewDuplicateArgsSchema>;

const BUILTIN_PREFIX = 'builtin:';
function isBuiltinKey(id: string): boolean {
  return id.startsWith(BUILTIN_PREFIX);
}

function now(): number {
  return Date.now();
}

async function assertViewInWorkspace(tx: Transaction, auth: WorkspaceAuthData, viewID: string) {
  const v = await tx.run(builder.view.where('id', viewID).one());
  if (!v) {
    throw new MutationError('view not found', MutationErrorCode.NOT_FOUND, viewID);
  }
  if (v.workspaceID !== auth.workspaceID) {
    throw new MutationError('view not found', MutationErrorCode.CROSS_WORKSPACE, viewID);
  }
  return v;
}

/**
 * Owner-or-admin gate for editing a custom view. Both personal and
 * workspace-scoped views require ownership for v1 — UI hiding is not a
 * security boundary, and an "anyone in the workspace can edit your saved
 * view" model leaks blast radius far beyond the agent who created it.
 *
 * Admin-override lands with workspace role plumbing (out of scope for
 * Phase 40); when it does, this is the place to broaden the check.
 */
async function assertCanModifyView(tx: Transaction, auth: WorkspaceAuthData, viewID: string) {
  const v = await assertViewInWorkspace(tx, auth, viewID);
  if (v.ownerID !== auth.sub) {
    throw new MutationError('view not found', MutationErrorCode.NOT_AUTHORIZED, viewID);
  }
  return v;
}

function validateOrThrow<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new MutationError(
      `${label} is invalid`,
      MutationErrorCode.INVALID_INPUT,
      JSON.stringify(parsed.error.issues).slice(0, 200),
    );
  }
  return parsed.data;
}

export const viewMutators = {
  create: defineMutator(viewCreateArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    if (isBuiltinKey(args.id)) {
      throw new MutationError(
        "view id must not start with 'builtin:'",
        MutationErrorCode.INVALID_INPUT,
        args.id,
      );
    }
    const query = validateOrThrow(viewQueryZ, args.query, 'query');
    const sort = args.sort ? validateOrThrow(viewSortZ, args.sort, 'sort') : DEFAULT_VIEW_SORT;
    const groupBy =
      args.groupBy === undefined ? null : validateOrThrow(groupByZ, args.groupBy, 'groupBy');
    const displayProps = args.displayProps
      ? validateOrThrow(displayPropsZ, args.displayProps, 'displayProps')
      : DEFAULT_DISPLAY_PROPS;

    const ts = now();
    await tx.mutate.view.insert({
      id: args.id,
      workspaceID: authData.workspaceID,
      kind: 'inbox',
      scope: args.scope,
      ownerID: authData.sub,
      label: args.label,
      description: args.description ?? undefined,
      icon: args.icon ?? undefined,
      color: args.color ?? undefined,
      query: query as unknown as Parameters<typeof tx.mutate.view.insert>[0]['query'],
      sort: sort as unknown as Parameters<typeof tx.mutate.view.insert>[0]['sort'],
      groupBy: groupBy ?? undefined,
      displayProps: displayProps as unknown as Parameters<
        typeof tx.mutate.view.insert
      >[0]['displayProps'],
      archivedAt: undefined,
      createdAt: ts,
      updatedAt: ts,
    });

    // Owner gets a member row at position 0 so the view shows up at the
    // front of their tab strip.
    await tx.mutate.viewMember.insert({
      viewID: args.id,
      userID: authData.sub,
      workspaceID: authData.workspaceID,
      position: 0,
      hiddenAt: undefined,
      createdAt: ts,
      updatedAt: ts,
    });
  }),

  update: defineMutator(viewUpdateArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    await assertCanModifyView(tx, authData, args.id);

    const change: Record<string, unknown> = { id: args.id, updatedAt: now() };
    if (args.label !== undefined) change.label = args.label;
    if (args.description !== undefined) change.description = args.description;
    if (args.icon !== undefined) change.icon = args.icon;
    if (args.color !== undefined) change.color = args.color;
    if (args.query !== undefined) {
      change.query = validateOrThrow(viewQueryZ, args.query, 'query');
    }
    if (args.sort !== undefined) {
      change.sort = validateOrThrow(viewSortZ, args.sort, 'sort');
    }
    if (args.groupBy !== undefined) {
      change.groupBy = validateOrThrow(groupByZ, args.groupBy, 'groupBy');
    }
    if (args.displayProps !== undefined) {
      change.displayProps = validateOrThrow(displayPropsZ, args.displayProps, 'displayProps');
    }
    await tx.mutate.view.update(change as { id: string });
  }),

  archive: defineMutator(viewIDOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    await assertCanModifyView(tx, authData, args.id);
    const ts = now();
    await tx.mutate.view.update({ id: args.id, archivedAt: ts, updatedAt: ts });
  }),

  restore: defineMutator(viewIDOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    await assertCanModifyView(tx, authData, args.id);
    await tx.mutate.view.update({ id: args.id, archivedAt: null, updatedAt: now() });
  }),

  /**
   * Hide a view *for the current agent only*. Workspace views remain visible
   * to other agents. For personal views this is a noop (use archive instead).
   */
  hide: defineMutator(viewIDOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    if (isBuiltinKey(args.id)) {
      const ts = now();
      const key = args.id.slice(BUILTIN_PREFIX.length);
      const existing = await tx.run(
        builder.builtinViewMember
          .where('builtinKey', key)
          .where('userID', authData.sub)
          .where('workspaceID', authData.workspaceID)
          .one(),
      );
      if (existing) {
        await tx.mutate.builtinViewMember.update({
          builtinKey: key,
          userID: authData.sub,
          workspaceID: authData.workspaceID,
          hiddenAt: ts,
          updatedAt: ts,
        });
      } else {
        await tx.mutate.builtinViewMember.insert({
          builtinKey: key,
          userID: authData.sub,
          workspaceID: authData.workspaceID,
          position: 0,
          hiddenAt: ts,
          createdAt: ts,
          updatedAt: ts,
        });
      }
      return;
    }

    await assertViewInWorkspace(tx, authData, args.id);
    const ts = now();
    const existing = await tx.run(
      builder.viewMember.where('viewID', args.id).where('userID', authData.sub).one(),
    );
    if (existing) {
      await tx.mutate.viewMember.update({
        viewID: args.id,
        userID: authData.sub,
        hiddenAt: ts,
        updatedAt: ts,
      });
    } else {
      await tx.mutate.viewMember.insert({
        viewID: args.id,
        userID: authData.sub,
        workspaceID: authData.workspaceID,
        position: 0,
        hiddenAt: ts,
        createdAt: ts,
        updatedAt: ts,
      });
    }
  }),

  unhide: defineMutator(viewIDOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    if (isBuiltinKey(args.id)) {
      const key = args.id.slice(BUILTIN_PREFIX.length);
      const existing = await tx.run(
        builder.builtinViewMember
          .where('builtinKey', key)
          .where('userID', authData.sub)
          .where('workspaceID', authData.workspaceID)
          .one(),
      );
      if (!existing) return;
      await tx.mutate.builtinViewMember.update({
        builtinKey: key,
        userID: authData.sub,
        workspaceID: authData.workspaceID,
        hiddenAt: null,
        updatedAt: now(),
      });
      return;
    }
    await assertViewInWorkspace(tx, authData, args.id);
    const existing = await tx.run(
      builder.viewMember.where('viewID', args.id).where('userID', authData.sub).one(),
    );
    if (!existing) return;
    await tx.mutate.viewMember.update({
      viewID: args.id,
      userID: authData.sub,
      hiddenAt: null,
      updatedAt: now(),
    });
  }),

  /**
   * Per-agent reorder. Accepts an ordered list of view ids (custom uuids
   * and/or `builtin:<key>` strings); writes `position = i` for each. Members
   * not in the list are untouched.
   */
  reorder: defineMutator(viewReorderArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    const ts = now();
    for (let i = 0; i < args.orderedIDs.length; i++) {
      const id = args.orderedIDs[i] ?? '';
      if (!id) continue;
      if (isBuiltinKey(id)) {
        const key = id.slice(BUILTIN_PREFIX.length);
        const existing = await tx.run(
          builder.builtinViewMember
            .where('builtinKey', key)
            .where('userID', authData.sub)
            .where('workspaceID', authData.workspaceID)
            .one(),
        );
        if (existing) {
          await tx.mutate.builtinViewMember.update({
            builtinKey: key,
            userID: authData.sub,
            workspaceID: authData.workspaceID,
            position: i,
            updatedAt: ts,
          });
        } else {
          await tx.mutate.builtinViewMember.insert({
            builtinKey: key,
            userID: authData.sub,
            workspaceID: authData.workspaceID,
            position: i,
            hiddenAt: undefined,
            createdAt: ts,
            updatedAt: ts,
          });
        }
        continue;
      }

      const v = await tx.run(builder.view.where('id', id).one());
      if (!v || v.workspaceID !== authData.workspaceID) continue;
      const existing = await tx.run(
        builder.viewMember.where('viewID', id).where('userID', authData.sub).one(),
      );
      if (existing) {
        await tx.mutate.viewMember.update({
          viewID: id,
          userID: authData.sub,
          position: i,
          updatedAt: ts,
        });
      } else {
        await tx.mutate.viewMember.insert({
          viewID: id,
          userID: authData.sub,
          workspaceID: authData.workspaceID,
          position: i,
          hiddenAt: undefined,
          createdAt: ts,
          updatedAt: ts,
        });
      }
    }
  }),

  duplicate: defineMutator(viewDuplicateArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    const source = await assertViewInWorkspace(tx, authData, args.id);
    const ts = now();
    await tx.mutate.view.insert({
      id: args.newID,
      workspaceID: authData.workspaceID,
      kind: 'inbox',
      scope: 'personal',
      ownerID: authData.sub,
      label: `${source.label} (copy)`,
      description: source.description ?? undefined,
      icon: source.icon ?? undefined,
      color: source.color ?? undefined,
      query: source.query,
      sort: source.sort,
      groupBy: source.groupBy ?? undefined,
      displayProps: source.displayProps,
      archivedAt: undefined,
      createdAt: ts,
      updatedAt: ts,
    });
    await tx.mutate.viewMember.insert({
      viewID: args.newID,
      userID: authData.sub,
      workspaceID: authData.workspaceID,
      position: 0,
      hiddenAt: undefined,
      createdAt: ts,
      updatedAt: ts,
    });
  }),
};

export type ViewDisplayProps = DisplayProps;
export type ViewQueryShape = ViewQuery;
export type ViewSortShape = ViewSort;
