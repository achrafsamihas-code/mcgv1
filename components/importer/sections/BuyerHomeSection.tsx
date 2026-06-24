"use client";

/**
 * Importer Command Center — LIVE home section.
 *
 * - Live aggregate stats via head-only exact-count queries (total RFQs, open
 *   RFQs, active deals) scoped to the signed-in buyer.
 * - RFQ creation form performing a live INSERT into `public.rfqs`.
 * - Realtime RFQs feed (buyer_id = auth.uid()) that updates instantly via a
 *   `postgres_changes` subscription — no refresh required.
 *
 * Brand tokens: deep dark cards (#0F172A) with accent orange (#F97316) metrics.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Boxes,
  FileStack,
  Handshake,
  Loader2,
  Plus,
  Send,
} from "lucide-react";
import { createClient, SUPABASE_CONFIGURED } from "@/lib/supabase/client";
import {
  countBuyerActiveDeals,
  countBuyerOpenRfqs,
  countBuyerRfqs,
  fetchBuyerRfqs,
  insertRfq,
} from "@/lib/supabase/queries";
import type { Rfq, RfqStatus } from "@/lib/supabase/database.types";
import { Badge, Button, Panel, PanelHeader } from "../ui";

type Stats = { totalRfqs: number; openRfqs: number; activeDeals: number };

type RfqForm = {
  productTitle: string;
  category: string;
  specifications: string;
  targetBudget: string;
  quantity: string;
};

type RfqFormErrors = Partial<Record<keyof RfqForm, string>>;

const emptyForm: RfqForm = {
  productTitle: "",
  category: "",
  specifications: "",
  targetBudget: "",
  quantity: "",
};

const statusTone: Record<RfqStatus, Parameters<typeof Badge>[0]["tone"]> = {
  OPEN: "accent",
  QUOTED: "info",
  CLOSED: "neutral",
};

export function BuyerHomeSection({ buyerId }: { buyerId: string | null }) {
  const [stats, setStats] = useState<Stats>({ totalRfqs: 0, openRfqs: 0, activeDeals: 0 });
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [loading, setLoading] = useState<boolean>(SUPABASE_CONFIGURED);
  const [feedError, setFeedError] = useState<string | null>(null);

  const [form, setForm] = useState<RfqForm>(emptyForm);
  const [errors, setErrors] = useState<RfqFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const dbRef = useRef(SUPABASE_CONFIGURED ? createClient() : null);

  const refresh = useCallback(async () => {
    const db = dbRef.current;
    if (!db || !buyerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [feed, total, open, deals] = await Promise.all([
      fetchBuyerRfqs(db, buyerId),
      countBuyerRfqs(db, buyerId),
      countBuyerOpenRfqs(db, buyerId),
      countBuyerActiveDeals(db, buyerId),
    ]);

    if (feed.error) setFeedError(feed.error);
    else {
      setFeedError(null);
      setRfqs(feed.data ?? []);
    }
    setStats({
      totalRfqs: total.data ?? 0,
      openRfqs: open.data ?? 0,
      activeDeals: deals.data ?? 0,
    });
    setLoading(false);
  }, [buyerId]);

  // Initial load + realtime subscription on the buyer's RFQs.
  useEffect(() => {
    const db = dbRef.current;
    if (!db || !buyerId) {
      setLoading(false);
      return;
    }

    void refresh();

    const channel = db
      .channel(`rfqs:buyer:${buyerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rfqs", filter: `buyer_id=eq.${buyerId}` },
        () => {
          void refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deals", filter: `buyer_id=eq.${buyerId}` },
        () => {
          void refresh();
        }
      )
      .subscribe();

    return () => {
      void db.removeChannel(channel);
    };
  }, [buyerId, refresh]);

  const set = <K extends keyof RfqForm>(key: K, value: RfqForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const validate = (): boolean => {
    const e: RfqFormErrors = {};
    if (!form.productTitle.trim()) e.productTitle = "Product title required";
    if (!form.specifications.trim()) e.specifications = "Specifications required";
    if (!form.targetBudget.trim()) e.targetBudget = "Target budget required";
    const qty = Number(form.quantity);
    if (!form.quantity || !Number.isInteger(qty) || qty < 1)
      e.quantity = "Whole number ≥ 1";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitError(null);

    const db = dbRef.current;
    if (!db || !buyerId) {
      setSubmitError("You must be signed in to submit a request.");
      return;
    }

    setSubmitting(true);
    const res = await insertRfq(db, {
      buyer_id: buyerId,
      product_title: form.productTitle.trim(),
      category: form.category.trim() || null,
      specifications: form.specifications.trim(),
      target_budget: form.targetBudget.trim(),
      quantity: Number(form.quantity),
    });
    setSubmitting(false);

    if (res.error) {
      setSubmitError(res.error);
      return;
    }
    // Realtime will reconcile, but reset the form immediately for snappy UX.
    setForm(emptyForm);
    setErrors({});
  };

  if (!SUPABASE_CONFIGURED) {
    return (
      <Panel>
        <PanelHeader title="Importer Command Center" description="Live sourcing pipeline" />
        <div className="p-10 text-center text-sm text-navy-500">
          Connect Supabase (set the environment variables) to load your live
          RFQ pipeline and metrics.
        </div>
      </Panel>
    );
  }

  if (!buyerId) {
    return (
      <Panel>
        <PanelHeader title="Importer Command Center" description="Live sourcing pipeline" />
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-navy-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Resolving your session…
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      {/* Live aggregate stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total RFQs Submitted" value={stats.totalRfqs} icon={<FileStack className="h-5 w-5" />} accent loading={loading} />
        <StatCard label="Open RFQs" value={stats.openRfqs} icon={<Boxes className="h-5 w-5" />} loading={loading} />
        <StatCard label="Active Deals" value={stats.activeDeals} icon={<Handshake className="h-5 w-5" />} loading={loading} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_1fr]">
        {/* RFQ creation wizard */}
        <Panel>
          <PanelHeader title="New Sourcing Request" description="Post an RFQ to the supplier network" />
          <form onSubmit={submit} className="space-y-4 p-5" noValidate>
            <Field label="Product Title" error={errors.productTitle} required>
              <input value={form.productTitle} onChange={(e) => set("productTitle", e.target.value)} className={inputClass(!!errors.productTitle)} placeholder="e.g. OEM Brake Pad Sets" />
            </Field>
            <Field label="Category">
              <input value={form.category} onChange={(e) => set("category", e.target.value)} className={inputClass(false)} placeholder="e.g. Cars & Vehicles" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Target Budget" error={errors.targetBudget} required>
                <input value={form.targetBudget} onChange={(e) => set("targetBudget", e.target.value)} className={inputClass(!!errors.targetBudget)} placeholder="$11,000" />
              </Field>
              <Field label="Quantity" error={errors.quantity} required>
                <input type="number" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} className={inputClass(!!errors.quantity)} placeholder="1200" />
              </Field>
            </div>
            <Field label="Specifications" error={errors.specifications} required>
              <textarea rows={3} value={form.specifications} onChange={(e) => set("specifications", e.target.value)} className={inputClass(!!errors.specifications)} placeholder="Materials, tolerances, certifications, packaging…" />
            </Field>

            {submitError && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{submitError}</p>
            )}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              {submitting ? "Submitting…" : "Submit RFQ"}
            </Button>
          </form>
        </Panel>

        {/* Realtime RFQ feed */}
        <Panel>
          <PanelHeader
            title="My RFQs"
            description="Live feed — updates instantly as requests change"
          />
          {feedError && (
            <p role="alert" className="mx-5 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
              {feedError}
            </p>
          )}
          {loading && rfqs.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-12 text-navy-400">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading your RFQs…
            </div>
          ) : rfqs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-12 text-center text-navy-400">
              <Send className="h-8 w-8" aria-hidden="true" />
              <p className="text-sm font-medium">No RFQs yet. Submit your first sourcing request.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-navy-100 bg-navy-50 text-xs uppercase tracking-wide text-navy-500">
                    <th className="px-5 py-3 font-semibold">Request</th>
                    <th className="px-5 py-3 font-semibold">Category</th>
                    <th className="px-5 py-3 font-semibold">Quantity</th>
                    <th className="px-5 py-3 font-semibold">Budget</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {rfqs.map((r) => (
                    <tr key={r.id} className="hover:bg-navy-50/60">
                      <td className="px-5 py-3">
                        <div className="font-semibold text-navy-900">{r.product_title}</div>
                        <div className="text-xs text-navy-500">{new Date(r.created_at).toLocaleString()}</div>
                      </td>
                      <td className="px-5 py-3 text-navy-700">{r.category ?? "—"}</td>
                      <td className="px-5 py-3 text-navy-700">{(r.quantity ?? 0).toLocaleString()}</td>
                      <td className="px-5 py-3 font-medium text-navy-900">{r.target_budget ?? "—"}</td>
                      <td className="px-5 py-3"><Badge tone={statusTone[r.status]}>{r.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent,
  loading,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: boolean;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-navy-800 bg-navy-950 p-5 shadow-sm">
      <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent ? "bg-accent-500 text-white" : "bg-navy-800 text-accent-400"}`}>
        {icon}
      </span>
      <p className={`mt-3 text-3xl font-bold tracking-tight ${accent ? "text-accent-500" : "text-white"}`}>
        {loading ? <Loader2 className="h-6 w-6 animate-spin text-navy-500" aria-hidden="true" /> : value.toLocaleString()}
      </p>
      <p className="text-xs font-medium uppercase tracking-wide text-navy-400">{label}</p>
    </div>
  );
}

function inputClass(hasError: boolean): string {
  return `w-full rounded-lg border px-3 py-2 text-sm focus:border-accent-400 ${
    hasError ? "border-red-300" : "border-navy-200"
  }`;
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-navy-800">
        {label} {required && <span className="text-accent-500">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
