export const MAP_RESULTS_PAGE_SIZE = 40;

export function paginateResults<T>(
  items: readonly T[],
  loadedPages: number,
  pageSize: number = MAP_RESULTS_PAGE_SIZE,
): { items: T[]; hasMore: boolean; total: number } {
  const pages = Math.max(1, loadedPages);
  const limit = pageSize * pages;
  return {
    items: items.slice(0, limit) as T[],
    hasMore: items.length > limit,
    total: items.length,
  };
}

export function pagesNeededForIndex(
  index: number,
  pageSize: number = MAP_RESULTS_PAGE_SIZE,
): number {
  if (index < 0) return 1;
  return Math.floor(index / pageSize) + 1;
}
