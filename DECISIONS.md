# Agentic Advisor — Decision Log

A chronological record of every significant architectural, product, and engineering decision made during development.

---

## [D-001] Project Architecture — 6-Stage Agentic Pipeline
**Date:** Session 1  
**Decision:** Build the advisor as a 6-stage sequential pipeline: Intake Agent → Classifier → Model Selector → Sizing Engine → Deployment+TCO → Recommendation.  
**Rationale:** Each stage has a clearly bounded responsibility. LLM stages handle natural-language extraction and reasoning; code engine stages (Classifier, Sizing Engine) handle deterministic math that must not be left to LLM hallucination.  
**Alternatives considered:** Single-LLM end-to-end prompt (rejected — no auditability, prone to numeric hallucination).

---

## [D-002] LLM Provider — Groq with Fallback Chain
**Date:** Session 1  
**Decision:** Use Groq API as the LLM backend. Primary: `llama-3.1-8b-instant`. Fallback 1: `gemma2-9b-it`. Fallback 2: `llama-3.3-70b-versatile`.  
**Rationale:** Groq offers very low latency on open-weight models, no cold starts, and a free tier suitable for development. Fallback chain protects against individual model rate-limits or decommissioning.  
**History:**
- Original fallback 2 was `llama3-8b-8192` — decommissioned by Groq, replaced with `llama-3.2-3b-preview`.
- `llama-3.2-3b-preview` also decommissioned; replaced with `llama-3.3-70b-versatile`.

---

## [D-003] GPU Sizing — Pure Code Math, Not LLM
**Date:** Session 1  
**Decision:** The Sizing Engine computes GPU requirements using deterministic formulas, not LLM inference.  
**Formula:**
```
weights_memory   = params_B × quant_bytes × 1.2
kv_cache_memory  = 2 × concurrent_users × seq_len × layers × kv_heads × head_dim × quant_bytes / 1024³
total_memory     = weights + kv_cache + 4 GB (runtime)
gpus_required    = CEIL(total_memory / (gpu_vram × 0.80))
nodes_required   = CEIL(gpus_required / 8)
```
**Rationale:** GPU sizing is pure arithmetic. Delegating it to an LLM introduces unnecessary variability and risk of wrong answers on customer-facing outputs.

---

## [D-004] Reference Scenario — 8× H100 Canonical Test Case
**Date:** Session 1  
**Decision:** The canonical validation scenario is: Llama 3.1 70B, 123 concurrent users, 9,000 token sequences → exactly 8 H100 GPUs (1 node).  
**Math:**
- Weights: 70B × 2 bytes × 1.2 = 168 GB
- KV cache: 2 × 123 × 9000 × 80 layers × 8 KV heads × 128 head_dim × 2 / 1024³ = 337.83 GB
- Total: 168 + 337.83 + 4 = 509.83 GB
- GPUs: CEIL(509.83 / 64) = 8 ✓
**Use:** This scenario is used as the regression anchor in `sizing-engine.test.ts`.

---

## [D-005] TCO Pricing — Hardcoded Reference Tables, Not Live Azure API
**Date:** Session 1  
**Decision:** Replace live Azure Pricing API calls with hardcoded reference tables (`azure-pricing.ts`) matching enterprise quotes.  
**Rationale:** The Azure Retail API does not list `Standard_ND96isr_H100_v5` (ND H100 v5) by default. Live API calls also add latency and failure modes. Reference values are locked to verified enterprise quotes.  
**Reference values (per 8-GPU node):**

| Term | Hourly | Year 1 GPU Cost |
|------|--------|-----------------|
| PAYG | $98.32 | $861,283 |
| 1yr Reserved | $63.01 | $552,000 |
| 3yr Reserved | $43.84 | $384,000/yr |

Cloud ancillary services: $2,005.50/mo → $17,315.95/yr  
On-prem (Dell XE9680): Year 1 = $616,280 · Year 3 = $1,348,840

---

