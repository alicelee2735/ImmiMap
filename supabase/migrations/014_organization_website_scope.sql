-- Discovery-pass classification of website_url. Nullable on purpose: existing
-- URLs predate this system and must stay unclassified (null), not guessed as
-- local. Only the website-discovery writer sets 'local' or 'parent'.
--
-- No column default. Postgres fills new columns with null for every current
-- row. A check of `in ('local', 'parent')` still allows null.

alter table organizations
  add column if not exists website_scope text
    check (website_scope in ('local', 'parent'));

comment on column organizations.website_scope is
  'How website_url relates to this listing. local = this office/org''s own site; parent = national/HQ/umbrella site. Null means unclassified, including every URL that predates website discovery. Only the discovery pass writes an explicit value.';
