CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant-a',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_own" ON public.profiles FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.alert_rules (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  cpu_threshold NUMERIC NOT NULL DEFAULT 85,
  memory_threshold NUMERIC NOT NULL DEFAULT 85,
  credit_threshold NUMERIC NOT NULL DEFAULT 150,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.alert_rules TO authenticated;
GRANT ALL ON public.alert_rules TO service_role;
ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alert_rules_own" ON public.alert_rules FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id TEXT,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'WARN',
  message TEXT NOT NULL,
  value NUMERIC,
  threshold NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX alert_events_user_created_idx ON public.alert_events (user_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.alert_events TO authenticated;
GRANT ALL ON public.alert_events TO service_role;
ALTER TABLE public.alert_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alert_events_own" ON public.alert_events FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(COALESCE(NEW.email, 'operator'), '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.alert_rules (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();