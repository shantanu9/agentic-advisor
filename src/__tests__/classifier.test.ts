import { describe, it, expect } from "vitest";
import { runClassifier, deriveModelSizeHintFromClassifier } from "@/lib/classifier";
import type { IntakeOutput } from "@/types/agents";

// ── Shared fixture ─────────────────────────────────────────────────────────────

function makeIntake(overrides: Partial<IntakeOutput> = {}): IntakeOutput {
  return {
    industry: "Financial Services",
    use_case: "Build an internal RAG copilot for compliance documents",
    primary_goal: "Reduce time to answer compliance queries",
    user_count: 3000,
    requests_per_user_per_day: 10,
    concurrent_users: 300,
    latency_requirement_ms: 2000,
    availability: "high",
    data_sensitivity: "confidential",
    compliance: ["Financial Regulation"],
    data_sources: ["SharePoint", "Confluence"],
    data_volume_gb: 500,
    deployment_preference: "on-prem",
    timeline: "6 months",
    team_size: "5 engineers",
    budget_usd_month: 50000,
    lifecycle_stage: "production",
    input_tokens_per_request: 6000,
    output_tokens_per_request: 2000,
    ...overrides,
  };
}

// ── Workload classification ────────────────────────────────────────────────────

describe("runClassifier — workload classification", () => {
  it("classifies RAG copilot correctly", () => {
    const out = runClassifier(makeIntake());
    expect(out.workload_pattern).toBe("RAG / Enterprise Copilot");
    expect(out.rag_required).toBe(true);
    expect(out.embedding_required).toBe(true);
    expect(out.fine_tuning_required).toBe(false);
  });

  it("classifies document extraction workload", () => {
    const out = runClassifier(makeIntake({ use_case: "Extract data from PDF invoices and contracts", primary_goal: "Automate OCR and form parsing" }));
    expect(out.workload_pattern).toBe("Document AI");
  });

  it("classifies agentic automation workload", () => {
    const out = runClassifier(makeIntake({ use_case: "Agentic workflow automation for ticket routing", primary_goal: "Orchestrate multi-step agent tasks" }));
    expect(out.workload_pattern).toBe("Agentic Automation");
  });

  it("classifies fine-tuning workload", () => {
    const out = runClassifier(makeIntake({ use_case: "Fine-tune a domain-specific LLM", primary_goal: "Customize model for finance" }));
    expect(out.workload_pattern).toBe("Fine-tuning");
  });

  it("falls back to General LLM Inference for unknown workloads", () => {
    // Deliberately avoids all classifier keywords (copilot, document, agent, train, etc.)
    const out = runClassifier(makeIntake({ use_case: "Produce creative prose for brand campaigns", primary_goal: "Generate fresh marketing copy" }));
    expect(out.workload_pattern).toBe("General LLM Inference");
  });
});

// ── Data risk ──────────────────────────────────────────────────────────────────

describe("runClassifier — data risk", () => {
  it("returns High risk for Financial Regulation compliance", () => {
    const out = runClassifier(makeIntake({ compliance: ["Financial Regulation"] }));
    expect(out.data_risk).toBe("High");
  });

  it("returns High risk for PII compliance", () => {
    const out = runClassifier(makeIntake({ compliance: ["PII"] }));
    expect(out.data_risk).toBe("High");
  });

  it("returns Medium risk for confidential data with no regulated compliance", () => {
    const out = runClassifier(makeIntake({ compliance: [], data_sensitivity: "confidential" }));
    expect(out.data_risk).toBe("Medium");
  });

  it("returns Low risk for public data with no compliance", () => {
    const out = runClassifier(makeIntake({ compliance: [], data_sensitivity: "public" }));
    expect(out.data_risk).toBe("Low");
  });
});

// ── Hosting preference ─────────────────────────────────────────────────────────

