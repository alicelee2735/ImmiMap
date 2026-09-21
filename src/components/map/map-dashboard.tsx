"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Languages, Loader2, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImmimapMap } from "@/components/map/immimap-map";
import { PricingBadge } from "@/components/map/pricing-badge";
import { MapZoomControls, type MapCommands } from "@/components/map/map-zoom-controls";
import { MobileFiltersControl } from "@/components/map/mobile-filters-control";
import { ServiceDetailSheet } from "@/components/map/service-detail-sheet";
import {
  DEFAULT_SEARCH_VALUES,
  OrganizationSearch,
  type LocationSuggestion,
  type OrganizationSearchValues,
  type StateSuggestion,
} from "@/components/search/organization-search";
import { useMobileSheetHeight } from "@/hooks/use-mobile-sheet-height";
import { useOrganizations } from "@/hooks/use-organizations";
import {
  pagesNeededForIndex,
  paginateResults,
} from "@/lib/map-results-page";
import {
  filterServicesByQuery,
  filterServicesByCity,
  getServiceCity,
  getServiceStreet,
} from "@/lib/search-services";
import { STATE_BOUNDING_BOXES } from "@/lib/us-states";
import { cn } from "@/lib/utils";
import { filterServices, useMapFiltersStore, ALL_STATES, areFiltersAtDefaults, collectServiceTypes } from "@/stores/map-filters";
import type { ImmigrationService } from "@/types/immimap";

function searchFromQueryParam(q: string | null): OrganizationSearchValues {
  const query = q?.trim() ?? "";
  if (!query) return DEFAULT_SEARCH_VALUES;
  return { ...DEFAULT_SEARCH_VALUES, query };
}

/** Breathing room below overlay chrome before the map's usable area begins. */
const FLOATING_PANEL_GAP_PX = 12;

function overlayBottomInSection(
  section: HTMLElement,
  el: HTMLElement | null,
): number {
  if (!el) return 0;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return 0;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return 0;
  const sectionRect = section.getBoundingClientRect();
  return Math.max(0, rect.bottom - sectionRect.top);
}

/**
 * On desktop, inset Leaflet below the floating search card so pins aren't
 * painted under opaque chrome. On mobile the Filters pill and zoom control
 * float over the tiles (same as desktop zoom) — insetting there left a solid
 * paper strip above the map.
 */
function useMapChromeInset() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<HTMLDivElement | null>(null);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const [topInsetPx, setTopInsetPx] = useState(0);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const media = window.matchMedia("(min-width: 768px)");

    const update = () => {
      if (!media.matches) {
        setTopInsetPx((prev) => (prev === 0 ? prev : 0));
        return;
      }
      const bottom = overlayBottomInSection(section, panelRef.current);
      const next = bottom > 0 ? Math.ceil(bottom + FLOATING_PANEL_GAP_PX) : 0;
      setTopInsetPx((prev) => (prev === next ? prev : next));
    };

    const observer = new ResizeObserver(update);
    observer.observe(section);
    if (panelRef.current) observer.observe(panelRef.current);
    update();
    media.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return { sectionRef, panelRef, zoomRef, filtersRef, topInsetPx };
}

type ServiceResultCardProps = {
  service: ImmigrationService;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  setHoveredId: (id: string | null) => void;
};

