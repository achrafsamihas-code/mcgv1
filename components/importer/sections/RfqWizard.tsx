"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, ImageIcon, Loader2 } from "lucide-react";
import {
  PRODUCT_CATEGORIES,
  type ProductCategory,
  type SourcingRFQ,
} from "@/lib/importer/types";
import { createClient, SUPABASE_CONFIGURED } from "@/lib/supabase/client";
import { insertRfq } from "@/lib/supabase/queries";
import { Button } from "../ui";
import { Modal } from "@/components/admin/ui/Modal";

type Step = 0 | 1 | 2;
const steps = ["Product & Category", "Quantity & Budget", "Specs & Timeline"];

type FormState = {
  title: string;
  category: ProductCategory;
  quantity: string;
  targetBudget: string;
  specifications: string;
  deliveryTimeline: string;
};

const empty: FormState = {
  title: "",
  category: "Cars & Vehicles",
  quantity: "",
  targetBudget: "",
  specifications: "",
  deliveryTimeline: "",
};

export function RfqWizard({
  open,
  onClose,
  importerId,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  importerId: string;
  onCreate: (rfq: SourcingRFQ) => void;
}) {
  const [step, setStep] = useState<Step>(0);
  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const set = (key: keyof FormState, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const reset = () => {
    setStep(0);
    setForm(empty);
    setErrors({});
    setSubmitError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const validateStep = (s: Step): boolean => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (s === 0 && !form.title.trim()) e.title = "Product title required";
    if (s === 1) {
      if (!form.quantity || Number(form.quantity) <= 0) e.quantity = "Enter a quantity";
      if (!form.targetBudget || Number(form.targetBudget) <= 0) e.targetBudget = "Enter a budget";
    }
    if (s === 2) {
      if (!form.specifications.trim()) e.specifications = "Specifications required";
      if (!form.deliveryTimeline.trim()) e.deliveryTimeline = "Timeline required";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => validateStep(step) && setStep((s) => Math.min(2, s + 1) as Step);
  const back = () => setStep((s) => Math.max(0, s - 1) as Step);

  /**
   * Loop B — create the sourcing request. Performs a live INSERT into
   * `public.rfqs` (buyer_id = signed-in user) and, on success, hands an
   * optimistic record up to the dashboard so the RFQ list updates immediately.
   * On failure the form values and step are retained.
   */
  const submit = async () => {
    if (!validateStep(2)) return;
    setSubmitError(null);

    const optimistic: SourcingRFQ = {
      id: `RFQ-${Math.floor(1000 + Math.random() * 9000)}`,
      importerId,
      title: form.title.trim(),
      category: form.category,
      quantity: Number(form.quantity),
      targetBudget: Number(form.targetBudget),
      specifications: form.specifications.trim(),
      deliveryTimeline: form.deliveryTimeline.trim(),
      attachments: 0,
      status: "New",
      createdAt: new Date().toISOString().slice(0, 10),
      quotationCount: 0,
    };

    if (!SUPABASE_CONFIGURED) {
      onCreate(optimistic);
      close();
      return;
    }

    setSubmitting(true);
    const db = createClient();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) {
      setSubmitError("You must be signed in to submit a sourcing request.");
      setSubmitting(false);
      return;
    }

    const res = await insertRfq(db, {
      buyer_id: auth.user.id,
      product_title: optimistic.title,
      category: optimistic.category,
      specifications: optimistic.specifications,
      target_budget: String(optimistic.targetBudget),
      quantity: optimistic.quantity,
    });

    setSubmitting(false);
    if (res.error || !res.data) {
      setSubmitError(res.error ?? "Failed to create the request.");
      return;
    }
    onCreate({ ...optimistic, id: res.data.id, createdAt: res.data.created_at.slice(0, 10) });
    close();
  };

  return (
    <Modal open={open} onClose={close} title="New Sourcing Request" size="lg">
      <ol className="mb-5 flex items-center">
        {steps.map((label, i) => (
          <li key={label} className="flex flex-1 items-center">
            <div className="flex items-center gap-2">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                i < step ? "bg-emerald-500 text-white" : i === step ? "bg-accent-500 text-white" : "bg-navy-100 text-navy-400"
              }`}>
                {i < step ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}
              </span>
              <span className={`hidden text-xs font-medium sm:block ${i === step ? "text-navy-900" : "text-navy-400"}`}>{label}</span>
            </div>
            {i < steps.length - 1 && <span className={`mx-2 h-0.5 flex-1 ${i < step ? "bg-emerald-500" : "bg-navy-100"}`} />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-4">
          <Field label="Product Title" error={errors.title} required>
            <input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. OEM Brake Pad Sets" className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-400" />
          </Field>
          <Field label="Category" required>
            <select value={form.category} onChange={(e) => set("category", e.target.value)} className="w-full cursor-pointer rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-400">
              {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Desired Quantity" error={errors.quantity} required>
            <input type="number" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-400" />
          </Field>
          <Field label="Target Budget ($)" error={errors.targetBudget} required>
            <input type="number" value={form.targetBudget} onChange={(e) => set("targetBudget", e.target.value)} className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-400" />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Field label="Granular Specifications" error={errors.specifications} required>
            <textarea rows={4} value={form.specifications} onChange={(e) => set("specifications", e.target.value)} placeholder="Materials, tolerances, certifications, packaging…" className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-400" />
          </Field>
          <Field label="Targeted Delivery Timeline" error={errors.deliveryTimeline} required>
            <input value={form.deliveryTimeline} onChange={(e) => set("deliveryTimeline", e.target.value)} placeholder="e.g. Within 45 days" className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-400" />
          </Field>
          <div className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-navy-200 bg-navy-50 py-6 text-sm text-navy-500">
            <ImageIcon className="h-5 w-5" aria-hidden="true" />Drop reference images here
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between border-t border-navy-100 pt-4">
        <Button variant="secondary" onClick={back} disabled={step === 0 || submitting}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back</Button>
        {step < 2 ? (
          <Button onClick={next}>Continue<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
        ) : (
          <Button variant="success" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            {submitting ? "Submitting…" : "Submit RFQ"}
          </Button>
        )}
      </div>
      {submitError && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
          {submitError}
        </p>
      )}
    </Modal>
  );
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