describe("runClassifier — hosting preference", () => {
  it("returns Self-hosted for High data risk", () => {
    const out = runClassifier(makeIntake({ compliance: ["Financial Regulation"] }));
    expect(out.hosting_preference).toBe("Self-hosted / Private Cloud");
  });

  it("returns Managed Cloud when risk is Low and preference is cloud", () => {
    const out = runClassifier(makeIntake({ compliance: [], data_sensitivity: "public", deployment_preference: "cloud" }));
    expect(out.hosting_preference).toBe("Managed Cloud / API");
  });
});

// ── Sequence length ────────────────────────────────────────────────────────────

describe("runClassifier — sequence length", () => {
  it("computes 9000 tokens for 6000 input + 2000 output + 1000 RAG overhead", () => {
    const out = runClassifier(makeIntake({ input_tokens_per_request: 6000, output_tokens_per_request: 2000 }));
    expect(out.total_sequence_length).toBe(9000);
  });

  it("computes 4096 tokens for 2048 input + 1048 output", () => {
    const out = runClassifier(makeIntake({ input_tokens_per_request: 2048, output_tokens_per_request: 1048 }));
    expect(out.total_sequence_length).toBe(4096);
  });
});

// ── Completeness scoring ───────────────────────────────────────────────────────

describe("runClassifier — completeness", () => {
  it("returns Ready (100%) for a fully populated intake", () => {
    const out = runClassifier(makeIntake());
    expect(out.completeness_score).toBe(100);
    expect(out.completeness_status).toBe("Ready");
    expect(out.missing_fields).toHaveLength(0);
  });

  it("flags missing budget and user_count as incomplete", () => {
    const out = runClassifier(makeIntake({ budget_usd_month: 0, user_count: 0 }));
    expect(out.completeness_score).toBeLessThan(100);
    expect(out.missing_fields).toContain("Budget");
    expect(out.missing_fields).toContain("User Count");
  });

  it("returns Not Ready when fewer than 70% of mandatory fields are filled", () => {
    const sparse = makeIntake({
      budget_usd_month: 0, user_count: 0, requests_per_user_per_day: 0,
      latency_requirement_ms: 0, lifecycle_stage: "" as never,
    });
    const out = runClassifier(sparse);
    expect(out.completeness_status).toBe("Not Ready");
  });
});

// ── Data readiness ────────────────────────────────────────────────────────────

describe("runClassifier — data readiness", () => {
  it("returns Ready for a fully specified intake", () => {
    const out = runClassifier(makeIntake());
    expect(out.data_readiness_status).toBe("Ready");
    expect(out.data_readiness_score).toBeGreaterThanOrEqual(50);
  });
});

// ── Volume category ────────────────────────────────────────────────────────────

describe("runClassifier — volume category", () => {
  it("classifies 500 GB as Small", () => {
    const out = runClassifier(makeIntake({ data_volume_gb: 500 }));
    expect(out.data_volume_category).toBe("Small");
  });

  it("classifies 5000 GB as Large", () => {
    const out = runClassifier(makeIntake({ data_volume_gb: 5000 }));
    expect(out.data_volume_category).toBe("Large");
  });

  it("classifies 20000 GB as Very Large", () => {
    const out = runClassifier(makeIntake({ data_volume_gb: 20000 }));
    expect(out.data_volume_category).toBe("Very Large");
  });
});

// ── Model size hint ────────────────────────────────────────────────────────────

describe("deriveModelSizeHintFromClassifier", () => {
  it("returns 7B-70B for RAG with low concurrency", () => {
    expect(deriveModelSizeHintFromClassifier("RAG / Enterprise Copilot", 50)).toBe("7B-70B");
  });

  it("returns 7B-70B for RAG with high concurrency (>=100)", () => {
    expect(deriveModelSizeHintFromClassifier("RAG / Enterprise Copilot", 300)).toBe("7B-70B");
  });

  it("returns >70B for Training workloads", () => {
    expect(deriveModelSizeHintFromClassifier("Training", 0)).toBe(">70B");
  });

  it("returns >70B for Agentic Automation", () => {
    expect(deriveModelSizeHintFromClassifier("Agentic Automation", 0)).toBe(">70B");
  });
});
