import { describe, it, expect } from "vitest";
import { recommendGpu, getGpuById, getAllGpus } from "@/lib/gpu-db";

describe("recommendGpu — H100 for RAG workloads", () => {
  it("recommends H100 for a large RAG workload (>400 GB)", () => {
    const gpu = recommendGpu(500, "RAG / Enterprise Copilot");
    expect(gpu.id).toMatch(/h100/);
  });

  it("recommends H100 for a medium RAG workload (~200 GB)", () => {
    const gpu = recommendGpu(200, "RAG / Enterprise Copilot");
    expect(gpu.id).toMatch(/h100/);
  });

  it("recommends H100 for a very large training workload (>800 GB)", () => {
    const gpu = recommendGpu(900, "Training");
    expect(gpu.id).toMatch(/h100/);
  });

  it("does NOT recommend L40S for RAG workloads above 100 GB", () => {
    const gpu = recommendGpu(150, "RAG / Enterprise Copilot");
    expect(gpu.id).not.toBe("l40s");
  });

  it("H100 SXM has correct specs", () => {
    const h100 = getGpuById("h100-sxm");
    expect(h100).toBeDefined();
    expect(h100!.memory_gb).toBe(80);
    expect(h100!.utilization_factor).toBe(0.80);
    expect(h100!.gpus_per_node).toBe(8);
    // Effective memory should be 64 GB
    expect(h100!.memory_gb * h100!.utilization_factor).toBe(64);
  });

  it("H100 SXM best_for includes RAG", () => {
    const h100 = getGpuById("h100-sxm");
    expect(h100!.best_for).toContain("RAG");
  });
});

describe("recommendGpu — GPU scoring sanity", () => {
  it("returns a GPU even for tiny memory requirements", () => {
    const gpu = recommendGpu(10, "General LLM Inference");
    expect(gpu).toBeDefined();
    expect(gpu.memory_gb).toBeGreaterThan(0);
  });

  it("returned GPU always has gpus_per_node > 0", () => {
    for (const mem of [50, 200, 500, 1000]) {
      const gpu = recommendGpu(mem, "RAG / Enterprise Copilot");
      expect(gpu.gpus_per_node).toBeGreaterThan(0);
    }
  });
});

describe("getAllGpus", () => {
  it("includes H100, A100, and L40S", () => {
    const ids = getAllGpus().map((g) => g.id);
    expect(ids).toContain("h100-sxm");
    expect(ids).toContain("a100-sxm");
    expect(ids).toContain("l40s");
  });
});

describe("getGpuById", () => {
  it("returns undefined for unknown GPU", () => {
    expect(getGpuById("nonexistent-gpu")).toBeUndefined();
  });

  it("returns L40S with correct memory specs", () => {
    const l40s = getGpuById("l40s");
    expect(l40s).toBeDefined();
    expect(l40s!.memory_gb).toBe(48);
    expect(l40s!.utilization_factor).toBe(0.85);
  });
});
