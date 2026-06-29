// ── Reference tables (source: enterprise quotes / Azure retail pricing) ────────
// All rates are per 8-GPU node (ND96isr H100 v5 / Dell XE9680)

export const H100_NODE_CLOUD_RATES = {
  // Azure ND96isr H100 v5 — 8 GPU node
  payg_per_hour:        98.32,
  reserved_1yr_per_hour: 63.01,
  reserved_3yr_per_hour: 43.84,

  // Monthly = hourly × 730 hrs
  payg_monthly:        71773.60,
  reserved_1yr_monthly: 46000,
  reserved_3yr_monthly: 32000,

  // Yearly GPU-only cost
  payg_year1:        861283.20,
  reserved_1yr_year1: 552000,
  reserved_3yr_year1: 384000,   // per year at 3yr rate
  reserved_3yr_total: 1152000,  // 3-year total GPU cost
} as const;

export const CLOUD_SERVICES_PER_NODE = {
  // Azure ancillary services (storage, egress, Vector DB, monitoring, IAM, etc.)
  monthly:    2005.50,
  six_month:  12032.98,
  year1:      17315.95,
  year3:      50927.86,

  // Monthly breakdown
  breakdown: {
    storage_20tb:          843.78,
    data_egress_20gb:       48.00,
    vector_db_cosmos:      600.00,
    monitoring_logging:    383.00,
    inter_zone_transfer:    30.72,
    iam_secrets:           100.00,
  },
} as const;

export const ON_PREM_PER_NODE = {
  // Dell XE9680 — 8 GPU H100 node
  capex: {
    compute_year1: 300000,   // first-year compute payment (financed)
    compute_total: 500000,   // total compute paid over lifecycle
    storage:        25000,
    network:        25000,
  },

  opex_monthly: {
    power_and_cooling:   1000,
    data_egress:           10,
    vector_db_milvus:     500,
    monitoring_logging:   400,
    iam_secrets:          200,
    infra_ops:           1000,
    rack_and_space:      1000,
    colo_equinix:         500,
    ops_support_8fte:   14080,
    backup:                 0,
    software_stack:       500,
    // total: 19190
  },

  nvaie_annual: 36000,  // NVIDIA AI Enterprise per 8-GPU node

  // Verified totals
  year1_total:   616280,
  year3_total:  1348840,
  monthly_opex:  19190,
  annual_opex:   230280,
} as const;

// ── Cloud TCO calculator ───────────────────────────────────────────────────────

export type CloudTerm = "payg" | "1yr" | "3yr";

export interface CloudTcoResult {
  gpu_year1:      number;
  gpu_year3:      number;
  services_year1: number;
  services_year3: number;
  total_year1:    number;
  total_year3:    number;
  hourly_rate:    number;
  term:           CloudTerm;
  cost_rows:      Array<{ category: string; year1_usd: number; year3_usd: number }>;
}

