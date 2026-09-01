CREATE TABLE public.walkthrough_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  completed boolean NOT NULL DEFAULT true,
  note text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, step_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.walkthrough_progress TO authenticated;
GRANT ALL ON public.walkthrough_progress TO service_role;
ALTER TABLE public.walkthrough_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY walkthrough_progress_own ON public.walkthrough_progress FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.job_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id text,
  job_id text NOT NULL,
  job_name text,
  job_type text,
  state text NOT NULL DEFAULT 'PENDING',
  percent numeric NOT NULL DEFAULT 0,
  cpu_usage numeric,
  memory_mb numeric,
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_progress TO authenticated;
GRANT ALL ON public.job_progress TO service_role;
ALTER TABLE public.job_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_progress_own ON public.job_progress FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX job_progress_user_created_idx ON public.job_progress (user_id, created_at DESC);
CREATE INDEX job_progress_job_idx ON public.job_progress (user_id, job_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_walkthrough_progress_updated_at BEFORE UPDATE ON public.walkthrough_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_job_progress_updated_at BEFORE UPDATE ON public.job_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();