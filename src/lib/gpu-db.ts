import gpuData from "@/data/gpu-db.json";

export interface GpuSpec {
  id: string;
  name: string;
  memory_gb: number;
  memory_bandwidth_tbps: number;
  fp16_tflops: number;
  utilization_factor: number;
  gpus_per_node: number;
  interconnect: string;
  tier: string;
  best_for: string[];
  azure_sku: string;
  on_prem_cost_usd_per_year: number;
}

const GPU_DB: GpuSpec[] = gpuData as GpuSpec[];

export function getAllGpus(): GpuSpec[] {
  return GPU_DB;
}

export function getGpuById(id: string): GpuSpec | undefined {
  return GPU_DB.find((g) => g.id === id);
}

export function recommendGpu(totalMemoryGb: number, workloadPattern: string): GpuSpec {
  const scored = GPU_DB.map((gpu) => {
    const effectiveMemory = gpu.memory_gb * gpu.utilization_factor;
    const fits = effectiveMemory > 0;
    const workloadMatch = gpu.best_for.some((w) =>
      workloadPattern.toLowerCase().includes(w.toLowerCase()) ||
      w.toLowerCase().includes(workloadPattern.split(" ")[0].toLowerCase())
    );
    const gpusNeeded = Math.ceil(totalMemoryGb / effectiveMemory);
    const score =
      (workloadMatch ? 30 : 0) +
      (gpusNeeded <= 8 ? 20 : gpusNeeded <= 16 ? 10 : 0) +
      (gpu.tier === "flagship" ? 10 : gpu.tier === "enterprise" ? 8 : gpu.tier === "mid-range" ? 6 : 4) +
      (fits ? 20 : 0);
    return { gpu, score, gpusNeeded };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].gpu;
}

export function getEffectiveMemory(gpu: GpuSpec): number {
  return gpu.memory_gb * gpu.utilization_factor;
}
