import { describe, it, expect } from "vitest";
import { retrieveModels, getModelById, getAllModels } from "@/lib/model-db";

describe("retrieveModels — RAG / Enterprise Copilot", () => {
  it("returns Llama 3.1 70B as the top candidate for high-concurrency RAG", () => {
    const models = retrieveModels("RAG / Enterprise Copilot", "7B-70B", []);
    expect(models.length).toBeGreaterThan(0);
    expect(models[0].model_id).toBe("meta-llama/Meta-Llama-3.1-70B-Instruct");
  });

  it("does not return Mixtral ahead of Llama 70B for RAG", () => {
    const models = retrieveModels("RAG / Enterprise Copilot", "7B-70B", []);
    const llamaIdx  = models.findIndex((m) => m.model_id === "meta-llama/Meta-Llama-3.1-70B-Instruct");
    const mixtralIdx = models.findIndex((m) => m.model_id === "mistralai/Mixtral-8x7B-Instruct-v0.1");
    expect(llamaIdx).toBeLessThan(mixtralIdx < 0 ? Infinity : mixtralIdx);
  });

  it("filters to on-prem models when Financial Regulation compliance is required", () => {
    const models = retrieveModels("RAG / Enterprise Copilot", "7B-70B", ["Financial Regulation"]);
    for (const m of models) {
      expect(["on-prem", "both"]).toContain(m.deployment_type);
    }
  });

  it("returns only models in the 7B–72B range for the 7B-70B size hint", () => {
    const models = retrieveModels("RAG / Enterprise Copilot", "7B-70B", []);
    for (const m of models) {
      expect(m.parameters_b).toBeGreaterThanOrEqual(7);
      expect(m.parameters_b).toBeLessThanOrEqual(72);
    }
  });

  it("returns large models for >70B hint (Agentic Automation)", () => {
    const models = retrieveModels("Agentic Automation", ">70B", []);
    for (const m of models) {
      expect(m.parameters_b).toBeGreaterThanOrEqual(70);
    }
  });

  it("returns at most topN=5 results by default", () => {
    const models = retrieveModels("RAG / Enterprise Copilot", "7B-70B", []);
    expect(models.length).toBeLessThanOrEqual(5);
  });
});

describe("retrieveModels — Document AI", () => {
  it("prefers small/medium tier models", () => {
    const models = retrieveModels("Document AI", "7B-70B", []);
    expect(models.length).toBeGreaterThan(0);
    // First result should be small or medium
    expect(["small", "medium"]).toContain(models[0].tier);
  });
});

describe("getModelById", () => {
  it("returns the correct model for a known id", () => {
    const m = getModelById("meta-llama/Meta-Llama-3.1-70B-Instruct");
    expect(m).toBeDefined();
    expect(m!.parameters_b).toBe(70);
    expect(m!.layers).toBe(80);
    expect(m!.quantization_bytes).toBe(2); // FP16
  });

  it("returns undefined for an unknown id", () => {
    expect(getModelById("nonexistent/model")).toBeUndefined();
  });
});

describe("getAllModels", () => {
  it("includes Llama 70B, Mixtral, and Qwen 72B", () => {
    const ids = getAllModels().map((m) => m.model_id);
    expect(ids).toContain("meta-llama/Meta-Llama-3.1-70B-Instruct");
    expect(ids).toContain("mistralai/Mixtral-8x7B-Instruct-v0.1");
    expect(ids).toContain("Qwen/Qwen2.5-72B-Instruct");
  });
});
