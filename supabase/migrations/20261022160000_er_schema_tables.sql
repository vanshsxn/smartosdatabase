-- Migration: 20261022160000_er_schema_tables.sql
-- Aligns PostgreSQL Schema with Canonical 3NF ER Diagram:
-- Entities: tenants, profiles, job_requests, tenant_credits, billing_ledger, github_deployments, state_transitions

-- 1. TENANTS TABLE
CREATE TABLE IF NOT EXISTS public.tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'STANDARD',
  credits_limit NUMERIC NOT NULL DEFAULT 500,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tenants TO anon, authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenants_read_all" ON public.tenants FOR SELECT TO anon, authenticated USING (true);

-- Seed Canonical Tenants
INSERT INTO public.tenants (id, name, tier, credits_limit)
VALUES
  ('tenant-admin', 'System Administrator', 'ENTERPRISE', 100000),
  ('tenant-a', 'Engineering Alpha', 'PRO', 1000),
  ('tenant-b', 'Analytics Beta', 'STANDARD', 500),
  ('tenant-c', 'Research Gamma', 'STANDARD', 500)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, tier = EXCLUDED.tier;

-- 2. BILLING LEDGER TABLE (Immutable financial transaction records)
CREATE TABLE IF NOT EXISTS public.billing_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE NOT NULL,
  tenant_id TEXT NOT NULL,
  job_id TEXT,
  action TEXT NOT NULL, -- 'JOB_CHARGE', 'JOB_REFUND', 'PERIODIC_CREDIT_RESET'
  amount NUMERIC(10, 2) NOT NULL,
  balance_after NUMERIC(10, 2) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_ledger_tenant_idx ON public.billing_ledger(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_ledger_idempotency_idx ON public.billing_ledger(idempotency_key);

GRANT SELECT, INSERT ON public.billing_ledger TO anon, authenticated;
GRANT ALL ON public.billing_ledger TO service_role;
ALTER TABLE public.billing_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_ledger_read" ON public.billing_ledger FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "billing_ledger_insert" ON public.billing_ledger FOR INSERT TO anon, authenticated WITH CHECK (true);

-- 3. STATE TRANSITIONS TABLE (OS 5-state lifecycle audit records)
CREATE TABLE IF NOT EXISTS public.state_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id TEXT NOT NULL,
  job_id TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant-a',
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS state_transitions_pid_idx ON public.state_transitions(process_id, transitioned_at DESC);
CREATE INDEX IF NOT EXISTS state_transitions_tenant_idx ON public.state_transitions(tenant_id);

GRANT SELECT, INSERT ON public.state_transitions TO anon, authenticated;
GRANT ALL ON public.state_transitions TO service_role;
ALTER TABLE public.state_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "state_transitions_read" ON public.state_transitions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "state_transitions_insert" ON public.state_transitions FOR INSERT TO anon, authenticated WITH CHECK (true);

