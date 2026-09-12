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