export function calcCloudTco(nodesRequired: number, term: CloudTerm = "1yr"): CloudTcoResult {
  const r = H100_NODE_CLOUD_RATES;
  const s = CLOUD_SERVICES_PER_NODE;

  const hourlyRate =
    term === "payg" ? r.payg_per_hour :
    term === "1yr"  ? r.reserved_1yr_per_hour :
                      r.reserved_3yr_per_hour;

  const gpuYear1 =
    term === "payg" ? r.payg_year1 :
    term === "1yr"  ? r.reserved_1yr_year1 :
                      r.reserved_3yr_year1;

  const gpuYear3 =
    term === "payg" ? r.payg_year1 * 3 :
    term === "1yr"  ? r.reserved_1yr_year1 * 3 :
                      r.reserved_3yr_total;

  const totalYear1 = Math.round((gpuYear1 + s.year1) * nodesRequired);
  const totalYear3 = Math.round((gpuYear3 + s.year3) * nodesRequired);

  const cost_rows = [
    {
      category:  `GPU Compute (H100 ND96isr v5 — ${term === "payg" ? "Pay-as-you-go" : term === "1yr" ? "1yr Reserved" : "3yr Reserved"})`,
      year1_usd: Math.round(gpuYear1 * nodesRequired),
      year3_usd: Math.round(gpuYear3 * nodesRequired),
    },
    {
      category:  "Storage (20TB mixed tiers)",
      year1_usd: Math.round(s.breakdown.storage_20tb      * 12 * nodesRequired),
      year3_usd: Math.round(s.breakdown.storage_20tb      * 36 * nodesRequired),
    },
    {
      category:  "Data Egress (20GB/month)",
      year1_usd: Math.round(s.breakdown.data_egress_20gb  * 12 * nodesRequired),
      year3_usd: Math.round(s.breakdown.data_egress_20gb  * 36 * nodesRequired),
    },
    {
      category:  "Vector DB (Cosmos DB managed)",
      year1_usd: Math.round(s.breakdown.vector_db_cosmos  * 12 * nodesRequired),
      year3_usd: Math.round(s.breakdown.vector_db_cosmos  * 36 * nodesRequired),
    },
    {
      category:  "Monitoring & Logging",
      year1_usd: Math.round(s.breakdown.monitoring_logging * 12 * nodesRequired),
      year3_usd: Math.round(s.breakdown.monitoring_logging * 36 * nodesRequired),
    },
    {
      category:  "Inter-zone Transfer",
      year1_usd: Math.round(s.breakdown.inter_zone_transfer * 12 * nodesRequired),
      year3_usd: Math.round(s.breakdown.inter_zone_transfer * 36 * nodesRequired),
    },
    {
      category:  "IAM / Secrets",
      year1_usd: Math.round(s.breakdown.iam_secrets        * 12 * nodesRequired),
      year3_usd: Math.round(s.breakdown.iam_secrets        * 36 * nodesRequired),
    },
  ];

  return {
    gpu_year1:      Math.round(gpuYear1 * nodesRequired),
    gpu_year3:      Math.round(gpuYear3 * nodesRequired),
    services_year1: Math.round(s.year1  * nodesRequired),
    services_year3: Math.round(s.year3  * nodesRequired),
    total_year1:    totalYear1,
    total_year3:    totalYear3,
    hourly_rate:    hourlyRate,
    term,
    cost_rows,
  };
}

// ── On-Prem TCO calculator ─────────────────────────────────────────────────────

export interface OnPremTcoResult {
  capex_year1:   number;
  capex_total:   number;
  opex_year1:    number;
  opex_year3:    number;
  nvaie_year1:   number;
  nvaie_year3:   number;
  total_year1:   number;
  total_year3:   number;
  monthly_opex:  number;
  cost_rows:     Array<{ category: string; year1_usd: number; year3_usd: number }>;
}