## [D-006] Model Database — RAG Tier Preference Fix
**Date:** Session 1  
**Decision:** Changed RAG workload tier preference from `["medium", "large"]` to `["large", "medium"]` in `model-db.ts`.  
**Rationale:** For production RAG/Enterprise Copilot workloads, a 70B model (Llama 3.1 70B) delivers better answer quality than Mixtral 8x7B. The original ordering caused Mixtral to outscore Llama 70B.

---

## [D-007] GPU Database — Add "RAG" to H100 best_for
**Date:** Session 1  
**Decision:** Added `"RAG"` and `"Enterprise Copilot"` to H100 SXM and H100 PCIe `best_for` arrays in `gpu-db.json`.  
**Rationale:** Without this, L40S outscored H100 for RAG workloads (L40S already had "RAG" in best_for). H100 is the correct recommendation for high-memory multi-node RAG deployments.  
**Score delta:** H100 went from 50 → 80 for RAG; L40S stays at 76.

---

## [D-008] Classifier — Concurrency-Aware Model Size Hint
**Date:** Session 1  
**Decision:** `deriveModelSizeHint` now accepts `concurrentUsers` as a parameter. For RAG workloads with ≥100 concurrent users, it returns `"7B-70B"` (allowing 70B models) rather than capping at smaller sizes.  
**Rationale:** KV cache memory scales linearly with concurrent users. At 100+ users, only a properly sized 70B model can handle the memory requirements. Without this, the pipeline selected undersized models.

---

## [D-009] Testing — Vitest Unit Test Suite
**Date:** Session 1  
**Decision:** Add Vitest as the test runner with `@/` path alias support. Four test suites covering all deterministic pipeline stages.  
**Coverage:**
- `model-db.test.ts` — 10 tests (RAG retrieval, compliance filtering, size bounds)
- `classifier.test.ts` — 24 tests (workload classification, data risk, hosting, sequence length, completeness, volume)
- `gpu-db.test.ts` — 11 tests (H100 recommended for RAG, L40S excluded above 100 GB)
- `sizing-engine.test.ts` — 16 tests including 8-H100 reference scenario
- `tco.test.ts` — 39 tests (reference rates, cloud/on-prem totals, linear scaling, component breakdowns)

---

## [D-010] Deployment — GitHub → Vercel Auto-Deploy
**Date:** Session 1  
**Decision:** Push to `master` branch on `github.com/shantanu9/agentic-advisor` auto-deploys to `agentic-advisor.vercel.app` via Vercel Git integration.  
**Note:** Vercel project was already connected; no manual setup needed.

---

## [D-011] TCO UI — Nested Tabs for Cloud and On-Prem
**Date:** Session 2  
**Decision:** Replaced the flat Deployment+TCO card with a two-level tabbed UI.  
**Structure:**
- Main tab: **☁ Cloud (Azure)** | **🏢 On-Prem**
- Cloud sub-tabs: **Pay-as-you-go** | **1-Year Reserved** | **3-Year Reserved**
- On-Prem sub-tabs: **1-Year** | **3-Year**
- Each sub-tab shows a cost summary card + full line-item cost breakdown table with a Total row
**Rationale:** Users need to compare commitment terms side-by-side. The old card showed only 1yr cloud and mixed cloud/on-prem rows in a single table with no term selection.  
**Implementation:** Pipeline now computes all three cloud terms (PAYG, 1yr, 3yr) and stores separate `cost_rows` arrays per term in `DeploymentTcoOutput`.

---

## [D-012] Groq Timeout — Tightened for Faster Failure
**Date:** Session 2  
**Decision:** Reduced Groq call timeouts significantly.  
**Before:** Socket timeout 30s, 3 attempts per model, 2s retry delay → worst-case hang: ~270s  
**After:** Socket timeout 12s, hard wall-clock deadline 20s via `Promise.race`, 2 attempts per model, 0.8s retry delay → worst-case: ~75s  
**Rationale:** Long silent hangs on the Intake Agent gave users no feedback. Fast failure triggers the error UI and Retry button, which is better UX than a 4-minute blank spinner.

---

