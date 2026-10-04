const configuredApiUrl = (import.meta.env.VITE_API_URL || "/api").trim().replace(/\/+$/, "");
const apiOrigin = configuredApiUrl.startsWith("/") || /^https?:\/\//i.test(configuredApiUrl)
  ? configuredApiUrl
  : `https://${configuredApiUrl}`;
const API_ROOT = apiOrigin.endsWith("/api") ? apiOrigin : `${apiOrigin}/api`;

export type User = {
  id: number;
  email: string;
  full_name: string;
  role: "supplier" | "buyer" | "admin";
  status: string;
  is_verified: boolean;
  business_name?: string | null;
  county?: string | null;
};

export type Material = {
  id: number;
  slug: string;
  name: string;
  description?: string | null;
  typical_conditions: string[];
  typical_units: string[];
  primary_uses: string[];
  buyer_types: string[];
};

export type Listing = {
  id: number;
  supplier_id: number;
  supplier_name: string;
  material_id: number;
  material: string;
  title: string;
  condition: string;
  quantity: number;
  quantity_available: number;
  unit: string;
  price_per_unit: number | null;
  currency: string;
  county: string | null;
  city: string | null;
  description: string | null;
  status: string;
};

export type Requirement = {
  id: number;
  buyer_id: number;
  material_id: number;
  material: string;
  title: string;
  quantity: number;
  unit: string;
  acceptable_conditions: string[];
  delivery_counties: string[];
  status: string;
};

export type Match = {
  id: number;
  requirement_id: number;
  status: string;
  requested_quantity_base: number;
  matched_quantity_base: number;
  supplier_count: number;
  coverage_percent: number;
  explanation: string | null;
  requested_quantity: number;
  matched_quantity: number;
  unit: string;
  base_unit: string;
  items: Array<{
    listing_id: number;
    supplier_id: number;
    supplier_name: string;
    title: string;
    quantity_base: string;
    quantity: string;
    unit: string;
    condition: string;
    county: string | null;
  }>;
};

export type Transaction = {
  id: number;
  material: string;
  supplier_id: number;
  supplier_name: string;
  buyer_id: number;
  buyer_name: string;
  quantity_declared: number;
  quantity_received: number | null;
  unit: string;
  subtotal: number;
  platform_fee: number;
  total: number;
  currency: string;
  status: string;
  payments: Array<{ id: number; status: string; method: string; reference: string | null }>;
};

export type Notification = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  meta: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

export type Dispute = {
  id: number;
  transaction_id: number;
  opened_by_id: number;
  reason: string;
  supplier_claim_quantity: number | null;
  buyer_claim_quantity: number | null;
  status: string;
  resolution: string;
  resolution_notes: string | null;
  resolved_by_id: number | null;
  resolved_at: string | null;
  created_at: string;
  transaction_status: string;
  material: string;
  supplier_id: number;
  supplier_name: string;
  buyer_id: number;
  buyer_name: string;
  messages: Array<{
    id: number;
    author_id: number | null;
    author_name: string;
    body: string;
    created_at: string;
  }>;
};

export type Category = {
  id: number;
  name: string;
  materials: Material[];
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  token: string | null = null,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, { ...options, headers });
  } catch {
    throw new Error("Could not reach the Re-Watt API. Please check your connection and try again.");
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { detail?: string }
      | null;
    throw new ApiError(payload?.detail || `Request failed (${response.status}).`, response.status);
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("The API URL returned a web page instead of JSON. Check the API deployment URL and frontend proxy configuration.");
  }
  return (await response.json()) as T;
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}
