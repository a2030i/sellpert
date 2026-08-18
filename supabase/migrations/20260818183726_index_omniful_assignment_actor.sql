create index if not exists omniful_channel_assignments_assigned_by_idx
  on public.omniful_channel_assignments (assigned_by)
  where assigned_by is not null;