## [D-013] Groq HTTP — Raw `https.request` Instead of Groq SDK
**Date:** Session 3  
**Decision:** Replaced the `groq-sdk` client with direct Node.js `https.request` calls to `api.groq.com`.  
**Rationale:** Next.js App Router patches `globalThis.fetch` for caching/deduplication. The Groq SDK uses the patched `fetch` internally, which caused every call inside the API route to fail with "Request timed out." even though direct Groq API calls (outside Next.js) worked in ~2s. Switching to `https.request` completely bypasses the patched fetch.  
**Attempted first:** `undici` fetch import — installed and tried, but Turbopack bundled it incorrectly at runtime. Fell back to native `https` module which has no bundler interference.  
**Also added:** `export const dynamic = "force-dynamic"` and `export const fetchCache = "force-no-store"` to `route.ts` as belt-and-suspenders.

---

## [D-014] JSON Sanitizer — Char-by-Char Single-Quote Replacement
**Date:** Session 3  
**Decision:** Replaced the regex-based `sanitizeJson` with a char-by-char walker that converts single-quoted strings to double-quoted, strips markdown fences, and removes trailing commas.  
**Rationale:** The original regex `([{,]\s*)'([^']+)'(\s*:)` missed single-quoted keys not immediately preceded by `{` or `,` (e.g. after a newline). The fallback model (`gemma2-9b-it`) frequently returned single-quoted JSON. The char-by-char approach correctly handles all positions while skipping content already inside double-quoted strings.  
**Also added:** `JSON_RULE` prefix prepended to all 4 LLM prompts instructing the model to use double quotes, no markdown, no trailing commas.

---

## [D-015] Retry Logic — 3 Models × 3 Attempts with 2s Delay
**Date:** Session 3  
**Decision:** `callGroq` now loops over 3 models, each with up to 3 attempts, with a 2s delay between retries on rate-limit (429) or timeout errors. Hard errors (auth, bad JSON) break immediately and try the next model.  
**Rationale:** Groq free tier has intermittent rate-limit spikes, especially at the Intake Agent (first call in the pipeline). The previous single-try-per-model approach surfaced errors to the user too quickly. With 3×3, the pipeline self-heals through transient blips without user intervention.  
**Worst case:** 3 models × 3 attempts × (30s timeout + 2s delay) = ~96s before hard failure.

---

## [D-016] Stage Pills — Click-to-Expand Accordion
**Date:** Session 3  
**Decision:** Replaced always-open stage output cards with a single card containing clickable pills. Clicking a completed pill expands a panel beneath the tracker row showing that stage's full detail card and LLM metrics (latency, tokens, cost, model name). Clicking again collapses. Only one panel open at a time.  
**Rationale:** The previous layout showed all 6 stage cards expanded simultaneously, pushing the Executive Dashboard far down the page and overwhelming first-time users. Accordion keeps the default view compact; power users drill into any stage on demand.  
**Bug fixed:** `stage_done` SSE events were sending `raw: ""` because `stageOutputs` was populated only after `runPipeline` resolved. Fixed by re-hydrating `stageRaw` from `data.pipeline` in the `done` event handler on the client.  
**UX detail:** Recommendation stage auto-expands on pipeline completion so the user immediately sees the rationale.

---

## [D-017] Error UX — Retry Button on Pipeline Failure
**Date:** Session 3  
**Decision:** Pipeline error state now shows a "Retry pipeline" button alongside the error message and a hint that the failure is usually a transient Groq rate-limit.  
**Rationale:** Previously, a timeout error left the user staring at red text with no affordance to retry — they had to re-click "Run Advisory Pipeline" and re-read the requirement. The Retry button re-invokes `runPipeline()` with the same requirement already in state.

---

## Pending / Not Yet Built

| Item | Status | Notes |
|------|--------|-------|
| Standalone `/tco` page | Awaiting requirements | User said "I'll give you the clear requirement" |
| On-prem 3-Year sub-tab shows total (not annual) | Known | `year3_usd` field used correctly; verify display label |
