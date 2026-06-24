"use client";

/**
 * Loop B (Buyer side) — LIVE quotations + atomic deal acceptance + stepper.
 *
 * - Lists the buyer's own RFQs (live from `public.rfqs`).
 * - For a selected RFQ, loads competing quotations joined to the supplier.
 * - "Accept Quote" invokes the `accept_deal` SECURITY DEFINER RPC, which
 *   atomically creates the Deal (Req 12).
 * - Renders the realtime-bound Deal Timeline Stepper for each contracted deal
 *   (Req 13). Deal status changes propagate live via the `deals` channel.
 */
import { useEffect, useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { createClient, SUPABASE_CONFIGURED } from "@/lib/supabase/client";
import {
  acceptDeal,
  fetchBuyerRfqs,
  fetchDeals,
  fetchQuotationsForRfq,
} from "@/lib/supabase/queries";
import { useRealtimeQuery } from "@/lib/supabase/useRealtime";
import type {
  Deal,
  QuotationWithSupplier,
  Rfq,
} from "@/lib/supabase/database.types";
import { Badge, Button, Panel, PanelHeader } from "../ui";
import { DealStepper } from "@/components/shared/DealStepper";

export function LiveDealsSection({ buyerId }: { buyerId: string | null }) {
  const { data: rfqs, loading: rfqsLoading } = useRealtimeQuery<Rfq[]>(
    "rfqs",
    (db) => fetchBuyerRfqs(db, buyerId ?? "00000000-0000-0000-0000-000000000000"),
    [],
    [buyerId]
  );
  const { data: deals, refresh: refreshDeals } = useRealtimeQuery<Deal[]>(
    "deals",
    fetchDeals,
    []
  );

  const [selectedRfq, setSelectedRfq] = useState<string>("");
  const [quotes, setQuotes] = useState<QuotationWithSupplier[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Default the selected RFQ to the first available one.
  useEffect(() => {
    if (!selectedRfq && rfqs.length > 0) setSelectedRfq(rfqs[0].id);
  }, [rfqs, selectedRfq]);

  const loadQuotes = async (rfqId: string) => {
    if (!SUPABASE_CONFIGURED || !rfqId) return;
    setQuotesLoading(true);
    const db = createClient();
    const res = await fetchQuotationsForRfq(db, rfqId);
    setQuotes(res.data ?? []);
    setQuotesLoading(false);
  };

  useEffect(() => {
    void loadQuotes(selectedRfq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRfq]);

  const accept = async (quoteId: string) => {
    if (!SUPABASE_CONFIGURED) return;
    setAcceptingId(quoteId);
    setActionError(null);
    const db = createClient();
    const res = await acceptDeal(db, quoteId);
    setAcceptingId(null);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    refreshDeals();
  };

  const acceptedQuoteIds = new Set(deals.map((d) => d.quote_id));

  if (!SUPABASE_CONFIGURED) {
    return (
      <Panel>
        <PanelHeader title="Live Deals & Quotations" description="Real-time pipeline" />
        <div className="p-10 text-center text-sm text-navy-500">
          Connect Supabase to compare live quotations and execute deals.
        </div>
      </Panel>
    );
  }

  const activeRfq = rfqs.find((r) => r.id === selectedRfq);

  return (
    <div className="space-y-5">
      <Panel className="p-4">
        <label htmlFor="live-rfq-pick" className="mb-1.5 block text-sm font-medium text-navy-800">
          Compare live offers by RFQ
        </label>
        {rfqsLoading && rfqs.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-navy-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading your requests…
          </div>
        ) : rfqs.length === 0 ? (
          <p className="text-sm text-navy-400">You have no live RFQs yet. Create one to receive quotations.</p>
        ) : (
          <select
            id="live-rfq-pick"
            value={selectedRfq}
            onChange={(e) => setSelectedRfq(e.target.value)}
            className="w-full cursor-pointer rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-400 sm:max-w-md"
          >
            {rfqs.map((r) => (
              <option key={r.id} value={r.id}>{r.product_title}</option>
            ))}
          </select>
        )}
      </Panel>

      {activeRfq && (
        <Panel>
          <PanelHeader
            title={`Live Offers — ${activeRfq.product_title}`}
            description={`Target budget $${activeRfq.target_budget ?? "—"} · ${(activeRfq.quantity ?? 0).toLocaleString()} units`}
            action={
              <Button variant="secondary" size="sm" onClick={() => loadQuotes(selectedRfq)} disabled={quotesLoading}>
                <RefreshCw className={`h-4 w-4 ${quotesLoading ? "animate-spin" : ""}`} aria-hidden="true" />
                Refresh
              </Button>
            }
          />
          {actionError && (
            <p role="alert" className="mx-5 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{actionError}</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-navy-100 bg-navy-50 text-xs uppercase tracking-wide text-navy-500">
                  <th className="px-5 py-3 font-semibold">Supplier</th>
                  <th className="px-5 py-3 font-semibold">Offered Price</th>
                  <th className="px-5 py-3 font-semibold">Lead Time</th>
                  <th className="px-5 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {quotes.map((q) => {
                  const accepted = acceptedQuoteIds.has(q.id);
                  return (
                    <tr key={q.id} className="hover:bg-navy-50/60">
                      <td className="px-5 py-3">
                        <div className="font-semibold text-navy-900">
                          {q.profiles?.company_name || q.profiles?.full_name || "Supplier"}
                        </div>
                      </td>
                      <td className="px-5 py-3 font-semibold text-accent-600">${(q.offered_price ?? 0).toLocaleString()}</td>
                      <td className="px-5 py-3 text-navy-700">{q.dynamic_lead_time ? `${q.dynamic_lead_time} days` : "—"}</td>
                      <td className="px-5 py-3 text-right">
                        {accepted ? (
                          <Badge tone="success">Accepted</Badge>
                        ) : (
                          <Button size="sm" variant="success" disabled={acceptingId === q.id} onClick={() => accept(q.id)}>
                            {acceptingId === q.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                            Accept Quote
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!quotesLoading && quotes.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-10 text-center text-navy-400">No quotations yet for this RFQ.</td></tr>
                )}
                {quotesLoading && (
                  <tr><td colSpan={4} className="px-5 py-10 text-center text-navy-400">Loading offers…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Contracted deals with the realtime-bound stepper. */}
      <Panel>
        <PanelHeader title="Active Deals" description="Live contract status" />
        <div className="space-y-5 p-5">
          {deals.length === 0 ? (
            <p className="py-6 text-center text-sm text-navy-400">No contracted deals yet. Accept a quotation to execute a deal.</p>
          ) : (
            deals.map((d) => (
              <div key={d.id} className="rounded-xl border border-navy-100 bg-navy-950 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">Deal {d.id.slice(0, 8)}</span>
                  <span className="text-sm font-bold text-accent-500">${(d.gross_valuation ?? 0).toLocaleString()}</span>
                </div>
                <DealStepper status={d.status} />
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
