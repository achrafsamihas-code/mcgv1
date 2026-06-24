"use client";

/**
 * Loop B (Supplier side) — LIVE RFQ pipeline + quotation submission.
 *
 * Subscribes to `public.rfqs` in realtime so newly posted buyer requests
 * appear without a refresh, and writes offers straight into
 * `public.quotations`. Validation mirrors the backend constraints
 * (price 0.01–999,999,999.99, lead time 1–365 days). Form values are retained
 * on failure.
 */
import { useState } from "react";
import { FileText, Loader2, Send } from "lucide-react";
import { createClient, SUPABASE_CONFIGURED } from "@/lib/supabase/client";
import { fetchOpenRfqs, insertQuotation } from "@/lib/supabase/queries";
import { useRealtimeQuery } from "@/lib/supabase/useRealtime";
import type { Rfq } from "@/lib/supabase/database.types";
import { Badge, Button, Panel, PanelHeader } from "../ui";
import { Modal } from "@/components/admin/ui/Modal";

type QuoteForm = { offeredPrice: string; leadTimeDays: string };
const emptyQuote: QuoteForm = { offeredPrice: "", leadTimeDays: "" };

export function LivePipelineSection() {
  const { data: rfqs, loading, error } = useRealtimeQuery<Rfq[]>(
    "rfqs",
    fetchOpenRfqs,
    []
  );

  const [target, setTarget] = useState<Rfq | null>(null);
  const [form, setForm] = useState<QuoteForm>(emptyQuote);
  const [errors, setErrors] = useState<Partial<Record<keyof QuoteForm, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sentFor, setSentFor] = useState<Set<string>>(new Set());

  const open = (rfq: Rfq) => {
    setTarget(rfq);
    setForm(emptyQuote);
    setErrors({});
    setSubmitError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;

    const errs: Partial<Record<keyof QuoteForm, string>> = {};
    const price = Number(form.offeredPrice);
    const lead = Number(form.leadTimeDays);
    if (!form.offeredPrice || price < 0.01 || price > 999999999.99)
      errs.offeredPrice = "Enter a price between 0.01 and 999,999,999.99.";
    if (!form.leadTimeDays || !Number.isInteger(lead) || lead < 1 || lead > 365)
      errs.leadTimeDays = "Whole number of days, 1–365.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitError(null);
    if (!SUPABASE_CONFIGURED) {
      setSentFor((prev) => new Set(prev).add(target.id));
      setTarget(null);
      return;
    }

    setSubmitting(true);
    const db = createClient();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) {
      setSubmitError("You must be signed in to send a quotation.");
      setSubmitting(false);
      return;
    }

    const res = await insertQuotation(db, {
      rfq_id: target.id,
      supplier_id: auth.user.id,
      offered_price: price,
      dynamic_lead_time: String(lead),
      invoice_url: null,
    });

    setSubmitting(false);
    if (res.error) {
      setSubmitError(res.error);
      return;
    }
    setSentFor((prev) => new Set(prev).add(target.id));
    setTarget(null);
  };

  if (!SUPABASE_CONFIGURED) {
    return (
      <Panel>
        <PanelHeader title="Live RFQ Pipeline" description="Real-time buyer requests" />
        <div className="p-10 text-center text-sm text-navy-500">
          Connect Supabase to receive live buyer RFQs and submit quotations.
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title="Live RFQ Pipeline"
        description={`${rfqs.length} active ${rfqs.length === 1 ? "request" : "requests"} open for quotation`}
      />

      {error && (
        <p role="alert" className="mx-5 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
          Could not load the pipeline: {error}
        </p>
      )}

      {loading && rfqs.length === 0 ? (
        <div className="flex items-center justify-center gap-2 p-12 text-navy-400">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Loading live pipeline…
        </div>
      ) : rfqs.length === 0 ? (
        <div className="p-12 text-center text-sm text-navy-400">
          No active buyer requests right now. New RFQs appear here instantly.
        </div>
      ) : (
        <ul className="divide-y divide-navy-100">
          {rfqs.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-navy-900">{r.product_title}</span>
                  {sentFor.has(r.id) && <Badge tone="info">Quote sent</Badge>}
                  <span className="text-xs text-navy-400">{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span className="text-navy-600">Qty: <span className="font-semibold text-navy-900">{(r.quantity ?? 0).toLocaleString()}</span></span>
                  <span className="text-navy-600">Target budget: <span className="font-semibold text-accent-600">${r.target_budget ?? "—"}</span></span>
                </div>
                {r.specifications && (
                  <p className="mt-2 rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-600">{r.specifications}</p>
                )}
              </div>
              <div className="shrink-0">
                <Button size="sm" onClick={() => open(r)}>
                  <FileText className="h-4 w-4" aria-hidden="true" />Send Quote
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title={`Quotation — ${target?.product_title ?? ""}`}
        size="md"
      >
        {target && (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="rounded-lg bg-navy-50 px-3 py-2.5 text-sm text-navy-600">
              {(target.quantity ?? 0).toLocaleString()} units · target ${target.target_budget ?? "—"}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-navy-800">
                  Offered Price ($) <span className="text-accent-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.offeredPrice}
                  onChange={(e) => setForm({ ...form, offeredPrice: e.target.value })}
                  className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-400"
                />
                {errors.offeredPrice && <p className="mt-1 text-xs font-medium text-red-600">{errors.offeredPrice}</p>}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-navy-800">
                  Lead Time (days) <span className="text-accent-500">*</span>
                </label>
                <input
                  type="number"
                  value={form.leadTimeDays}
                  onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })}
                  className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-400"
                />
                {errors.leadTimeDays && <p className="mt-1 text-xs font-medium text-red-600">{errors.leadTimeDays}</p>}
              </div>
            </div>
            {submitError && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{submitError}</p>
            )}
            <div className="flex justify-end gap-2 border-t border-navy-100 pt-4">
              <Button type="button" variant="secondary" onClick={() => setTarget(null)} disabled={submitting}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                {submitting ? "Sending…" : "Dispatch Quotation"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </Panel>
  );
}
