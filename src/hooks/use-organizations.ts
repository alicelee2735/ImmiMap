"use client";

import useSWR from "swr";

import type { ImmigrationService } from "@/types/immimap";

async function jsonFallbackServices(): Promise<ImmigrationService[]> {
  const { getCatalogServices } = await import("@/lib/catalog-data");
  return getCatalogServices();
}

type MapOrganizationsResult = {
  services: ImmigrationService[];
  usingFallback: boolean;
  error: string | null;
};

const MAP_ORGANIZATIONS_KEY = "/api/organizations/map";

async function fetchMapOrganizations(
  url: string,
): Promise<MapOrganizationsResult> {
  try {
    const response = await fetch(url);

    if (response.status === 503) {
      return {
        services: await jsonFallbackServices(),
        usingFallback: true,
        error: "Service temporarily unavailable.",
      };
    }

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      throw new Error(payload.error ?? "Failed to load organizations.");
    }

    const payload = (await response.json()) as {
      services: ImmigrationService[];
    };

    return {
      services: payload.services,
      usingFallback: false,
      error: null,
    };
  } catch (fetchError) {
    return {
      services: await jsonFallbackServices(),
      usingFallback: true,
      error:
        fetchError instanceof Error
          ? fetchError.message
          : "Service temporarily unavailable.",
    };
  }
}

export function useOrganizations() {
  const { data, isLoading } = useSWR(
    MAP_ORGANIZATIONS_KEY,
    fetchMapOrganizations,
    { revalidateOnFocus: false },
  );

  return {
    services: data?.services ?? [],
    loading: isLoading,
    error: data?.error ?? null,
    usingFallback: data?.usingFallback ?? false,
  };
}
