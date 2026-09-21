export const OFFICIAL_DATA_CACHE_CONTROL =
  "public, s-maxage=86400, stale-while-revalidate=3600";

/** Map catalog. Shorter than official data so EOIR syncs land without a purge. */
export const MAP_ORGANIZATIONS_CACHE_CONTROL =
  "public, s-maxage=600, stale-while-revalidate=3600";

export function jsonWithCache<T>(
  payload: T,
  init?: ResponseInit & { cacheControl?: string },
): Response {
  const { cacheControl, headers, ...rest } = init ?? {};
  return Response.json(payload, {
    ...rest,
    headers: {
      "Cache-Control": cacheControl ?? OFFICIAL_DATA_CACHE_CONTROL,
      ...headers,
    },
  });
}
