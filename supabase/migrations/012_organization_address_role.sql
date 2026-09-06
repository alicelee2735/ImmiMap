-- Physical vs mailing, as declared on the EOIR pro bono list ("Physical
-- Address:" / "Mailing Address:"). Stored so a later UI can label a PO Box
-- without re-deriving the role from the street. Null when the source did
-- not declare one. Not shown in the public map today.

alter table organizations
  add column if not exists address_role text
    check (address_role in ('physical', 'mailing'));

comment on column organizations.address_role is
  'EOIR-declared address role (physical vs mailing). Null when the source listing did not label one. Not currently surfaced in the public UI.';
