-- AiroLink POS — security hardening found during the Phase 1–3 recovery audit.
-- Additive; run after 0004_phase3_pos_sales.sql.
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default (and Supabase also
-- grants it to `anon`). The authorization helpers below are only ever needed by signed-in
-- users (RLS policies and RPCs run as `authenticated`). Leaving them callable by `anon`
-- would let an unauthenticated caller probe an organization's subscription state with
-- is_org_entitled(<uuid>). They return nothing useful without auth.uid(), so this is
-- defense in depth, not a fix for an exploitable hole.
revoke all on function role_in(uuid), can(uuid, app_role[]), can_access_branch(uuid), branch_visible(uuid, uuid), is_org_entitled(uuid) from public, anon;
grant execute on function role_in(uuid), can(uuid, app_role[]), can_access_branch(uuid), branch_visible(uuid, uuid), is_org_entitled(uuid) to authenticated;