/** Compact sidebar list card — essentials only; full profile lives in the detail drawer. */
function ServiceResultCard({
  service,
  selected,
  hovered,
  onSelect,
  setHoveredId,
}: ServiceResultCardProps) {
  const tMap = useTranslations("Map");
  const cardRef = useRef<HTMLDivElement | null>(null);
  const city = getServiceCity(service);
  const locationLabel = city ? `${city}, ${service.state}` : service.state;
  const street = getServiceStreet(service);
  const languages = service.languages?.filter(Boolean) ?? [];
  const languagePreview =
    languages.length > 2
      ? `${languages.slice(0, 2).join(", ")} +${languages.length - 2}`
      : languages.join(", ");

  useEffect(() => {
    if (selected) {
      cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selected]);

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onMouseEnter={() => setHoveredId(service.id)}
      onMouseLeave={() => setHoveredId(null)}
      onFocus={() => setHoveredId(service.id)}
      onBlur={() => setHoveredId(null)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "cursor-pointer border-l-4 border-l-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal-amber",
        selected
          ? "border-l-route-blue bg-signal-amber/10"
          : hovered
            ? "border-l-signal-amber bg-paper"
            : "hover:border-l-route-blue/40 hover:bg-paper",
      )}
    >
      <div className="space-y-2.5 px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap gap-1.5">
          {service.services_offered[0] ? (
          <Badge
            variant="outline"
            className="rounded-sm border border-route-blue/30 bg-paper font-medium text-ink-navy"
          >
            {service.services_offered[0]}
          </Badge>
          ) : null}
          <PricingBadge pricing={service.pricing} />
        </div>

        <h3 className="font-serif text-base font-semibold tracking-tight text-ink-navy sm:text-lg">
          {service.name}
        </h3>

        <div className="flex items-start gap-1.5 text-sm text-charcoal">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-route-blue" aria-hidden />
          <span className="leading-snug">
            {street ? (
              <>
                <span className="block text-charcoal">{street}</span>
                <span className="block text-xs text-charcoal/60">{locationLabel}</span>
              </>
            ) : (
              locationLabel
            )}
          </span>
        </div>

        {languagePreview ? (
          <p className="flex items-start gap-1.5 text-xs text-charcoal/80">
            <Languages className="mt-0.5 h-3.5 w-3.5 shrink-0 text-route-blue" aria-hidden />
            <span className="leading-relaxed">{languagePreview}</span>
          </p>
        ) : null}

        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0 text-sm font-semibold text-route-blue"
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          {tMap("viewDetails")}
        </Button>
      </div>
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <div className="divide-y divide-gray-200" aria-hidden>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="animate-pulse space-y-2.5 px-4 py-3.5 sm:px-5">
          <div className="flex gap-2">
            <div className="h-5 w-16 rounded-sm bg-slate-200" />
            <div className="h-5 w-20 rounded-sm bg-slate-200" />
          </div>
          <div className="h-5 w-3/4 rounded bg-slate-200" />
          <div className="h-3 w-1/2 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

export function MapDashboard() {
  const t = useTranslations("Map");
  const searchParams = useSearchParams();
  const [search, setSearch] = useState<OrganizationSearchValues>(() =>
    searchFromQueryParam(searchParams.get("q")),
  );
  const { services, loading, error, usingFallback } = useOrganizations();
  const states = useMapFiltersStore((s) => s.states);
  const categories = useMapFiltersStore((s) => s.categories);
  const availableServiceTypes = useMapFiltersStore((s) => s.availableServiceTypes);
  const pricingTiers = useMapFiltersStore((s) => s.pricingTiers);
  const languages = useMapFiltersStore((s) => s.languages);
  const selectedServiceId = useMapFiltersStore((s) => s.selectedServiceId);
  const hoveredProviderId = useMapFiltersStore((s) => s.hoveredProviderId);
  const selectService = useMapFiltersStore((s) => s.selectService);
  const setHoveredId = useMapFiltersStore((s) => s.setHoveredProviderId);
  const setStates = useMapFiltersStore((s) => s.setStates);
  const setAvailableServiceTypes = useMapFiltersStore(
    (s) => s.setAvailableServiceTypes,
  );
  const requestFocusBounds = useMapFiltersStore((s) => s.requestFocusBounds);
  const requestNationalFrame = useMapFiltersStore((s) => s.requestNationalFrame);
  const clearFocusBounds = useMapFiltersStore((s) => s.clearFocusBounds);
  const { sectionRef, panelRef, zoomRef, filtersRef, topInsetPx } =
    useMapChromeInset();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const mapCommandsRef = useRef<MapCommands | null>(null);
  const onMapCommandsReady = useCallback((commands: MapCommands | null) => {
    mapCommandsRef.current = commands;
  }, []);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { height: mobileSheetHeight, dragging: sheetDragging, handleProps: sheetHandleProps } =
    useMobileSheetHeight(shellRef, { selected: Boolean(selectedServiceId) });

  useEffect(() => {
    if (loading) return;
    setAvailableServiceTypes(collectServiceTypes(services));
  }, [loading, services, setAvailableServiceTypes]);

  const storeFiltered = useMemo(
    () =>
      filterServices(services, {
        states,
        categories,
        availableServiceTypes,
        pricingTiers,
        languages,
      }),
    [services, states, categories, availableServiceTypes, pricingTiers, languages],
  );

  const visible = useMemo(() => {
    if (search.city) {
      return filterServicesByCity(
        storeFiltered,
        search.city,
        search.cityState,
      );
    }
    // State suggestion already narrowed the store filter — skip text matching.
    if (search.selectedState) {
      return storeFiltered;
    }
    return filterServicesByQuery(storeFiltered, search.query);
  }, [
    storeFiltered,
    search.city,
    search.cityState,
    search.selectedState,
    search.query,
  ]);

  const [loadedPages, setLoadedPages] = useState(1);
  const visibleKey = useMemo(
    () => visible.map((service) => service.id).join("\0"),
    [visible],
  );

  useEffect(() => {
    setLoadedPages(1);
  }, [visibleKey]);

  useEffect(() => {
    if (!selectedServiceId) return;
    const index = visible.findIndex((service) => service.id === selectedServiceId);
    if (index < 0) return;
    const needed = pagesNeededForIndex(index);
    setLoadedPages((pages) => (pages < needed ? needed : pages));
  }, [selectedServiceId, visible]);

  const listed = useMemo(
    () => paginateResults(visible, loadedPages),
    [visible, loadedPages],
  );

  useEffect(() => {
    if (
      selectedServiceId &&
      !visible.some((service) => service.id === selectedServiceId)
    ) {
      selectService(null);
    }
  }, [selectService, selectedServiceId, visible]);

  const empty = !loading && visible.length === 0;
  const fatalError = !loading && error && services.length === 0;
  const searchActive = Boolean(
    search.query.trim() || search.city || search.selectedState,
  );
  const filtersDefault = areFiltersAtDefaults({
    states,
    categories,
    availableServiceTypes,
    pricingTiers,
    languages,
  });
  const filterCount = (searchActive ? 1 : 0) + (filtersDefault ? 0 : 1);

  const onSelectSuggestion = (service: ImmigrationService) =>
    selectService(service.id);
  const onSelectLocation = (location: LocationSuggestion) => {
    selectService(null);
    clearFocusBounds();
    setStates([location.state]);
  };
  const onSelectState = (state: StateSuggestion) => {
    selectService(null);
    setStates([state.code]);
    const bounds = STATE_BOUNDING_BOXES[state.code];
    if (bounds) {
      requestFocusBounds(bounds);
    }
  };
  const onClearSearch = () => {
    selectService(null);
    setStates([...ALL_STATES]);
    requestNationalFrame();
  };

  return (
    <div
      ref={shellRef}
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden p-0 md:p-4"
      style={{ ["--mobile-sheet-h" as string]: `${mobileSheetHeight}px` }}
    >
      {/* Map + sidebar: height strictly the fixed shell; never grow with content. */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row md:gap-4">
        <section
          ref={sectionRef}
          className="relative z-0 min-h-0 min-w-0 flex-1 overflow-hidden bg-paper max-md:absolute max-md:inset-0 md:rounded-sm md:border md:border-ink-navy/15 md:shadow-md"
        >
          <div
            ref={filtersRef}
            className="pointer-events-none absolute top-3 left-3 z-[1000] w-fit md:hidden"
          >
            <div className="pointer-events-auto">
              <MobileFiltersControl
                open={filtersOpen}
                onOpenChange={setFiltersOpen}
                filterCount={filterCount}
                search={search}
                onSearchChange={setSearch}
                suggestions={storeFiltered}
                onSelectSuggestion={onSelectSuggestion}
                onSelectLocation={onSelectLocation}
                onSelectState={onSelectState}
                onClear={onClearSearch}
              />
            </div>
          </div>
          <div
            ref={zoomRef}
            className="pointer-events-none absolute top-3 right-3 z-[1001] md:top-4 md:right-4"
          >
            <div className="pointer-events-auto">
              <MapZoomControls
                onZoomIn={() => mapCommandsRef.current?.zoomIn()}
                onZoomOut={() => mapCommandsRef.current?.zoomOut()}
              />
            </div>
          </div>
          <OrganizationSearch
            variant="floating"
            panelRef={panelRef}
            values={search}
            onChange={setSearch}
            suggestions={storeFiltered}
            onSelectSuggestion={onSelectSuggestion}
            onSelectLocation={onSelectLocation}
            onSelectState={onSelectState}
            onClear={onClearSearch}
          />
          {/*
            Desktop: inset below the search card. Mobile: full-bleed tiles so
            Filters / zoom float over the map instead of sitting in a paper bar.
          */}
          <div
            className="absolute inset-x-0 bottom-0 z-0 overflow-hidden"
            style={{ top: topInsetPx }}
          >
            <ImmimapMap
              services={loading ? [] : visible}
              onCommandsReady={onMapCommandsReady}
            />
          </div>
          {loading ? (
            <div
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[1px]"
              role="status"
              aria-live="polite"
            >
              <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-background/95 px-6 py-4 shadow-sm">
                <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden />
                <p className="text-sm font-medium text-muted-foreground">
                  {t("loadingMap")}
                </p>
              </div>
            </div>
          ) : null}
          {error && usingFallback && services.length > 0 ? (
            <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center px-4 md:top-4 md:justify-end">
              <p className="pointer-events-auto rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 shadow-sm">
                {t("serviceUnavailable")} {t("showingCachedData")}
              </p>
            </div>
          ) : null}
          {empty ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center px-4 pt-20 md:pt-28">
              <div
                className="pointer-events-auto max-w-md rounded-xl border border-slate-200 bg-background/95 px-4 py-3 text-center shadow-sm backdrop-blur"
                role="status"
              >
                <p className="text-sm font-medium text-foreground">
                  {t("emptyStateTitle")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("emptyStateHint")}
                </p>
              </div>
            </div>
          ) : null}
        </section>

        <aside
          className={cn(
            "relative z-10 flex min-h-0 w-full shrink-0 flex-col overflow-hidden border border-ink-navy/15 bg-paper shadow-sm",
            "max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:z-20 max-md:h-[var(--mobile-sheet-h)] max-md:rounded-t-sm",
            "md:h-full md:w-[400px] md:rounded-sm",
            !sheetDragging && "max-md:transition-[height] max-md:duration-200 max-md:ease-out",
          )}
        >
          <div
            className="relative z-30 cursor-grab touch-none select-none border-b border-ink-navy/10 active:cursor-grabbing md:hidden"
            style={{ touchAction: "none" }}
            role="button"
            aria-label={t("sheetDragHint")}
            tabIndex={0}
            {...sheetHandleProps}
          >
            <div className="flex min-h-11 flex-col items-center justify-end pt-2.5">
              <div className="h-1.5 w-10 rounded-full bg-slate-300" aria-hidden />
              <span className="sr-only">{t("sheetDragHint")}</span>
            </div>
            {selectedServiceId ? null : (
            <div className="px-4 pt-2 pb-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-route-blue">
                {t("resultsEyebrow")}
              </p>
              <p className="mt-1 font-serif text-lg font-semibold tracking-[-0.01em] text-ink-navy">
                {loading
                  ? t("loadingResults")
                  : t("resultsCount", { count: visible.length })}
              </p>
            </div>
            )}
          </div>
          <div className={cn("hidden shrink-0 border-b border-ink-navy/10 px-5 py-4 md:block", selectedServiceId && "md:hidden")}>
            <p className="text-sm font-medium tracking-widest text-route-blue">
              {t("resultsEyebrow")}
            </p>
            <div className="mt-1 flex items-end justify-between gap-3">
              <div>
                <h2 className="font-serif text-xl font-semibold tracking-tight text-ink-navy">
                  {t("resultsTitle")}
                </h2>
                <p className="mt-1 text-sm text-charcoal">
                  {loading
                    ? t("loadingResults")
                    : t("resultsCount", { count: visible.length })}
                </p>
              </div>
              <Badge
                variant="outline"
                className="shrink-0 rounded-sm border-ink-navy/15"
              >
                {t("liveResults")}
              </Badge>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-paper">
          <div className="immimap-results-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth bg-paper">
            {loading ? (
              <SidebarSkeleton />
            ) : fatalError ? (
              <div className="mx-4 mt-4 rounded-md border border-red-100 bg-red-50 p-4 text-sm text-red-700">
                <p className="font-medium">{t("serviceUnavailable")}</p>
                <p className="mt-1">{t("serviceUnavailableHint")}</p>
              </div>
            ) : error && usingFallback ? (
              <div className="mx-4 mt-4 rounded-md border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-medium">{t("serviceUnavailable")}</p>
                <p className="mt-1">{t("showingCachedData")}</p>
              </div>
            ) : null}
            {!loading && !fatalError && empty ? (
              <div className="px-4 py-8 text-center sm:px-5">
                <p className="text-sm font-medium text-foreground">
                  {t("emptyStateTitle")}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t("emptyStateHint")}
                </p>
              </div>
            ) : null}
            {!loading && !fatalError && !empty ? (
              <div className="divide-y divide-gray-200">
                {listed.items.map((service) => (
                  <ServiceResultCard
                    key={service.id}
                    service={service}
                    selected={service.id === selectedServiceId}
                    hovered={service.id === hoveredProviderId}
                    onSelect={() => selectService(service.id)}
                    setHoveredId={setHoveredId}
                  />
                ))}
              </div>
            ) : null}
            {!loading && !fatalError && listed.hasMore ? (
              <div className="px-4 py-3 sm:px-5">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full rounded-sm"
                  onClick={() => setLoadedPages((pages) => pages + 1)}
                >
                  {t("loadMore")}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="hidden shrink-0 border-t border-slate-100 px-4 py-2.5 sm:px-5 md:block">
            <p className="text-xs text-slate-400">
              {t("provenanceTimestamp")}{" "}
              <time className="tabular-nums text-slate-500">
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
              {t("provenanceCadence")}
            </p>
          </div>

          {/* Overlay fills this well so the list header is never left on screen. */}
          <ServiceDetailSheet services={services} />
          </div>
        </aside>
      </div>
    </div>
  );
}
