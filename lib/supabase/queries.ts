/**
 * Centralized, fully-typed data-access layer over the Supabase client.
 *
 * Every dashboard reads/writes the relational backend through these helpers
 * rather than touching the raw client inline. This keeps RLS-aware queries,
 * relational joins, and mutation payloads in one place — no `any`, no mock
 * arrays. All functions accept a typed `SupabaseClient<Database>` so they work
 * from both Browser (client.ts) and Server (server.ts) contexts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  Deal,
  Product,
  ProductWithSupplier,
  Profile,
  Quotation,
  QuotationWithSupplier,
  Rfq,
  VerificationStatus,
  Warehouse,
  WarehouseWithHost,
} from "./database.types";

export type DB = SupabaseClient<Database>;

/** Uniform result envelope so callers can branch on data | error without throws. */
export interface Result<T> {
  data: T | null;
  error: string | null;
}

function ok<T>(data: T): Result<T> {
  return { data, error: null };
}
function fail<T>(error: string): Result<T> {
  return { data: null, error };
}

// ===========================================================================
//  Loop A — Discovery feeds (APPROVED-only, enforced by RLS + explicit joins)
// ===========================================================================

/**
 * Approved suppliers for the public Home Page and Buyer discovery feed.
 * RLS already hides non-APPROVED profiles from anon/buyer sessions; the
 * explicit filters make intent clear and keep results correct for admins too.
 */
export async function fetchApprovedSuppliers(db: DB): Promise<Result<Profile[]>> {
  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("role", "SUPPLIER")
    .eq("status", "APPROVED")
    .order("created_at", { ascending: false });
  return error ? fail(error.message) : ok(data ?? []);
}

/** Approved products joined to their owning (approved) supplier profile. */
export async function fetchApprovedProducts(
  db: DB
): Promise<Result<ProductWithSupplier[]>> {
  const { data, error } = await db
    .from("products")
    .select("*, profiles!products_supplier_id_fkey(id, full_name, company_name, status)")
    .eq("profiles.status", "APPROVED")
    .order("created_at", { ascending: false });
  return error ? fail(error.message) : ok((data as unknown as ProductWithSupplier[]) ?? []);
}

/** Approved warehouses joined to their owning (approved) host profile. */
export async function fetchApprovedWarehouses(
  db: DB
): Promise<Result<WarehouseWithHost[]>> {
  const { data, error } = await db
    .from("warehouses")
    .select("*, profiles!warehouses_host_id_fkey(id, full_name, company_name, status)")
    .eq("profiles.status", "APPROVED")
    .order("created_at", { ascending: false });
  return error ? fail(error.message) : ok((data as unknown as WarehouseWithHost[]) ?? []);
}

// ===========================================================================
//  Loop A — Admin approval funnel
// ===========================================================================

/** All profiles awaiting review, oldest first (Req 8.1). */
export async function fetchPendingProfiles(db: DB): Promise<Result<Profile[]>> {
  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("status", "PENDING")
    .order("created_at", { ascending: true });
  return error ? fail(error.message) : ok(data ?? []);
}

/**
 * Transition a profile's verification status. The `.eq("status","PENDING")`
 * guard makes the update a no-op when the row was already processed (Req 8.7);
 * callers detect that case via an empty returned array.
 */
export async function setProfileStatus(
  db: DB,
  profileId: string,
  status: Exclude<VerificationStatus, "PENDING">
): Promise<Result<Profile>> {
  const { data, error } = await db
    .from("profiles")
    .update({ status })
    .eq("id", profileId)
    .eq("status", "PENDING")
    .select()
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Profile already processed or not found.");
  return ok(data);
}

// ===========================================================================
//  Loop A — Commercial account asset registration
// ===========================================================================

export async function insertWarehouse(
  db: DB,
  payload: {
    host_id: string;
    title: string;
    city: string | null;
    total_area_m2: number | null;
    available_area_m2: number | null;
    price_per_m2_monthly: number | null;
  }
): Promise<Result<Warehouse>> {
  const { data, error } = await db.from("warehouses").insert(payload).select().single();
  return error ? fail(error.message) : ok(data);
}

export async function upsertDriverMetadata(
  db: DB,
  payload: {
    id: string;
    license_number: string | null;
    vehicle: Database["public"]["Enums"]["vehicle_type"] | null;
    max_weight_capacity_kg: number | null;
  }
): Promise<Result<null>> {
  const { error } = await db
    .from("drivers_metadata")
    .upsert({ ...payload, created_at: new Date().toISOString() });
  return error ? fail(error.message) : ok(null);
}

