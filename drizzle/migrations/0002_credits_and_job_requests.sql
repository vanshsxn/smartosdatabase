CREATE TABLE public.tenant_credits (
  tenant_id text PRIMARY KEY,
  balance numeric NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tenant_credits TO authenticated;
GRANT ALL ON public.tenant_credits TO service_role;
ALTER TABLE public.tenant_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_credits_read ON public.tenant_credits FOR SELECT TO authenticated
USING (public.is_admin() OR tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()));

INSERT INTO public.tenant_credits (tenant_id) SELECT DISTINCT tenant_id FROM public.profiles ON CONFLICT DO NOTHING;

CREATE TABLE public.job_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  email text,
  name text NOT NULL,
  type text NOT NULL,
  priority text NOT NULL DEFAULT 'MEDIUM',
  cores int NOT NULL,
  memory_mb int NOT NULL,
  estimated_ms int NOT NULL,
  estimated_credits numeric NOT NULL,
  input text,
  status text NOT NULL DEFAULT 'PENDING',
  engine_job_id bigint,
  output text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
GRANT SELECT ON public.job_requests TO authenticated;
GRANT ALL ON public.job_requests TO service_role;
ALTER TABLE public.job_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_requests_read ON public.job_requests FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.is_admin());
CREATE INDEX job_requests_status_idx ON public.job_requests(status, created_at DESC);

ALTER TABLE public.github_deployments ADD COLUMN IF NOT EXISTS request_id uuid;