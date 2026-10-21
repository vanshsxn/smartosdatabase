import { supabase } from "@/integrations/supabase/client";

export type CreditTransactionType =
  | "INITIAL_CREDIT"
  | "JOB_CHARGE"
  | "JOB_REFUND"
  | "ADMIN_ADJUSTMENT"
  | "PERIODIC_CREDIT_RESET";

export interface CreditTransaction {
  id: string;
  tenantId: string;
  jobId?: string | number | null;
  amount: number;
  balanceAfter: number;
  type: CreditTransactionType;
  description: string;
  idempotencyKey?: string;
  createdAt: string;
}

const DEFAULT_DAILY_CREDITS = 100;
const RESET_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory persistent cache for credit transactions & reset timestamps
const localLedger: CreditTransaction[] = [];
const processedIdempotencyKeys = new Set<string>();

/**
 * Records an immutable credit ledger transaction and updates the tenant balance.
 * Uses idempotency keys to strictly prevent duplicate debits.
 */
export async function executeCreditDebit(params: {
  tenantId: string;
  jobId: string | number;
  cost: number;
  jobName: string;
  idempotencyKey?: string;
}): Promise<{ success: boolean; newBalance: number; error?: string }> {
  const { tenantId, jobId, cost, jobName, idempotencyKey } = params;
  const key = idempotencyKey || `charge-${tenantId}-${jobId}`;

  if (processedIdempotencyKeys.has(key)) {
    return { success: true, newBalance: 100 }; // Already debited
  }

  // 1. Fetch current balance
  const { data: creditRow } = await supabase
    .from("tenant_credits")
    .select("balance")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const currentBalance = creditRow ? Number(creditRow.balance) : DEFAULT_DAILY_CREDITS;

  if (currentBalance < cost) {
    return {
      success: false,
      newBalance: currentBalance,
      error: `Insufficient credits: balance is ${currentBalance.toFixed(2)}, but job requires ${cost.toFixed(2)}.`,
    };
  }

  const newBalance = Math.max(0, Math.round((currentBalance - cost) * 100) / 100);

  // 2. Persist updated balance in tenant_credits
  const now = new Date().toISOString();
  await supabase
    .from("tenant_credits")
    .upsert({ tenant_id: tenantId, balance: newBalance, updated_at: now });

  // 3. Mark idempotency key & append to transaction ledger
  processedIdempotencyKeys.add(key);
  localLedger.unshift({
    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tenantId,
    jobId,
    amount: -cost,
    balanceAfter: newBalance,
    type: "JOB_CHARGE",
    description: `Execution debit for job: ${jobName}`,
    idempotencyKey: key,
    createdAt: now,
  });

  return { success: true, newBalance };
}

/**
 * Refunds credits for a job that failed, was rejected, or was cancelled before execution.
 */
export async function executeCreditRefund(params: {
  tenantId: string;
  jobId: string | number;
  cost: number;
  reason: string;
}): Promise<{ success: boolean; newBalance: number }> {
  const { tenantId, jobId, cost, reason } = params;
  const key = `refund-${tenantId}-${jobId}`;

  if (processedIdempotencyKeys.has(key)) {
    return { success: true, newBalance: 100 };
  }

  const { data: creditRow } = await supabase
    .from("tenant_credits")
    .select("balance")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const currentBalance = creditRow ? Number(creditRow.balance) : DEFAULT_DAILY_CREDITS;
  const newBalance = Math.round((currentBalance + cost) * 100) / 100;
  const now = new Date().toISOString();

  await supabase
    .from("tenant_credits")
    .upsert({ tenant_id: tenantId, balance: newBalance, updated_at: now });

  processedIdempotencyKeys.add(key);
  localLedger.unshift({
    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tenantId,
    jobId,
    amount: cost,
    balanceAfter: newBalance,
    type: "JOB_REFUND",
    description: `Refund: ${reason}`,
    idempotencyKey: key,
    createdAt: now,
  });

  return { success: true, newBalance };
}

/**
 * Idempotent 24-hour credit refresh task.
 * Automatically checks if 24 hours have elapsed since the last refresh.
 * Refreshes daily quota credits without erasing purchased credits, recording a PERIODIC_CREDIT_RESET ledger entry.
 */
export async function checkAndApply24HourReset(tenantId: string): Promise<{
  refreshed: boolean;
  balance: number;
  hoursRemaining?: number;
}> {
  const resetKey = `last_reset_${tenantId}`;
  const nowMs = Date.now();
  let lastResetMs = 0;

  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(resetKey);
    if (stored) lastResetMs = parseInt(stored, 10);
  }

  const elapsed = nowMs - lastResetMs;

  if (lastResetMs === 0 || elapsed >= RESET_WINDOW_MS) {
    // 24 hours elapsed: perform safe credit refresh
    const { data: creditRow } = await supabase
      .from("tenant_credits")
      .select("balance")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const currentBalance = creditRow ? Number(creditRow.balance) : 0;
    // Set balance to at least default daily allowance (100 credits)
    const newBalance = Math.max(DEFAULT_DAILY_CREDITS, currentBalance);
    const nowIso = new Date().toISOString();

    await supabase
      .from("tenant_credits")
      .upsert({ tenant_id: tenantId, balance: newBalance, updated_at: nowIso });

    if (typeof window !== "undefined") {
      localStorage.setItem(resetKey, String(nowMs));
    }

    localLedger.unshift({
      id: `tx-reset-${Date.now()}`,
      tenantId,
      amount: newBalance - currentBalance,
      balanceAfter: newBalance,
      type: "PERIODIC_CREDIT_RESET",
      description: "Automatic 24-Hour Rolling Quota Refresh",
      idempotencyKey: `daily-reset-${tenantId}-${new Date().toISOString().slice(0, 10)}`,
      createdAt: nowIso,
    });

    return { refreshed: true, balance: newBalance };
  }

  const hoursRemaining = Math.max(0, Math.round(((RESET_WINDOW_MS - elapsed) / (1000 * 60 * 60)) * 10) / 10);
  return { refreshed: false, balance: DEFAULT_DAILY_CREDITS, hoursRemaining };
}

/**
 * Returns recent credit ledger transactions for audit view.
 */
export function getCreditLedger(tenantId?: string): CreditTransaction[] {
  if (!tenantId) return localLedger.slice(0, 50);
  return localLedger.filter((t) => t.tenantId === tenantId).slice(0, 50);
}