export function calcOnPremTco(nodesRequired: number): OnPremTcoResult {
  const p = ON_PREM_PER_NODE;
  const n = nodesRequired;

  const capexYear1  = (p.capex.compute_year1 + p.capex.storage + p.capex.network) * n;
  const capexTotal  = (p.capex.compute_total  + p.capex.storage + p.capex.network) * n;
  const opexYear1   = p.annual_opex * n;
  const opexYear3   = p.annual_opex * 3 * n;
  const nvaieYear1  = p.nvaie_annual * n;
  const nvaieYear3  = p.nvaie_annual * 3 * n;

  const totalYear1 = Math.round(p.year1_total * n);
  const totalYear3 = Math.round(p.year3_total * n);

  const o = p.opex_monthly;
  const cost_rows = [
    { category: "Compute (Dell XE9680)",          year1_usd: p.capex.compute_year1 * n, year3_usd: p.capex.compute_total * n  },
    { category: "Storage (NAS + Object)",          year1_usd: p.capex.storage * n,       year3_usd: p.capex.storage * n        },
    { category: "Network (Switches + Fabric)",     year1_usd: p.capex.network * n,       year3_usd: p.capex.network * n        },
    { category: "Power & Cooling",                 year1_usd: o.power_and_cooling   * 12 * n, year3_usd: o.power_and_cooling   * 36 * n },
    { category: "Data Egress (ISP/bandwidth)",     year1_usd: o.data_egress         * 12 * n, year3_usd: o.data_egress         * 36 * n },
    { category: "Vector DB (Milvus self-hosted)",  year1_usd: o.vector_db_milvus    * 12 * n, year3_usd: o.vector_db_milvus    * 36 * n },
    { category: "Monitoring (Prometheus+Grafana)", year1_usd: o.monitoring_logging  * 12 * n, year3_usd: o.monitoring_logging  * 36 * n },
    { category: "IAM / Secrets (AD + Vault)",      year1_usd: o.iam_secrets         * 12 * n, year3_usd: o.iam_secrets         * 36 * n },
    { category: "Infrastructure Ops (Admin)",      year1_usd: o.infra_ops           * 12 * n, year3_usd: o.infra_ops           * 36 * n },
    { category: "Rack + Space",                    year1_usd: o.rack_and_space      * 12 * n, year3_usd: o.rack_and_space      * 36 * n },
    { category: "Colo (Equinix)",                  year1_usd: o.colo_equinix        * 12 * n, year3_usd: o.colo_equinix        * 36 * n },
    { category: "Ops Support (8 FTE @ $30/hr)",    year1_usd: o.ops_support_8fte    * 12 * n, year3_usd: o.ops_support_8fte    * 36 * n },
    { category: "Backup",                          year1_usd: o.backup              * 12 * n, year3_usd: o.backup              * 36 * n },
    { category: "Software Stack",                  year1_usd: o.software_stack      * 12 * n, year3_usd: o.software_stack      * 36 * n },
    { category: "NVAIE License (per 8 GPU)",       year1_usd: p.nvaie_annual        *      n, year3_usd: p.nvaie_annual        *  3 * n },
  ];

  return {
    capex_year1:  capexYear1,
    capex_total:  capexTotal,
    opex_year1:   opexYear1,
    opex_year3:   opexYear3,
    nvaie_year1:  nvaieYear1,
    nvaie_year3:  nvaieYear3,
    total_year1:  totalYear1,
    total_year3:  totalYear3,
    monthly_opex: p.monthly_opex * n,
    cost_rows,
  };
}

// ── Break-even ────────────────────────────────────────────────────────────────

export function calcBreakevenMonth(cloudYear1: number, onPremYear1: number, onPremYear3: number): number | null {
  const cloudMonthly  = cloudYear1 / 12;
  const onPremCapex   = onPremYear1 - (onPremYear3 - onPremYear1) / 2; // rough capex isolation
  const onPremMonthly = (onPremYear1 - onPremCapex) / 12;

  for (let m = 1; m <= 36; m++) {
    if (onPremCapex + onPremMonthly * m <= cloudMonthly * m) return m;
  }
  return null;
}

// ── Legacy stubs (kept for type-compatibility with any remaining callers) ──────

export interface AzureVmPrice {
  sku: string; name: string; region: string;
  price_usd_per_hour: number; gpu_count: number; gpu_type: string;
}

export async function fetchAzurePrices(): Promise<AzureVmPrice[]> {
  return [
    { sku: "Standard_ND96isr_H100_v5", name: "ND96isr H100 v5 (1yr Reserved)", region: "eastus", price_usd_per_hour: H100_NODE_CLOUD_RATES.reserved_1yr_per_hour, gpu_count: 8, gpu_type: "H100 SXM" },
    { sku: "Standard_ND96isr_H100_v5_3yr", name: "ND96isr H100 v5 (3yr Reserved)", region: "eastus", price_usd_per_hour: H100_NODE_CLOUD_RATES.reserved_3yr_per_hour, gpu_count: 8, gpu_type: "H100 SXM" },
    { sku: "Standard_ND96isr_H100_v5_payg", name: "ND96isr H100 v5 (PAYG)", region: "eastus", price_usd_per_hour: H100_NODE_CLOUD_RATES.payg_per_hour, gpu_count: 8, gpu_type: "H100 SXM" },
  ];
}

export function getPriceForGpu(_prices: AzureVmPrice[], _gpuType: string, _gpuCount: number): number {
  return H100_NODE_CLOUD_RATES.reserved_1yr_per_hour * 8; // stub — use calcCloudTco instead
}

export function getOnPremAssumptions() { return ON_PREM_PER_NODE; }
