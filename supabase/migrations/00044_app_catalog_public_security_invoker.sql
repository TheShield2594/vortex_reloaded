-- Ensure public catalog view uses querying user's permissions/RLS context.
ALTER VIEW public.app_catalog_public
SET (security_invoker = true);
