import { NextRequest, NextResponse } from "next/server";

import { getErrorMessage } from "@/lib/errors";
import {
  deleteOrganization,
  fetchOrganizationById,
  updateOrganization,
} from "@/lib/organizations";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import type { UpdateOrganizationInput } from "@/types/database.types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }

  try {
    const { id } = await context.params;
    const organization = await fetchOrganizationById(id);

    if (!organization) {
      return NextResponse.json(
        { error: "Organization not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ organization });
  } catch (error) {
    const message = getErrorMessage(error, "Failed to fetch organization.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }

  try {
    const { id } = await context.params;
    const body = (await request.json()) as UpdateOrganizationInput;
    const organization = await updateOrganization(id, body);
    return NextResponse.json({ organization });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update organization.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }

  try {
    const { id } = await context.params;
    const existing = await fetchOrganizationById(id);

    if (!existing) {
      return NextResponse.json(
        { error: "Organization not found." },
        { status: 404 },
      );
    }

    await deleteOrganization(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete organization.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
