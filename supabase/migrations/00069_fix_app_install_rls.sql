-- Fix server_app_installs RLS: allow members with MANAGE_WEBHOOKS or
-- USE_APPLICATION_COMMANDS to install/uninstall apps, not just server owners.

-- 1. Add INSERT policy for members with app-management permissions
CREATE POLICY "members with app perms can install"
  ON public.server_app_installs FOR INSERT
  WITH CHECK (
    auth.uid() = installed_by
    AND (
      public.is_server_owner(server_id)
      OR public.has_permission(server_id, 4096)    -- MANAGE_WEBHOOKS (1 << 12)
      OR public.has_permission(server_id, 262144)   -- USE_APPLICATION_COMMANDS (1 << 18)
    )
  );

-- 2. Add DELETE policy for members with app-management permissions
CREATE POLICY "members with app perms can uninstall"
  ON public.server_app_installs FOR DELETE
  USING (
    public.is_server_owner(server_id)
    OR public.has_permission(server_id, 4096)    -- MANAGE_WEBHOOKS (1 << 12)
    OR public.has_permission(server_id, 262144)   -- USE_APPLICATION_COMMANDS (1 << 18)
  );
