-- Roles ---------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_roles_read_own ON public.user_roles;
CREATE POLICY user_roles_read_own ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin');
$$;

-- One isolated tenant per account --------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin_user boolean := lower(COALESCE(NEW.email, '')) = 'sxnvansh@mv.com';
  new_tenant text := CASE
    WHEN lower(COALESCE(NEW.email, '')) = 'sxnvansh@mv.com' THEN 'tenant-admin'
    ELSE 'tenant-' || left(replace(NEW.id::text, '-', ''), 10)
  END;
BEGIN
  INSERT INTO public.profiles (id, email, display_name, tenant_id)
  VALUES (NEW.id, NEW.email,
          COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(COALESCE(NEW.email, 'operator'), '@', 1)),
          new_tenant)
  ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

  INSERT INTO public.alert_rules (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN is_admin_user THEN 'admin'::public.app_role ELSE 'user'::public.app_role END)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Backfill existing accounts with isolated tenants
UPDATE public.profiles p
SET tenant_id = CASE
  WHEN lower(COALESCE(p.email, '')) = 'sxnvansh@mv.com' THEN 'tenant-admin'
  ELSE 'tenant-' || left(replace(p.id::text, '-', ''), 10)
END;

INSERT INTO public.user_roles (user_id, role)
SELECT p.id, CASE WHEN lower(COALESCE(p.email, '')) = 'sxnvansh@mv.com'
                  THEN 'admin'::public.app_role ELSE 'user'::public.app_role END
FROM public.profiles p
ON CONFLICT (user_id, role) DO NOTHING;

-- GitHub deployments ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.github_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  repo_full_name text NOT NULL,
  branch text,
  commit_sha text,
  run_id text,
  job_id bigint,
  status text NOT NULL DEFAULT 'BUILDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.github_deployments TO authenticated;
GRANT ALL ON public.github_deployments TO service_role;
ALTER TABLE public.github_deployments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS github_deployments_own ON public.github_deployments;
CREATE POLICY github_deployments_own ON public.github_deployments
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_github_deployments_updated_at ON public.github_deployments;
CREATE TRIGGER update_github_deployments_updated_at
  BEFORE UPDATE ON public.github_deployments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();