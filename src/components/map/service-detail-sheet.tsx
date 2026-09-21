"use client";

import { useEffect } from "react";
import { ExternalLink, Globe, Info, MapPin, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { PricingBadge } from "@/components/map/pricing-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { VerifiedBadge } from "@/components/verification/verified-badge";
import { useOrganizationDetail } from "@/hooks/use-organization-detail";
import { splitLanguagesForDisplay } from "@/lib/language-evidence";
import { cn } from "@/lib/utils";
import { useMapFiltersStore } from "@/stores/map-filters";
import type { ImmigrationService, IntakeStatus } from "@/types/immimap";

/** Shared Google Form used for listing corrections (same as About page). */
const DATA_CORRECTION_FORM_URL = "https://forms.gle/SZryGqpSC6N3RV6F6";

// ── Languages (confirmed vs assumed) ───────────────────────────────────────────

function LanguagesSection({ service }: { service: ImmigrationService }) {
  const t = useTranslations("ServiceDetail");
  const { confirmed, assumed } = splitLanguagesForDisplay(
    service.languages,
    service.languagesConfirmed,
    service.languagesEvidence,
  );

  if (confirmed.length === 0 && assumed.length === 0) {
    return null;
  }

  return (
    <>
      {confirmed.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-slate-400">
            {t("languagesLabel")}
          </p>
          <div className="flex items-start gap-2">
            <Globe
              className="mt-0.5 h-4 w-4 shrink-0 text-primary"
              aria-hidden
            />
            <p className="leading-relaxed text-slate-700">
              {confirmed.join(" · ")}
            </p>
          </div>
        </div>
      ) : null}

      {assumed.length > 0 ? (
        <div
          className="rounded-md border border-dashed border-amber-300 bg-amber-50/70 px-3 py-2.5"
          role="status"
        >
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-amber-700">
            {t("languagesAssumedLabel")}
          </p>
          <div className="flex items-start gap-2">
            <Globe
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
              aria-hidden
            />
            <p className="leading-relaxed text-amber-900">
              {t("languagesAssumedValue", {
                languages: assumed.join(" · "),
              })}
            </p>
          </div>
          <p className="mt-2 text-xs leading-snug text-amber-700/80">
            {t("languagesAssumedHint")}{" "}
            <a
              href={DATA_CORRECTION_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-amber-400 underline-offset-2 transition-colors hover:text-amber-900"
            >
              {t("reportCorrection")}
            </a>
          </p>
        </div>
      ) : null}
    </>
  );
}

function IntakeStatusBlock({ status }: { status: IntakeStatus }) {
  const t = useTranslations("ServiceDetail");

  if (status === "OPEN") {
    return (
      <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
        <span className="text-sm font-medium text-emerald-700">
          {t("intakeOpen")}
        </span>
      </div>
    );
  }
  if (status === "LIMITED") {
    return (
      <div className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />
        <span className="text-sm font-medium text-amber-700">
          {t("intakeLimitedDetail")}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2">
      <span className="h-2 w-2 rounded-full border border-slate-400" aria-hidden />
      <span className="text-sm font-medium text-slate-600">
        {t("intakePaused")}
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

type Props = {
  services: ImmigrationService[];
};

export function ServiceDetailSheet({ services }: Props) {
  const t = useTranslations("ServiceDetail");
  const selectedServiceId = useMapFiltersStore((s) => s.selectedServiceId);
  const selectService = useMapFiltersStore((s) => s.selectService);

  const slim = services.find((s) => s.id === selectedServiceId) ?? null;
  const { service, loading: detailLoading } = useOrganizationDetail(slim);
  const open = Boolean(slim);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        selectService(null);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, selectService]);

  if (!service) {
    return null;
  }

  const websiteActive =
    Boolean(service.website) && service.isWebsiteActive !== false;
  const websiteUnavailable =
    Boolean(service.website) && service.isWebsiteActive === false;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={service.name}
      className={cn(
        "absolute inset-0 z-20 flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-paper",
        "animate-in slide-in-from-right duration-300",
      )}
    >
      <div className="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-paper p-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("close")}
            onClick={() => selectService(null)}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
          {websiteActive ? (
            <a
              href={service.website}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({
                size: "lg",
                className: "h-10 rounded-full px-4",
              })}
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              {t("visitWebsite")}
            </a>
          ) : null}
        </div>
        {websiteUnavailable ? (
          <div
            className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-left"
            role="status"
          >
            <span className="block text-sm font-medium text-slate-600">
              {t("websiteUnavailable")}
            </span>
            <span className="mt-0.5 block text-xs leading-snug text-slate-500">
              {t("websiteUnavailableHint")}{" "}
              <a
                href={DATA_CORRECTION_FORM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-slate-300 underline-offset-2 transition-colors hover:text-slate-800 hover:decoration-slate-500"
              >
                {t("reportCorrection")}
              </a>
            </span>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="space-y-3 px-4 py-5 text-left sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="pr-8 text-2xl font-semibold leading-tight tracking-tight text-gray-950">
              {service.name}
            </h2>
            {service.pricing ? <PricingBadge pricing={service.pricing} /> : null}
          </div>
          {service.pricing ? null : (
            <div
              className="rounded-md border border-dashed border-amber-300 bg-amber-50/70 px-3 py-2.5"
              role="status"
            >
              <p className="mb-1 text-xs font-medium uppercase tracking-widest text-amber-700">
                {t("pricingUnconfirmedLabel")}
              </p>
              <p className="leading-relaxed text-amber-900">
                {t("pricingUnconfirmedHint")}
              </p>
            </div>
          )}
          <VerifiedBadge type={service.type} verified={service.verified} />
          {service.intakeStatus ? (
            <IntakeStatusBlock status={service.intakeStatus} />
          ) : null}
        </div>

        <div className="flex flex-col gap-5 border-t border-slate-200 px-4 py-5 text-sm sm:px-5">
          <div className="flex gap-3">
            <MapPin
              className="mt-0.5 h-4 w-4 shrink-0 text-primary"
              aria-hidden
            />
            <address className="not-italic leading-relaxed">
              {service.address}
            </address>
          </div>

          {service.catchmentNote ? (
            <div className="flex gap-3 text-slate-500">
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
                aria-hidden
              />
              <p className="leading-relaxed">{service.catchmentNote}</p>
            </div>
          ) : null}

          <p className="text-base leading-relaxed text-slate-600">
            {detailLoading ? (
              <span className="block h-16 animate-pulse rounded bg-slate-100" />
            ) : (
              (service.description ?? t("noDescription"))
            )}
          </p>

          <LanguagesSection service={service} />

          {service.eoirSourced ? (
            <p className="text-sm leading-relaxed text-slate-500">
              {t("eoirRecognitionNote")}
            </p>
          ) : null}

          {service.services_offered.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-widest text-slate-400">
                {t("servicesLabel")}
              </p>
              <ul className="flex flex-wrap gap-2">
                {service.services_offered.map((offering) => (
                  <li key={offering}>
                    <Badge
                      variant="outline"
                      className="rounded-sm border border-route-blue/30 bg-paper font-medium text-ink-navy"
                    >
                      {offering}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
          <p className="text-xs text-slate-400">
            {t("provenanceLabel")}{" "}
            <time className="tabular-nums">
              {new Date().toLocaleDateString(
                "en-US",
                {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                },
              )}
            </time>
            {" · "}
            {t("syncCadence")}
          </p>
        </div>
      </div>
    </div>
  );
}
