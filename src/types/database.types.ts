export type LanguageEvidenceKind =
  | "offering-phrase"
  | "language-list"
  | "switcher"
  | "staff-bio"
  | "hreflang-switcher";

/** Why a non-English language is marked confirmed. English is never stored here. */
export type LanguageEvidence = {
  language: string;
  sourceUrl: string;
  snippet: string;
  kind: LanguageEvidenceKind;
};

export type Organization = {
  id: string;
  name: string;
  description?: string;
  website_url?: string;
  /**
   * How website_url relates to this listing.
   * Set only by website discovery: `local` (this office/org's site) or
   * `parent` (national/HQ/umbrella). Null means unclassified, including
   * every URL that predates that pass.
   */
  website_scope?: "local" | "parent" | null;
  /** Whether website_url currently responds. Defaults true until an audit says otherwise. */
  is_website_active?: boolean | null;
  website_checked_at?: string | null;
  website_check_error?: string | null;
  address?: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
};

export type Service = {
  id: string;
  name: string;
};

export type OrganizationWithServices = Organization & {
  services: Service[];
  legacy_id?: string;
  org_type?: "NGO" | "Law Firm";
  pricing?: string;
  thumbnail_image_url?: string;
  intake_status?: "OPEN" | "LIMITED" | "WAITLISTED";
  languages?: string[];
  /** False when languages[] is an unconfirmed inference (e.g. EOIR's English baseline), not curated data. */
  languages_confirmed?: boolean;
  /**
   * Website-confirmed non-English languages, with the page and snippet
   * they were taken from. Null/absent means none confirmed from a site yet.
   */
  languages_evidence?: LanguageEvidence[] | null;
  catchment_note?: string;
  /** True after ImmiMap manual review. Drives the Verified badge for NGOs. */
  verified?: boolean;
};

export type OrganizationFilters = {
  name?: string;
  city?: string;
  state?: string | string[];
  category?: string;
};

export type CreateOrganizationInput = {
  name: string;
  description?: string;
  website_url?: string;
  address?: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  service_names?: string[];
};

export type UpdateOrganizationInput = Partial<CreateOrganizationInput>;

export type OfficialDataType = "visa_bulletin" | "processing_times";

export type OfficialDataRecord = {
  id: string;
  source_url: string;
  bulletin_month: string;
  data_type: OfficialDataType;
  content: unknown;
  updated_at: string;
};

export type SyncStatusSnapshot = {
  isSyncing: boolean;
  lastRunAt: string | null;
  lastStatus: "success" | "failed" | null;
  lastError: string | null;
  consecutiveFailures: number;
  circuitBreakerOpen: boolean;
  visaBulletinUpdatedAt: string | null;
  processingTimesUpdatedAt: string | null;
};

