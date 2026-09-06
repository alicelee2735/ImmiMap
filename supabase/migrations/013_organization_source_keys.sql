-- Extra ingest natural keys for an organization that already has a primary
-- organizations.legacy_id under a different scheme.

create table organization_source_keys (
  legacy_id text primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index organization_source_keys_organization_id_idx
  on organization_source_keys (organization_id);

comment on table organization_source_keys is
  'Additional ingest natural keys besides organizations.legacy_id. Globally unique. Lets one office be reconciled to more than one EOIR list.';

create or replace function organization_source_keys_reject_primary_collision()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from organizations o
    where o.legacy_id = new.legacy_id
  ) then
    raise exception
      'organization_source_keys.legacy_id % collides with organizations.legacy_id',
      new.legacy_id;
  end if;
  return new;
end;
$$;

create trigger organization_source_keys_no_primary_collision
  before insert or update of legacy_id on organization_source_keys
  for each row
  execute function organization_source_keys_reject_primary_collision();

create or replace function organizations_reject_alias_collision()
returns trigger
language plpgsql
as $$
begin
  if new.legacy_id is not null and exists (
    select 1
    from organization_source_keys k
    where k.legacy_id = new.legacy_id
  ) then
    raise exception
      'organizations.legacy_id % collides with organization_source_keys.legacy_id',
      new.legacy_id;
  end if;
  return new;
end;
$$;

create trigger organizations_legacy_id_no_alias_collision
  before insert or update of legacy_id on organizations
  for each row
  execute function organizations_reject_alias_collision();

alter table organization_source_keys enable row level security;
alter table organization_source_keys force row level security;

revoke insert, update, delete, truncate, references, trigger
  on table organization_source_keys
  from anon, authenticated;

revoke select on table organization_source_keys from anon, authenticated;
