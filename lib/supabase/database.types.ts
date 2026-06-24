/**
 * Hand-authored database types that mirror `supabase/schema.sql` exactly.
 *
 * These replace `any` everywhere the Supabase client is used. They are the
 * single TypeScript source of truth for the relational backend and are kept in
 * lock-step with the SQL enums and tables. No generated `Json`/`any` leakage.
 *
 * NOTE: The Row/Insert/Update shapes are declared as `type` aliases (not
 * `interface`) on purpose — Supabase's `GenericTable` constraint requires each
 * shape to satisfy `Record<string, unknown>`, which interfaces do not because
 * they are open to declaration merging.
 */

// --- Enums (mirror the PostgreSQL custom types) ---------------------------
export type PlatformRole =
  | "BUYER"
  | "SUPPLIER"
  | "DRIVER"
  | "WAREHOUSE_HOST"
  | "SUPER_ADMIN";

export type VerificationStatus = "PENDING" | "APPROVED" | "REJECTED";

export type DealStatus =
  | "OPEN"
  | "NEGOTIATION"
  | "CONTRACTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export type VehicleType = "TRUCK" | "VAN" | "CAR" | "MOTORCYCLE";

export type RfqStatus = "OPEN" | "QUOTED" | "CLOSED";

/** Commercial accounts require admin verification before public visibility. */
export const COMMERCIAL_ROLES: PlatformRole[] = [
  "SUPPLIER",
  "DRIVER",
  "WAREHOUSE_HOST",
];

/** Ordered deal stages, used to drive the Timeline_Stepper. */
export const DEAL_STAGES = [
  "OPEN",
  "NEGOTIATION",
  "CONTRACTED",
  "IN_PROGRESS",
  "COMPLETED",
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

// --- Row shapes -----------------------------------------------------------
export type Profile = {
  id: string;
  full_name: string | null;
  company_name: string | null;
  phone_number: string | null;
  role: PlatformRole;
  status: VerificationStatus;
  import_license_number: string | null;
  country_source: string | null;
  created_at: string;
};

export type Product = {
  id: string;
  supplier_id: string;
  title: string;
  description: string | null;
  price_range: string | null;
  moq: number | null;
  lead_time: string | null;
  images: string[];
  created_at: string;
};

export type Warehouse = {
  id: string;
  host_id: string;
  title: string;
  city: string | null;
  total_area_m2: number | null;
  available_area_m2: number | null;
  price_per_m2_monthly: number | null;
  created_at: string;
};

export type DriverMetadata = {
  id: string;
  license_number: string | null;
  vehicle: VehicleType | null;
  max_weight_capacity_kg: number | null;
  created_at: string;
};

export type Rfq = {
  id: string;
  buyer_id: string;
  product_title: string;
  category: string | null;
  specifications: string | null;
  target_budget: string | null;
  quantity: number | null;
  status: RfqStatus;
  created_at: string;
};

export type Quotation = {
  id: string;
  rfq_id: string;
  supplier_id: string;
  offered_price: number | null;
  dynamic_lead_time: string | null;
  invoice_url: string | null;
  created_at: string;
};

export type Deal = {
  id: string;
  buyer_id: string;
  supplier_id: string;
  quote_id: string;
  warehouse_id: string | null;
  driver_id: string | null;
  gross_valuation: number | null;
  status: DealStatus;
  created_at: string;
};

// --- Insert payload shapes (DB fills id/created_at/defaults) ---------------
export type ProfileInsert = Partial<Profile> & { id: string };
export type ProductInsert = Omit<Product, "id" | "created_at" | "images"> & {
  images?: string[];
};
export type WarehouseInsert = Omit<Warehouse, "id" | "created_at">;
export type RfqInsert = Omit<Rfq, "id" | "created_at" | "status" | "category"> & {
  status?: RfqStatus;
  category?: string | null;
};
export type QuotationInsert = Omit<Quotation, "id" | "created_at">;

// --- Joined read shapes ----------------------------------------------------
export type ProfileBrief = Pick<
  Profile,
  "id" | "full_name" | "company_name" | "status"
>;

export type ProductWithSupplier = Product & { profiles: ProfileBrief | null };
export type WarehouseWithHost = Warehouse & { profiles: ProfileBrief | null };
export type QuotationWithSupplier = Quotation & {
  profiles: Pick<Profile, "id" | "full_name" | "company_name"> | null;
};

/**
 * Minimal Database type map consumable by `SupabaseClient<Database>`. Only the
 * Row/Insert/Update shapes the app actually uses are declared. Each table
 * carries an empty `Relationships` tuple to satisfy the GenericTable contract.
 */
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: ProfileInsert;
        Update: Partial<Profile>;
        Relationships: [];
      };
      products: {
        Row: Product;
        Insert: ProductInsert;
        Update: Partial<Product>;
        Relationships: [];
      };
      warehouses: {
        Row: Warehouse;
        Insert: WarehouseInsert;
        Update: Partial<Warehouse>;
        Relationships: [];
      };
      drivers_metadata: {
        Row: DriverMetadata;
        Insert: DriverMetadata;
        Update: Partial<DriverMetadata>;
        Relationships: [];
      };
      rfqs: {
        Row: Rfq;
        Insert: RfqInsert;
        Update: Partial<Rfq>;
        Relationships: [];
      };
      quotations: {
        Row: Quotation;
        Insert: QuotationInsert;
        Update: Partial<Quotation>;
        Relationships: [];
      };
      deals: {
        Row: Deal;
        Insert: Partial<Deal>;
        Update: Partial<Deal>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      accept_deal: { Args: { p_quote_id: string }; Returns: Deal };
      is_super_admin: { Args: Record<string, never>; Returns: boolean };
    };
    Enums: {
      platform_role: PlatformRole;
      verification_status: VerificationStatus;
      deal_status: DealStatus;
      vehicle_type: VehicleType;
      rfq_status: RfqStatus;
    };
  };
};
