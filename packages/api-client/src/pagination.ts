export interface CursorPage<T> {
  data: readonly T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type PageItem<TPage> = TPage extends CursorPage<infer TItem> ? TItem : never;

export async function* paginate<
  TInput extends { cursor?: string },
  TPage extends CursorPage<unknown>,
>(
  input: TInput,
  fetchPage: (input: TInput) => Promise<TPage>,
): AsyncGenerator<PageItem<TPage>, void, unknown> {
  let cursor = input.cursor;

  while (true) {
    const page = await fetchPage({ ...input, cursor });
    for (const item of page.data) yield item as PageItem<TPage>;

    if (!page.hasMore || !page.nextCursor) return;
    cursor = page.nextCursor;
  }
}