export async function insertProduct(
  db: DB,
  payload: {
    supplier_id: string;
    title: string;
    description: string | null;
    price_range: string | null;
    moq: number | null;
    lead_time: string | null;
    images?: string[];
  }
): Promise<Result<Product>> {
  const { data, error } = await db.from("products").insert(payload).select().single();
  return error ? fail(error.message) : ok(data);
}

// ===========================================================================
//  Loop B — RFQ → Quotation → Deal pipeline
// ===========================================================================

/** Buyer creates a sourcing request (Req 10). */
export async function insertRfq(
  db: DB,
  payload: {
    buyer_id: string;
    product_title: string;
    category: string | null;
    specifications: string | null;
    target_budget: string | null;
    quantity: number | null;
  }
): Promise<Result<Rfq>> {
  const { data, error } = await db.from("rfqs").insert(payload).select().single();
  return error ? fail(error.message) : ok(data);
}

/** Count of all RFQs submitted by a specific buyer (head-only, exact count). */
export async function countBuyerRfqs(
  db: DB,
  buyerId: string
): Promise<Result<number>> {
  const { count, error } = await db
    .from("rfqs")
    .select("*", { count: "exact", head: true })
    .eq("buyer_id", buyerId);
  return error ? fail(error.message) : ok(count ?? 0);
}

/** Count of active (non-cancelled, non-completed) deals for a buyer. */
export async function countBuyerActiveDeals(
  db: DB,
  buyerId: string
): Promise<Result<number>> {
  const { count, error } = await db
    .from("deals")
    .select("*", { count: "exact", head: true })
    .eq("buyer_id", buyerId)
    .not("status", "in", "(COMPLETED,CANCELLED)");
  return error ? fail(error.message) : ok(count ?? 0);
}

/** Count of OPEN RFQs for a buyer (awaiting quotations). */
export async function countBuyerOpenRfqs(
  db: DB,
  buyerId: string
): Promise<Result<number>> {
  const { count, error } = await db
    .from("rfqs")
    .select("*", { count: "exact", head: true })
    .eq("buyer_id", buyerId)
    .eq("status", "OPEN");
  return error ? fail(error.message) : ok(count ?? 0);
}

/** A buyer's own RFQs, newest first. */
export async function fetchBuyerRfqs(db: DB, buyerId: string): Promise<Result<Rfq[]>> {
  const { data, error } = await db
    .from("rfqs")
    .select("*")
    .eq("buyer_id", buyerId)
    .order("created_at", { ascending: false });
  return error ? fail(error.message) : ok(data ?? []);
}

/** The active RFQ pipeline a supplier can quote against (Req 11.1). */
export async function fetchOpenRfqs(db: DB): Promise<Result<Rfq[]>> {
  const { data, error } = await db
    .from("rfqs")
    .select("*")
    .order("created_at", { ascending: false });
  return error ? fail(error.message) : ok(data ?? []);
}

/** Supplier submits an offer against an RFQ (Req 11.2). */
export async function insertQuotation(
  db: DB,
  payload: {
    rfq_id: string;
    supplier_id: string;
    offered_price: number;
    dynamic_lead_time: string;
    invoice_url: string | null;
  }
): Promise<Result<Quotation>> {
  const { data, error } = await db.from("quotations").insert(payload).select().single();
  return error ? fail(error.message) : ok(data);
}

/** Quotations for an RFQ, joined to the offering supplier. */
export async function fetchQuotationsForRfq(
  db: DB,
  rfqId: string
): Promise<Result<QuotationWithSupplier[]>> {
  const { data, error } = await db
    .from("quotations")
    .select("*, profiles!quotations_supplier_id_fkey(id, full_name, company_name)")
    .eq("rfq_id", rfqId)
    .order("offered_price", { ascending: true });
  return error ? fail(error.message) : ok((data as unknown as QuotationWithSupplier[]) ?? []);
}

/** Accept a quotation atomically via the SECURITY DEFINER RPC (Req 12). */
export async function acceptDeal(db: DB, quoteId: string): Promise<Result<Deal>> {
  const { data, error } = await db.rpc("accept_deal", { p_quote_id: quoteId });
  return error ? fail(error.message) : ok(data as Deal);
}

/** Deals visible to the current user (buyer/supplier/admin per RLS). */
export async function fetchDeals(db: DB): Promise<Result<Deal[]>> {
  const { data, error } = await db
    .from("deals")
    .select("*")
    .order("created_at", { ascending: false });
  return error ? fail(error.message) : ok(data ?? []);
}

/** Advance / set a deal's lifecycle status (Req 13 stepper source). */
export async function setDealStatus(
  db: DB,
  dealId: string,
  status: Database["public"]["Enums"]["deal_status"]
): Promise<Result<Deal>> {
  const { data, error } = await db
    .from("deals")
    .update({ status })
    .eq("id", dealId)
    .select()
    .single();
  return error ? fail(error.message) : ok(data);
}
