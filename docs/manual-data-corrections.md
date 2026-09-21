# Manual organization data corrections

Human-reviewed writes to the live `organizations` table that a roster sync
cannot reconstruct. `address` is in `CURATED_COLUMNS`
(`src/lib/ingestion/eoir/sync-organizations.ts`): a later EOIR apply will
not overwrite a populated stored street, and will not re-geocode that row
— `lat`/`lng` stay with the held label. Inserts of genuinely new offices
still receive the roster address and a fresh geocode. This log remains the
why-record for each write, and the check for corrections that are not a
street (name, merge, delete).

After each correction: update production, then `npm run db:export-catalog`
and commit the JSON snapshot with the new log entry.

Sources used the same bar as HIAS / Centro Legal / BDS: the org’s own site
plus GuideStar, Charity Navigator, IAN, EOIR, or a dated filing. Not Google
Maps.

---

## Centro Legal de la Raza (Oakland)

- **Row kept:** `a005adae-f1f6-413a-9841-5971dc0fabc1`
- **What was wrong:** Curated pin sat at **3400 International Blvd**, Oakland
  — the wrong building. The live office is on **E. 12th Street**.
- **Independent sources:** [centrolegal.org](https://www.centrolegal.org)
  contact/office listing; EOIR R&A principal office at 3400 E. 12th Street;
  IAN directory.
- **What changed:** Address → `3400 E. 12th Street, Oakland, CA 94601`.
  Census `Public_AR_Current` pin → `37.77605655167, -122.223928315919`.
  Name, description, pricing, intake, verified left as-is. EOIR key later
  absorbed as `doj-ra-centro-legal-de-la-raza-oakland-94601-f1f5557b`.
- **Do not revert to:** 3400 International Blvd.

## HIAS New York Legal Services

- **Row kept:** `62afde7d-0942-4e4f-8f04-3d6647677d9a`
- **What was wrong:** Curated address **333 7th Ave, New York, NY 10001** was
  the former office. Roster duplicate listed the current Broadway suite.
- **Independent sources:** hias.org office listing; EOIR principal office
  1359 Broadway, Suite 810; GuideStar / Charity Navigator.
- **What changed:** Address → `1359 Broadway, Suite 810, New York, NY 10018`.
  Census pin → `40.751881410161, -73.987625213856` (suite ignored, rooftop
  match). `legacy_id` absorbed
  `doj-ra-hebrew-immigrant-aid-society-hias-new-york-10018-2fb441f9`. Roster
  duplicate `adfff9e1-…` deleted. Old `svc-ny-new-york-hias` key retired.
  Name / description / pricing / intake / verified unchanged.
- **Do not revert to:** 333 7th Ave. Do not re-insert the Broadway roster
  duplicate.

## Brooklyn Defender Services cluster

Same org, several downtown Brooklyn sites. Not one pin.

### Immigration Unit (curated) — Schermerhorn was a bad pin

- **Row kept:** `a1cc3830-eaad-42df-a91b-cad43ca90a6d` (Brooklyn Defender
  Services Immigration Unit)
- **What was wrong:** **160 Schermerhorn St** is The Schermerhorn
  housing / Brooklyn Ballet, not BDS. The immigration practice is on
  Livingston Street.
- **Independent sources:** bds.org Immigration line `(718) 564-6290`; IAN
  “Immigration Practice” at 177 Livingston St, 5th Floor; live EOIR roster
  “Livingston Street 5th Floor Extension Office”; NYIC 2017 provider list.
- **What changed:** Address → `177 Livingston Street, 5th Floor, Brooklyn, NY
  11201`. Census pin → `40.690083895552, -73.986735349297`. EOIR 5th-floor
  roster row `dae75ce4-…` merged in (HIAS/RAICES process):
  `legacy_id` is now
  `doj-ra-brooklyn-defender-services-brooklyn-11201-c7ad6920`. Old
  `svc-ny-brooklyn-brooklyn-defender-services` key retired.
- **Do not revert to:** 160 Schermerhorn St. Do not re-insert the 5th-floor
  roster duplicate.

### 177 Livingston 7th Floor — keep, not a stale copy of 5th

- **Row:** `b0a8485b-242a-4b23-b0be-8842f7b77676`
- **Why it stays:** EOIR principal office and bds.org main/mailing
  `(718) 254-0700`. Census snaps 5th and 7th to the same rooftop; the floors
  are real. Different phone from the immigration unit.

### 180 Livingston — keep, currently operating

- **Row:** `6250d305-bcb2-4f3a-bd13-557112357269`
- **Why it stays:** FY21 lease list and NYSED additional setting through
  2026-12-31. Not a second pin for the immigration unit.

### Other BDS roster sites — keep

Adams (`335 Adams Street`), Montague (`195 Montague Street`), Pierrepont
(`156 Pierrepont Street`), and Livonia (`566 Livonia Avenue`) are other BDS
sites, not Schermerhorn duplicates.

## California Rural Legal Assistance Sacramento — deleted

- **Row deleted:** `27c84f77-800b-4631-97d1-b1831da51be7`
  (`svc-ca-sacramento-crla-sacramento`)
- **What was wrong:** Listing claimed a CRLA, Inc. Sacramento office at
  **828 J St** with phone **(916) 446-3300**. CRLA, Inc. has no Sacramento
  office. 828 J St is a restaurant (Pete’s). (916) 446-3300 is Cresco-Resco
  restaurant supply. Same class as Catholic Charities El Paso / Mixtec
  Fresno: delete, do not relocate.
- **Independent sources:** [crla.org/locations](https://crla.org/locations)
  (HQ Modesto, no Sacramento); GuideStar / Charity Navigator EIN
  **95-2428657** at 1020 15th St Ste 20, Modesto; IAN lists CRLA Inc field
  offices (Modesto, Stockton, Marysville, …) and **no** CRLA Inc Sacramento;
  live EOIR roster has no CRLA Inc Sacramento row. CRLA’s 2022 Form 990
  Schedule I grant to “FOUNDATION - 2210 K STREET, SUITE 201 - SACRAMENTO”
  is **CRLAF**, a sibling EIN, not a CRLA Inc office.
- **What changed:** Row deleted. Service tags cascaded. Nothing copied onto
  CRLAF (`c5540727-e37c-43a6-91ef-1bfe483a0007` at 2210 K Street, Suite 201
  — different EIN **94-2800442**, already live). Did not retarget to Modesto
  (would mislabel HQ as Sacramento) or to 2210 K (would duplicate CRLAF).
- **Do not restore** `svc-ca-sacramento-crla-sacramento`. Do not invent a
  CRLA Inc Sacramento office. Real CRLA Inc sites (Modesto, Stockton,
  Marysville, …) would be **new** rows if ingested later.

Token overlap with CAIR California Sacramento Valley (717 K St) was a
matcher false friend — two separate orgs; no merge.

## Immigration Institute of the Bay Area (formerly International Institute)

- **Row kept:** `64fe3d89-0569-4bc5-8c62-e2f2f90e0b4f`
- **What was wrong:** Curated name **International Institute of the Bay
  Area** and address **657 Mission St** were both stale. Same EIN after a
  rebrand and office move; roster already had the current identity at
  58 Second Street.
- **Independent sources:** [iibayarea.org](https://iibayarea.org) SF office
  and donate page (legal name Immigration Institute of the Bay Area, EIN
  **94-1156554**, 58 2nd Street, 3rd Floor); org Mailchimp rename
  announcement; GuideStar EIN 94-1156554 “formerly known as International
  Institute of the Bay Area”; IAN SF office; SF Treasurer DBA at 657
  Mission St Ste 301 **ended 2018-02-01**, mail already 58 2nd St Fl 3.
- **What changed:** Name → `Immigration Institute of the Bay Area`. Address
  → `58 Second Street, 3rd Floor, San Francisco, CA 94105`. Census pin →
  `37.78853246564, -122.400559371675` (matched `58 2ND ST`; floor ignored).
  `legacy_id` absorbed
  `doj-ra-immigration-institute-of-the-bay-area-san-francisco-94105-43066ff0`.
  Roster duplicate `4f5ff31f-…` deleted. Old `svc-ca-san-francisco-iiba-sf`
  key retired. Website, phone, languages, services, description, pricing,
  intake, verified unchanged.
- **Left in place:** EOIR extension offices in Oakland, Redwood City,
  Brentwood, Napa, Fremont, Petaluma.
- **Do not revert to:** International Institute name or 657 Mission St. Do
  not re-insert the SF roster duplicate.

## Website discovery pass (2026-09-12)

Bulk fill of missing `website_url` values. Not a street/name correction.
Blank rows after this pass are a mix of low-confidence search misses
(left empty because the matcher could not stand behind a URL) and
**32 holds left empty on purpose**. Do not treat those 32 as “not yet
searched.”

Scripts: `scripts/discover-organization-websites.ts` (search, no writes),
`scripts/apply-local-website-discovery.ts`,
`scripts/apply-parent-website-discovery.ts`. Report files live under
gitignored `scripts/reports/`. Scoring lives in
`src/lib/ingestion/website-discovery.ts`. `website_scope` is `'local'`
(this office’s own site) or `'parent'` (national / HQ / umbrella). The
146 URLs that already existed before this pass stay `website_scope`
null — they were never classified.

### What was searched

Every live organization with an empty `website_url` at the start of the
pass: **1,531** of 1,677. Query is the quoted org name plus city; names
shorter than 16 alphanumeric characters also get `immigration legal` so
they do not collide with movies, churches, or unrelated brands. Search
was **Serper only** (no Bing / DuckDuckGo fallback). Directories, social
hosts, GuideStar, IAN, and news domains cannot score high.

### Tiering

Each org’s hits are scored on domain/title name match. **High** means
score ≥ 60, a distinctive domain or title reason, no competing host
within 15 points, and not a news host. High rows then split:

- **`local`** — domain looks like this office / this org.
- **`parent`** — known national label (`worldrelief`, `rescue`,
  `supportkind`, `irco`, `hias`, `catholiccharitiesusa`, …); the org
  name’s place does not match the row’s city and the domain does not
  mention that city; or the URL is a network/locations path without the
  row’s city in the domain.

**1,531 searched → 858 high / 673 low.** High split **740 local** and
**118 parent**. Low rows stay blank (ambiguous hosts, weak token
overlap, empty search, directories only). They are not holds.

### What was written

| Write | Count | `website_scope` |
|---|---:|---|
| High-local after structural holds | 711 | `local` |
| High-parent except CCUSA | 115 | `parent` |
| Predating this pass | 146 | null (unchanged) |

Local arithmetic: 740 − 24 umbrella − 6 city-collision = 710, then the
one collision that was a stored-city typo (`Balitmore` → `Baltimore` on
Immigration Outreach Service Center, `deac1882-…`) was written instead
of held → **711**. Parent arithmetic: 118 − 3 CCUSA member-directory
hits → **115**.

### Held on purpose (32)

**24 + 5 + 3 = 32.** These stayed blank until the 2026-09-13 research
pass (next section). A later roster sync must not invent websites for
them.

#### Check 1 — umbrella / repeated domain (24 local-tier rows)

The scorer called these **local**, but the host is either a known
national brand or is shared by **different org names**. Writing the
homepage as this office’s own site would be a lie. (True parent-tier
nationals such as World Relief, KIND, and IRCO *were* written, with
`website_scope: parent`. That is the intended home for an HQ domain.)

| Host | Rows held |
|---|---|
| `catholiccharitiesca.org` | Catholic Charities of Sacramento; Stockton; Monterey (Seaside + two San Luis Obispo pins). Three dioceses, one California domain. |
| `immigranthope.org` | Immigrant Hope–Clifton NJ (Clifton) and Immigrant Hope Santa Barbara, CA (Arroyo Grande). Two chapter names, one national domain. |
| `ufwfoundation.org` | UFW Foundation in Oxnard, Fresno, Salinas. |
| `tahirih.org` | Tahirih Justice Center in Falls Church, Baltimore, Atlanta, San Bruno. |
| `humanrightsfirst.org` | Human Rights First in New York, Washington DC, Los Angeles. |
| `naleo.org` | NALEO Educational Fund in Houston, Monterey Park, New York. |
| `baji.org` | Black Alliance for Just Immigration in Oakland, Los Angeles, Brooklyn. |
| `cliniclegal.org` | Catholic Legal Immigration Network (Silver Spring) — national CLINIC site, not a local office site. |

A first, broader “city must appear in the domain” rule flagged 589 local
rows and was **dropped**. Most real nonprofit homepages do not put the
city in the hostname; that check is not a signal on its own.

#### Check 2 — city collisions (5 local-tier rows still held)

Narrow slice only: a **different** city’s name appears in the domain,
and that token is not the row’s city or org name. The sixth hit was the
`Balitmore` typo above and is not a hold.

| Row | Stored city | Domain | Why it is suspicious |
|---|---|---|---|
| Logan Square Neighborhood Association (`3d497c2a-…`) | Chicago, IL | `lsnaphilly.org` | Philly in the host for a Chicago listing. |
| Middle Eastern Immigrant and Refugee Alliance (`47addce5-…`) | Lincolnwood, IL | `mirachicago.org` | Chicago in the host; listing is Lincolnwood. May be the same metro org — still not auto-written. |
| Refugee and Immigrant Assistance Center (`50bceed7-…`) | Lynn, MA | `riacboston.org` | Boston in the host for a Lynn listing. |
| Southwest Suburban Immigrant Project (`b1a2d848-…`) | Bolingbrook, IL | `ssipchicago.org` | Chicago in the host for a Bolingbrook listing. |
| West African Community Council (`bdd8c960-…`) | Kent, WA | `waccofseattle.org` | Seattle in the host for a Kent listing. |

#### CCUSA parent holds (3)

Scored high-**parent**, but the URL is a
`catholiccharitiesusa.org/members/…` directory page, not that diocese’s
own site. Leave blank until someone finds the real local website.

- Catholic Charities of the East Bay — Oakland (`344b2486-…`)
- Catholic Charities of Buffalo (`98f6c7c3-…`)
- Catholic Charities of Louisville (`bfabd93f-…`)

### Live totals after this pass

1,677 organizations. **972** have a `website_url` of any scope
(146 predating + 711 local + 115 parent). **705** have none (673 low +
29 local-tier holds + 3 CCUSA). Of the 972 URLs: 711 `local`, 115
`parent`, 146 unclassified.

---

## Website URL pull-backs, SERP sanitizer, and confirmed languages (2026-09-13)

Follow-up to the discovery write above. Audit:
`scripts/audit-written-websites-and-languages.ts`. Apply:
`scripts/apply-url-and-language-corrections.ts --apply`.

### Shared root cause (not seven independent typos)

Six of the seven broken URLs shared one pattern: Serper organic `link`
values arrived with a glued semicolon (`http://www.lupenet.org;`,
`https://hicaalabama.org/en/home;`) or a truncated TLD
(`catholiccharitiesdc.o`). `new URL()` accepted that junk, so a high
name-match wrote a broken Website button.

`sanitizeDiscoveredWebsiteUrl` in
`src/lib/ingestion/website-discovery.ts` now strips SERP leftover
punctuation / HTML entities, rejects a 1-letter or non-alpha TLD, and
is used by both apply scripts. A later discovery/apply batch cannot
rewrite `host;` or `.o`. Vanessa's `.co` → `.com` is a real TLD and
stays a one-off data fix.

### URL writes (14)

**7 dead — `website_url` and `website_scope` set back to null**

Latin American Coalition (Charlotte); Libreria Del Pueblo (San
Bernardino); Servicios Latinos de Burlington County (Mt. Holly, NJ);
Guymon Church of the Nazarene (OK); Kabod Ministries (Greenacres, FL);
Orlando Center for Justice; Bethany Immigration Services (Frisco, CO).

**7 typos — URL corrected, `website_scope` kept**

| Row | From | To |
|---|---|---|
| HICA (Birmingham) parent | `hicaalabama.org/en/home;` | strip trailing `;` |
| LUPE (San Benito, TX) | `lupenet.org;/` | `https://www.lupenet.org/` |
| Centro Hispano Comunitario de Nebraska | `centrohispanone.org;/` | strip `;` |
| Family and Immigration Rights Center (Tallahassee) | `firclaw.org;/` | strip `;` |
| Institute for Children's Aid (Temecula) | `instituteforchildrensaid.org;/` | strip `;` |
| Catholic Charities Archdiocese of Washington | `catholiccharitiesdc.o` | `.org` |
| Vanessa's Social Services (East Orange, NJ) | `vanessasocialservices.co` | `.com` |

**Left as-is (alive, checker-blocked):** 3 gated 403s
(`dioceseoffresno.org`, `maps-inc.org`, `jobs.sandiego.edu`) and 4
HTTP/2 flakes (Community Legal Aid SoCal ×3, Public Law Center).

**Manual later, not this batch:** University of San Diego Legal Clinics
(`d8bf710c-…`) `https://jobs.sandiego.edu/` is a live link to the wrong
page (careers, not the legal clinic).

Live website count after pull-backs: **965** (972 − 7 dead).

### Confirmed languages (371 orgs, non-English only)

Wrote `languages_evidence` jsonb (migration `015`) and set
`languages_confirmed = true` only for organizations with at least one
website-confirmed **non-English** language. These are not inferences:
each write is backed by a `sourceUrl` + `snippet` + `kind` trail
(`staff-bio` / `offering-phrase` / `language-list` / `switcher` /
`hreflang-switcher`) so a later reader can see *why* the language is
marked confirmed. English from switchers, hreflang, lists, or weak LEP
copy was not written. The 547 scanned sites with nothing explicit stay
`English (assumed — not yet confirmed)`.

Roster sync holds a populated trail (`CURATED_COLUMNS`). The detail
sheet splits confirmed vs assumed so Spanish can be confirmed while
English stays assumed.

**371 organizations. Breakdown (org counts, not snippets):**

| Language | Orgs |
|---|---:|
| Spanish | 336 |
| French | 71 |
| Arabic | 53 |
| Russian | 51 |
| Vietnamese | 48 |
| Portuguese | 39 |
| Korean | 33 |
| Haitian Creole | 21 |
| Farsi | 20 |
| Mandarin | 19 |
| Tagalog | 18 |
| Bengali | 11 |
| Burmese | 11 |
| Somali | 9 |
| Cantonese | 7 |

Zero evidence rows contain English.

### Catalog snapshot (`npm run db:export-catalog`, 2026-09-13)

62 curated + 1,471 EOIR/pro bono = 1,533 mappable rows. 144 live rows
skipped (unmappable). 339 of the 371 language writes are in the
fallback JSON; the other 32 are live-only (no pin/address, so they are
not catalog rows).

Checked in `src/data/services-expansion.json` after this export:

- **Latin American Coalition** (`4f53b8ae-…`, Charlotte): no `website`
  field (dead URL pulled back).
- **La Union del Pueblo Entero** (`53bee26b-…`, San Benito):
  `website` is `https://www.lupenet.org/` — semicolon gone.
- **Mission Action Inc.** (`01e856bd-…`, San Francisco):
  `languages` = English + Spanish, `languagesConfirmed` true,
  `languagesEvidence` = Spanish only (`sourceUrl`
  `https://www.missionaction.org/`, `kind` `language-list`). Display
  split: confirmed Spanish, assumed English.

---

## Held website research pass (2026-09-13)

Manual review of the 32 discovery holds. Not a street/name correction.
Each URL was checked on the org’s own site (not guessed from Serper).
Apply: `scripts/apply-held-website-research.ts --apply`.

All 32 were still `website_url` null. Wrote 32. Did not overwrite any
existing URL.

### What was written

| Bucket | Count | `website_scope` | What was stored |
|---|---:|---|---|
| Wrong umbrella (5 CC-CA dioceses + Chicago LSNA) | 6 | `local` | Diocese / provider site, not the held domain |
| Dedicated chapter pages | 3 | `local` | Chapter URL on the shared domain |
| Own domain off the umbrella | 4 | `local` | Diocese / chapter site |
| Shared contact / locations pages | 10 | `parent` | Multi-office contact page |
| Umbrella homepage is the right link | 5 | `parent` | Homepage |
| Metro naming, held domain is this org | 4 | `local` | The already-held domain |

**17 `local` + 15 `parent`.**

#### Wrong umbrella → diocese / provider site (`local`)

| Row | Before (held, not written) | After |
|---|---|---|
| Catholic Charities of Sacramento (`52dfcce0-…`, 1951 Bell Ave) | `catholiccharitiesca.org` | `https://www.sacramentofoodbank.org/immigration` |
| Catholic Charities Diocese of Stockton (`61a7aad3-…`, Embarcadero) | `catholiccharitiesca.org` | `https://www.ccstockton.org` |
| Catholic Charities Diocese of Monterey (`75fd3c6c-…`, Seaside) | `catholiccharitiesca.org` | `https://catholiccharitiesdom.org` |
| same diocese (`c9f98677-…`, 3250 S Higuera) | `catholiccharitiesca.org` | `https://catholiccharitiesdom.org` |
| same diocese (`bb16991f-…`, 751 Palm) | `catholiccharitiesca.org` | `https://catholiccharitiesdom.org` |
| Logan Square Neighborhood Association (`3d497c2a-…`, Chicago) | `lsnaphilly.org` (Philadelphia LSNA) | `https://www.palenquelsna.org` |

`catholiccharitiesca.org` is the statewide association, not these
agencies. 751 Palm is Mission San Luis Obispo (event venue), not a live
CC office; the current SLO office is Higuera. Same diocese URL as the
other Monterey pins. Chicago LSNA now operates as Palenque LSNA;
`lsnaphilly.org` is a different org.

#### Dedicated chapter pages (`local`)

| Row | After |
|---|---|
| Immigrant Hope–Clifton NJ (`4a45a108-…`) | `https://immigranthope.org/clifton` |
| BAJI Oakland (`f1602491-…`) | `https://baji.org/our-work/chapters/oakland` |
| BAJI Los Angeles (`f6aa23b4-…`) | `https://baji.org/our-work/chapters/los-angeles` |

#### Own domain (`local`)

| Row | After |
|---|---|
| Immigrant Hope Santa Barbara, CA (`9d331e84-…`, 995 E Grand, Arroyo Grande) | `https://immigranthopeag.org` |
| Catholic Charities of the East Bay (`344b2486-…`, Oakland) | `https://cceb.org` |
| Catholic Charities of Buffalo (`98f6c7c3-…`) | `https://ccwny.org` |
| Catholic Charities of Louisville (`bfabd93f-…`) | `https://cclou.org` |

The Arroyo Grande address is Immigrant Hope Arroyo Grande’s own site,
not the Santa Barbara chapter (`immigranthopesb.org` at 935 San Andres).
CCUSA member-directory URLs were not written.

#### Shared contact / locations (`parent`)

| Rows | After |
|---|---|
| UFW Foundation ×3 (Oxnard, Fresno, Salinas) | `https://ufwfoundation.org/contact-us` |
| Tahirih Justice Center ×4 (Falls Church, Baltimore, Atlanta, San Bruno) | `https://www.tahirih.org/about-us/contact-us` |
| Human Rights First ×3 (New York, Washington DC, Los Angeles) | `https://www.humanrightsfirst.org/contact` |

These pages list multiple offices. `parent` because they are not
office-dedicated landings.

#### Umbrella homepage (`parent`)

| Rows | After |
|---|---|
| CLINIC Silver Spring (`5fe7473a-…`) | `https://www.cliniclegal.org` |
| BAJI Brooklyn (`f6ecf0f1-…`) | `https://www.baji.org` |
| NALEO Educational Fund ×3 (Houston, Monterey Park, New York) | `https://naleo.org` |

CLINIC’s Silver Spring listing *is* national HQ. Brooklyn is BAJI’s HQ
address; no NYC chapter slug exists. NALEO has no per-office pages.

#### Metro naming, held domain is correct (`local`)

| Row | After |
|---|---|
| MIRA Lincolnwood (`47addce5-…`) | `https://mirachicago.org` |
| SSIP Bolingbrook (`b1a2d848-…`) | `https://www.ssipchicago.org` |
| RIAC Lynn (`50bceed7-…`) | `https://www.riacboston.org` |
| WACC Kent (`bdd8c960-…`) | `https://www.waccofseattle.org` |

MIRA’s own contact page lists the Lincolnwood street. SSIP’s contact
page lists the Bolingbrook street. RIAC’s site names Boston, Lynn, and
Worcester (Lynn street is not currently printed). WACC is the same Puget
Sound org; current contact lists Seattle, not the EOIR Kent suite.

### Live totals after this pass

1,677 organizations. **997** have a `website_url` of any scope
(965 after the pull-backs + 32). Of the 997: **721** `local`
(704 remaining after dead pull-backs + 17), **130** `parent`
(115 + 15), **146** unclassified (unchanged).

### Catalog snapshot (`npm run db:export-catalog`, 2026-09-13)

62 curated + 1,471 EOIR/pro bono = 1,533 mappable rows. 144 live rows
skipped (unmappable). **31 of 32** holds are in the JSON; NALEO Houston
(`648115cd-…`) has no pin, so it is live-only.

Checked in `src/data/services-expansion.json` after this export:

- **Catholic Charities of Sacramento** (`52dfcce0-…`):
  `website` is `https://www.sacramentofoodbank.org/immigration`.
- **Logan Square Neighborhood Association** (`3d497c2a-…`):
  `website` is `https://www.palenquelsna.org/` — not lsnaphilly.org.
- **Immigrant Hope–Clifton NJ** (`4a45a108-…`):
  `website` is `https://immigranthope.org/clifton`.
- **Catholic Charities of Louisville** (`bfabd93f-…`):
  `website` is `https://cclou.org/` — not the CCUSA member page.

---

## Human Rights First NY/DC and Tahirih Atlanta office moves (2026-09-15)

Website research flagged three stored streets that no longer match the
orgs’ own contact pages. Independent sources confirm each is a real
relocation, not a website-only mismatch. Apply:
`scripts/apply-stale-office-relocations.ts --apply`.

Name, website, description, pricing, intake, verified unchanged. Did
**not** touch RIAC Lynn or Catholic Charities of Buffalo
(Herkimer vs Delaware) — those still look like unpublished streets, not
confirmed moves.

### Human Rights First — New York (`2dc4817d-…`)

- **What was wrong:** Stored **75 Broad Street, 31st Floor** (ZIP 10004).
  That was the FY2022 Form 990 address. Current site lists a mailing
  address at 121 W 36th Street, PMB 520.
- **Independent sources:** [IAN New York office](https://www.immigrationadvocates.org/legaldirectory/organization.393216-Human_Rights_First_New_York_Office)
  at 121 W 36th Street PMB 520 (IAN also notes Thursday walk-in hours);
  [Charity Navigator EIN 13-3116646](https://www.charitynavigator.org/ein/133116646)
  `121 W 36th Street, PMB 520, New York NY 10018`, sourced from IRS Form
  990 FY2024. EOIR pro bono provider list uses the same street.
- **What changed:** Address → `121 W 36th Street, PMB 520, New York, NY
  10018`. Census `Public_AR_Current` pin → `40.751658616031,
  -73.988065212105` (matched `121 W 36TH ST`; PMB ignored).
- **Do not revert to:** 75 Broad Street, 31st Floor.

### Human Rights First — Washington, DC (`8b72f250-…`)

- **What was wrong:** Stored **805 15th Street, NW, Suite 900** (ZIP
  20005). Current site lists 825 21st Street NW, PMB 253.
- **Independent sources:** [IAN Washington office](https://www.immigrationadvocates.org/nonprofit/legaldirectory/organization.392746-Human_Rights_First_Washington_DC_Office)
  at 825 21st St NW PMB 253; EOIR pro bono provider list (Annandale /
  Baltimore catchment) at the same street; April 2025 EDNY amicus
  letterhead uses 825 21st Street NW, PMB 253.
- **What changed:** Address → `825 21st Street NW, PMB 253, Washington,
  DC 20006`. Census pin → `38.899878170353, -77.046578445468` (matched
  `825 21ST ST NW`; PMB ignored).
- **Do not revert to:** 805 15th Street NW, Suite 900.

### Tahirih Justice Center — Atlanta (`7cac35e7-…`)

- **What was wrong:** Stored **230 Peachtree Street NW, Suite 1960** (ZIP
  30303). Current site and 2025 local-offices impact report list 550
  Pharr Road NE, Suite 215.
- **Independent sources:** [IAN Atlanta office](https://www.immigrationadvocates.org/legaldirectory/organization.809527-Tahirih_Justice_Center_Atlanta_Office)
  at 550 Pharr Road, Suite 215, Atlanta, GA 30305. National 990 / Charity
  Navigator still show Falls Church HQ (6400 Arlington Blvd) — expected
  for EIN 54-1858176; the Atlanta street lives on the IAN office record.
- **What changed:** Address → `550 Pharr Road NE, Suite 215, Atlanta, GA
  30305`. Census pin → `33.837044597625, -84.370552525691` (matched
  `550 PHARR RD NE`; suite ignored).
- **Do not revert to:** 230 Peachtree Street NW, Suite 1960.

### Catalog snapshot (`npm run db:export-catalog`, 2026-09-15)

62 curated + 1,471 EOIR/pro bono = 1,533 mappable rows. 144 unmappable
skipped. Checked in `src/data/services-expansion.json`:

- HRF New York: `121 W 36th Street, PMB 520…`, pin `40.751658616031,
  -73.988065212105`.
- HRF Washington: `825 21st Street NW, PMB 253…`, pin `38.899878170353,
  -77.046578445468`.
- Tahirih Atlanta: `550 Pharr Road NE, Suite 215…`, pin
  `33.837044597625, -84.370552525691`.

## IRS EO BMF / ProPublica expansion (2026-09-20)

Largest catalog expansion to date. IRS Exempt Organizations Business
Master File (P84 + Q71, status 01, 501(c)(3), US) scored against the
live office catalog. Source family `irs-eo`; natural key
`irs-eo-{ein}`. One EIN maps to one unique `legacy_id`.

Matcher (`src/lib/ingestion/eoir/match.ts`): same-city/ZIP first, then
cross-city parent using catalog unique-name document-frequency rarity
(90th percentile cap, floor 2) plus a length/shape filter (token ≥4
letters, not a USPS abbreviation or corporate suffix). Reports live
under gitignored `scripts/reports/`. Scripts:
`scripts/match-bmf-p84-q71.ts`, `scripts/rerun-bmf-parent-rarity.ts`,
`scripts/rerun-bmf-samecity-rarity.ts`. Eligible 2,807 EINs → 163
same-city / 122 parent / 2,522 unmatched before human review.

A later roster sync must not invent service tags, languages, pricing,
or “office” pins for these rows. Single-rare-token hits need a manual
GuideStar/ProPublica EIN check (`needsEinCrossVerification`); the
matcher does not look EINs up.

### Aliases on existing offices (149)

`organization_source_keys` only — no new organization rows. Live
count after review: **9 parent + 140 same-city = 149**.

#### Parent (9)

Cross-city brand matches after the rarity/shape filter. Open Arms
Immigration Services (EIN 33-4831312, Pharr) is **not** Open Arms
Community Center (Coral Gables, EIN 30-0557519) and was not attached.
Discarded: Welcome / Welcome Center, Clearing the Path, Greater Valley
Immigration, Hope Resources, Casa de Venezuela New England, Casa Juan
Diego, Immigration Legal Services of Long Island.

| Alias | Catalog row |
|---|---|
| `irs-eo-472910078` | Al Otro Lado, Inc. — San Diego |
| `irs-eo-232958415` | PRIME — Havertown |
| `irs-eo-845030284` | Colorado Hosting Asylum Network — Pagosa Springs |
| `irs-eo-911923155` | Ukrainian Community Center of Washington — Seattle |
| `irs-eo-273390797` | Somali Bantu Association of America — San Diego |
| `irs-eo-272147714` | NANA — Kendall Park |
| `irs-eo-862323775` | Without Borders Inc. — Orlando |
| `irs-eo-334784021` | Juntos Por Venezuela — North Bergen |
| `irs-eo-300470463` | La Casa De Amistad Inc. — South Bend |

Sibling offices (Al Otro Lado LA, PRIME Lancaster, Ukrainian Mukilteo)
were left without a second copy of the same key.

#### Same-city (140)

163 scored → 116 still matched / 47 auto-excluded. Attached 107
still-keep + 34 same-name rescues, then **retracted**
`irs-eo-521005984` (Korean Community Service Center of Greater
Washington) from NAKASEC — different org. Apply:
`scripts/apply-bmf-samecity-aliases.ts --apply`.

Discarded still-matched: Afghan Community of Central Missouri, African
Alliance of Rhode Island, American-Italian Coalition, Asian Association
of Utah, Chicago Irish Immigrant Support, High Country Meeting Place,
New Mexico Asian Family Center, United Chinese Society of Hawaii,
Wyoming Immigrant Advocacy Project.

Discarded auto-excluded: Afghan Community of Arkansas, Alliance for
Refugees and Immigrants, East African Community Services, Friends of
II Milwaukee, Hispanic Outreach Diocese of Albany, Immigrant Services
NFP, Immigration Solutions Center, Italian Community Center, New
Americans of NJ, Rhode Island Indian Council, South Asian Helpline,
Sudanese Community of CNY, W&Z Immigration.

Juntos Por Venezuela already had parent EIN 33-4784021; same-city EIN
61-1947253 is a second alias on that row.

### Milestone 2 — 109 net-new HQ mailings

Keyword-matched 990/EZ filers from the unmatched remainder. None were
in the resolved same-city or parent buckets. Apply:
`scripts/apply-bmf-m2-109.ts --apply`.

Every row: `legacy_id` `irs-eo-{ein}`; `address_role` mailing;
`catchment_note` “IRS EO BMF HQ mailing address, not a confirmed
service office.”; `verified` false; empty `languages` /
`languages_confirmed` false; no `org_services`; no pricing or intake
claim. Pins are geocoded mailing streets, not confirmed offices.

- **Providence EIN 47-3515841** stored as **Refugee Dream Center**
  (GuideStar DBA / [refugeedreamcenter.org](https://www.refugeedreamcenter.org/)),
  not the colliding IRS legal name Refugee Development Center Inc.
  Row `b35c72b0-…`. Census pin → `41.804152426279, -71.419348470636`.
- **Lansing EIN 26-3936253** kept as **Refugee Development Center**
  (legal name and [refugeedevelopmentcenter.org](https://refugeedevelopmentcenter.org/en/do)).
  Row `1bcbb879-…`. Census pin → `42.67778680721, -84.538108103605`.
- 16 PO Box / incomplete streets have no pin (not shown on the map).

Do not display the Providence row as Refugee Development Center.

### Unknown pricing must not display as Low-cost (2026-09-20)

The live mapper and `scripts/export-catalog-fallback.ts` used
`pricing ?? "Low-cost"`. The 109 new rows (and only those 109) have
`pricing` null, so the fallback JSON and map badges showed a confident
Low-cost tag for unconfirmed fees.

`parsePricingLabel` now keeps only Pro bono / Low-cost / Paid.
Null, blank, and unknown strings are omitted. The UI uses the same
dashed-amber treatment as assumed-English: list badge **Pricing not
confirmed**; detail sheet **Pricing (not confirmed)** with a hint.
Unknown-pricing orgs stay visible when every price filter is on, and
drop out when a specific tier is selected. The 49 rows that actually
store Low-cost are unchanged.

### Catalog snapshot (`npm run db:export-catalog`, 2026-09-20)

62 curated + 1,564 EOIR/pro bono/IRS EO = 1,626 mappable rows. 160
unmappable skipped (includes the 16 BMF HQ rows with no pin). Checked
in `src/data/services-expansion.json`:

- Refugee Development Center (Lansing): `irs-eo-263936253`.
- Refugee Dream Center (Providence): `irs-eo-473515841`.
- Arizona Refugee Center (`irs-eo-932224570`): no `pricing` field.
- 93 mappable `irs-eo-*` rows omit `pricing`; 49 stored Low-cost
  labels remain.


