"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Loader2, Ship } from "lucide-react";
import { createClient, SUPABASE_CONFIGURED } from "@/lib/supabase/client";
import { Button } from "./ui";

/**
 * Importer (Buyer) corporate onboarding.
 *
 * Renders a focused company profile form and performs a live UPSERT against
 * `public.profiles` for the signed-in user (role BUYER, status APPROVED). On
 * success it routes to the buyer command center at `/importer`.
 *
 * Brand tokens: deep dark backdrop (#0F172A) framing, accent orange (#F97316)
 * for the primary action and key emphasis.
 */
type FormState = {
  fullName: string;
  companyName: string;
  phone: string;
  importLicense: string;
  sourceCountry: string;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

const initial: FormState = {
  fullName: "",
  companyName: "",
  phone: "",
  importLicense: "",
  sourceCountry: "",
};

export function RegistrationWizard() {
  const router = useRouter();
  const [data, setData] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState<boolean>(SUPABASE_CONFIGURED);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setData((prev) => ({ ...prev, [key]: value }));

  // Prefill from the signed-in user's existing profile (if any).
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    const db = createClient();
    let active = true;

    (async () => {
      const { data: auth } = await db.auth.getUser();
      if (!auth.user) {
        if (active) setHydrating(false);
        return;
      }
      const { data: profile } = await db
        .from("profiles")
        .select("full_name, company_name, phone_number, import_license_number, country_source")
        .eq("id", auth.user.id)
        .maybeSingle();

      if (!active) return;
      if (profile) {
        setData({
          fullName: profile.full_name ?? "",
          companyName: profile.company_name ?? "",
          phone: profile.phone_number ?? "",
          importLicense: profile.import_license_number ?? "",
          sourceCountry: profile.country_source ?? "",
        });
      }
      setHydrating(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!data.fullName.trim()) e.fullName = "Required";
    if (!data.companyName.trim()) e.companyName = "Required";
    if (!data.phone.trim()) e.phone = "Required";
    if (!data.sourceCountry.trim()) e.sourceCountry = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitError(null);

    if (!SUPABASE_CONFIGURED) {
      router.push("/importer");
      return;
    }

    setSubmitting(true);
    const db = createClient();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) {
      setSubmitError("You must be signed in to complete onboarding.");
      setSubmitting(false);
      return;
    }

    const { error } = await db.from("profiles").upsert(
      {
        id: auth.user.id,
        full_name: data.fullName.trim(),
        company_name: data.companyName.trim(),
        phone_number: data.phone.trim(),
        import_license_number: data.importLicense.trim() || null,
        country_source: data.sourceCountry.trim(),
        role: "BUYER",
        status: "APPROVED",
      },
      { onConflict: "id" }
    );

    if (error) {
      setSubmitError(error.message);
      setSubmitting(false);
      return;
    }

    router.push("/importer");
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-500 text-white">
          <Ship className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-lg font-bold text-navy-900">Importer Onboarding</p>
          <p className="text-sm text-navy-500">Complete your corporate buyer profile</p>
        </div>
      </div>

      <form
        onSubmit={submit}
        className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm"
        noValidate
      >
        <div className="mb-5 flex items-center gap-3 rounded-xl bg-navy-950 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500/20 text-accent-400">
            <Building2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="text-sm font-medium text-navy-100">
            Verified buyer accounts unlock live sourcing, RFQs and supplier quotations.
          </p>
        </div>

        {hydrating ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-navy-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading your profile…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Full Name" error={errors.fullName} required>
                <input
                  value={data.fullName}
                  onChange={(e) => set("fullName", e.target.value)}
                  className={inputClass(!!errors.fullName)}
                  placeholder="e.g. Yassine El Amrani"
                />
              </Field>
              <Field label="Company Name" error={errors.companyName} required>
                <input
                  value={data.companyName}
                  onChange={(e) => set("companyName", e.target.value)}
                  className={inputClass(!!errors.companyName)}
                  placeholder="e.g. Amrani Import Co."
                />
              </Field>
              <Field label="Phone Number" error={errors.phone} required>
                <input
                  type="tel"
                  value={data.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  className={inputClass(!!errors.phone)}
                  placeholder="+212 6xx xxx xxx"
                />
              </Field>
              <Field label="Source Country" error={errors.sourceCountry} required>
                <input
                  value={data.sourceCountry}
                  onChange={(e) => set("sourceCountry", e.target.value)}
                  className={inputClass(!!errors.sourceCountry)}
                  placeholder="e.g. China"
                />
              </Field>
            </div>
            <Field label="Import License Number (optional)">
              <input
                value={data.importLicense}
                onChange={(e) => set("importLicense", e.target.value)}
                className={inputClass(false)}
                placeholder="Customs / trade license reference"
              />
            </Field>

            {submitError && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
                {submitError}
              </p>
            )}

            <div className="flex justify-end border-t border-navy-100 pt-5">
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-4 w-4" aria-hidden="true" />
                )}
                {submitting ? "Saving…" : "Save & Enter Command Center"}
              </Button>
            </div>
          </div>
        )}
      </form>
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
