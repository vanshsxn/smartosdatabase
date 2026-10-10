CREATE TABLE IF NOT EXISTS public.app_user_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connector_id text NOT NULL,
  connection_key_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, connector_id)
);

ALTER TABLE public.app_user_connections ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_user_connections TO authenticated;

CREATE POLICY app_user_connections_select_own ON public.app_user_connections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY app_user_connections_insert_own ON public.app_user_connections
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY app_user_connections_update_own ON public.app_user_connections
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY app_user_connections_delete_own ON public.app_user_connections
  FOR DELETE TO authenticated USING (auth.uid() = user_id);