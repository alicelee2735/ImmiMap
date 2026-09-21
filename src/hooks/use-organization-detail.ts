"use client";

import useSWR from "swr";

import { organizationToImmigrationService } from "@/lib/organization-mappers";
import type { OrganizationWithServices } from "@/types/database.types";
import type { ImmigrationService } from "@/types/immimap";

async function fetchOrganizationDetail(
  url: string,
): Promise<ImmigrationService> {
  const response = await fetch(url);
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? "Failed to load organization.");
  }
  const payload = (await response.json()) as {
    organization: OrganizationWithServices;
  };
  const service = organizationToImmigrationService(payload.organization);
  if (!service) {
    throw new Error("Organization is missing required location fields.");
  }
  return service;
}

export function useOrganizationDetail(service: ImmigrationService | null) {
  const needsDetail =
    Boolean(service?.dbId) && service?.description === undefined;
  const { data, error, isLoading } = useSWR(
    needsDetail && service?.dbId ? `/api/organizations/${service.dbId}` : null,
    fetchOrganizationDetail,
    { revalidateOnFocus: false },
  );

  if (!service) {
    return { service: null, loading: false };
  }
  if (data) {
    return { service: { ...service, ...data }, loading: false };
  }
  return { service, loading: needsDetail && isLoading && !error };
}
