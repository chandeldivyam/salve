// Helper for the `limit + 1` sentinel pagination pattern. Pass the raw rows
// (length up to `limit + 1`) and the display limit; get back the visible
// slice and a `hasMore` signal.

export interface PageResult<T> {
  readonly visible: ReadonlyArray<T>;
  readonly hasMore: boolean;
}

export function paginate<T>(rows: ReadonlyArray<T>, limit: number): PageResult<T> {
  return {
    visible: rows.slice(0, limit),
    hasMore: rows.length > limit,
  };
}
