import onPremData from "@/data/on-prem-assumptions.json";

export interface AzureVmPrice {
  sku: string;
  name: string;
  region: string;
  price_usd_per_hour: number;
  gpu_count: number;
  gpu_type: string;
}

export interface OnPremAssumptions {
  capacity_block_size_gpus: number;
  server_costs: {
    gpu_unit_cost_usd: number;
    cpu_server_cost_usd: number;
    nvme_storage_cost_usd: number;
    networking_cost_usd: number;
    rack_and_power_usd: number;
  };
  opex_monthly_usd: {
    power_per_gpu: number;
    cooling_per_gpu: number;
    maintenance_percent_of_capex: number;
    team_cost_per_node: number;
    software_licenses_per_node: number;
  };
  depreciation_years: number;
  currency: { usd_to_inr: number };
}

// Cache so we don't hit Azure API on every pipeline run
let priceCache: AzureVmPrice[] | null = null;
let cacheTs = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// GPU SKUs we care about — maps azure SKU name fragment → GPU info
const TARGET_SKUS: Record<string, { gpu_count: number; gpu_type: string }> = {
  "NC40ads_H100_v5":    { gpu_count: 1,  gpu_type: "H100 PCIe" },
  "ND96asr_v4":         { gpu_count: 8,  gpu_type: "A100 SXM 80GB" },
  "ND96amsr_A100_v4":   { gpu_count: 8,  gpu_type: "A100 SXM 80GB" },
  "NC24ads_A100_v4":    { gpu_count: 1,  gpu_type: "A100 PCIe 40GB" },
  "NC48ads_A100_v4":    { gpu_count: 2,  gpu_type: "A100 PCIe 40GB" },
  "NC96ads_A100_v4":    { gpu_count: 4,  gpu_type: "A100 PCIe 40GB" },
  "NV36ads_A10_v5":     { gpu_count: 1,  gpu_type: "A10G" },
  "NV72ads_A10_v5":     { gpu_count: 2,  gpu_type: "A10G" },
};

export async function fetchAzurePrices(region = "eastus"): Promise<AzureVmPrice[]> {
  if (priceCache && Date.now() - cacheTs < CACHE_TTL_MS) return priceCache;

  try {
    const skuNames = Object.keys(TARGET_SKUS).map((s) => `'Standard_${s}'`).join(",");
    const filter = `serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and priceType eq 'Consumption'`;
    const url = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}&$top=100`;

    const res = await fetch(url, { next: { revalidate: 21600 } });
    if (!res.ok) throw new Error(`Azure pricing API ${res.status}`);

    const json = await res.json() as { Items: Array<{ skuName: string; retailPrice: number; armSkuName: string }> };
    const prices: AzureVmPrice[] = [];

    for (const item of json.Items) {
      const skuKey = Object.keys(TARGET_SKUS).find((k) => item.armSkuName?.includes(k));
      if (!skuKey) continue;
      // Skip spot / low-priority
      if (item.skuName?.toLowerCase().includes("spot") || item.skuName?.toLowerCase().includes("low")) continue;
      prices.push({
        sku: item.armSkuName,
        name: item.skuName,
        region,
        price_usd_per_hour: item.retailPrice,
        gpu_count: TARGET_SKUS[skuKey].gpu_count,
        gpu_type: TARGET_SKUS[skuKey].gpu_type,
      });
    }

    priceCache = prices;
    cacheTs = Date.now();
    return prices;
  } catch (err) {
    console.warn("Azure pricing API failed, using fallback estimates:", String(err));
    return getFallbackPrices();
  }
}

// Fallback prices if Azure API is unavailable
function getFallbackPrices(): AzureVmPrice[] {
  return [
    { sku: "Standard_ND96asr_v4",       name: "Standard ND96asr v4",       region: "eastus", price_usd_per_hour: 27.20, gpu_count: 8, gpu_type: "A100 SXM 80GB" },
    { sku: "Standard_NC40ads_H100_v5",   name: "Standard NC40ads H100 v5",   region: "eastus", price_usd_per_hour: 12.00, gpu_count: 1, gpu_type: "H100 PCIe" },
    { sku: "Standard_NC24ads_A100_v4",   name: "Standard NC24ads A100 v4",   region: "eastus", price_usd_per_hour: 3.67,  gpu_count: 1, gpu_type: "A100 PCIe 40GB" },
    { sku: "Standard_NV36ads_A10_v5",    name: "Standard NV36ads A10 v5",    region: "eastus", price_usd_per_hour: 1.52,  gpu_count: 1, gpu_type: "A10G" },
  ];
}

export function getPriceForGpu(prices: AzureVmPrice[], gpuType: string, gpuCount: number): number {
  // Find the best matching SKU — prefer one whose gpu_count matches or find per-GPU rate
  const matches = prices.filter((p) =>
    p.gpu_type.toLowerCase().includes(gpuType.toLowerCase().split(" ")[0])
  );
  if (matches.length === 0) return 3.5 * gpuCount; // generic fallback $/hr

  // Get per-GPU hourly rate from smallest matching SKU
  const perGpuRate = Math.min(...matches.map((p) => p.price_usd_per_hour / p.gpu_count));
  return perGpuRate * gpuCount;
}

export function getOnPremAssumptions(): OnPremAssumptions {
  return onPremData as OnPremAssumptions;
}

export function calcOnPremTco(gpuCount: number, gpuOnPremCostPerYear: number, nodesRequired: number): { year1: number; year3: number; breakdown: Array<{ category: string; year1_usd: number; year3_usd: number }> } {
  const assumptions = getOnPremAssumptions();
  const s = assumptions.server_costs;
  const o = assumptions.opex_monthly_usd;

  const capex =
    gpuCount * s.gpu_unit_cost_usd +
    nodesRequired * s.cpu_server_cost_usd +
    nodesRequired * s.nvme_storage_cost_usd +
    nodesRequired * s.networking_cost_usd +
    nodesRequired * s.rack_and_power_usd;

  const annualOpex =
    gpuCount * (o.power_per_gpu + o.cooling_per_gpu) * 12 +
    capex * o.maintenance_percent_of_capex +
    nodesRequired * o.team_cost_per_node * 12 +
    nodesRequired * o.software_licenses_per_node * 12;

  const year1 = capex + annualOpex;
  const year3 = capex + annualOpex * 3;

  const breakdown = [
    { category: "Hardware (CAPEX)",     year1_usd: capex,       year3_usd: capex },
    { category: "Power & Cooling",      year1_usd: gpuCount * (o.power_per_gpu + o.cooling_per_gpu) * 12, year3_usd: gpuCount * (o.power_per_gpu + o.cooling_per_gpu) * 36 },
    { category: "Maintenance",          year1_usd: capex * o.maintenance_percent_of_capex, year3_usd: capex * o.maintenance_percent_of_capex * 3 },
    { category: "Team & Operations",    year1_usd: nodesRequired * o.team_cost_per_node * 12, year3_usd: nodesRequired * o.team_cost_per_node * 36 },
    { category: "Software & Licenses",  year1_usd: nodesRequired * o.software_licenses_per_node * 12, year3_usd: nodesRequired * o.software_licenses_per_node * 36 },
  ];

  return { year1, year3, breakdown };
}
