-- Trail for website-confirmed languages. Same idea as website_scope: store
-- why a fact is marked confirmed, not just the fact.
--
-- Null means no website-confirmed languages yet (including the 547 rows
-- that stay "English (assumed — not yet confirmed)"). The array never
-- includes English from switcher / hreflang / list detection or weak LEP
-- copy — those are not confirmation.

alter table organizations
  add column if not exists languages_evidence jsonb;

alter table organizations
  drop constraint if exists organizations_languages_evidence_is_array;

alter table organizations
  add constraint organizations_languages_evidence_is_array
  check (languages_evidence is null or jsonb_typeof(languages_evidence) = 'array');

comment on column organizations.languages_evidence is
  'Confirmed-language trail: [{language, sourceUrl, snippet, kind}]. Non-English only. Null means no website-confirmed languages yet. English from switchers, hreflang, lists, or weak LEP copy is not stored.';
