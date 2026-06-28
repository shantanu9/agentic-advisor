import { ModelSelectorOutput, SizingOutput } from "@/types/agents";
import { ClassifierOutput } from "@/types/agents";
import { recommendGpu, getEffectiveMemory } from "./gpu-db";

const MEMORY_OVERHEAD_FACTOR = 1.2;
const RUNTIME_OVERHEAD_GB    = 4;    // CUDA context, runtime buffers
const DAYS_PER_YEAR          = 360;

// ── Memory formulas (PRD §17.6) ───────────────────────────────────────────────

function calcModelWeightsMemory(paramsBillion: number, quantizationBytes: number): number {
  return paramsBillion * quantizationBytes * MEMORY_OVERHEAD_FACTOR;
}

function calcKvCacheMemory(
  concurrentUsers: number,
  sequenceLength: number,
  layers: number,
  kvHeads: number,
  headDim: number,
  quantizationBytes: number
): number {
  const kvMultiplier = 2; // keys + values
  const bytes =
    kvMultiplier * concurrentUsers * sequenceLength * layers * kvHeads * headDim * quantizationBytes;
  return bytes / 1024 ** 3;
}

// ── GPU sizing (PRD §17.7) ────────────────────────────────────────────────────

function ceilDiv(a: number, b: number): number {
  return Math.ceil(a / b);
}

// ── Deployment classification (PRD §17.8) ────────────────────────────────────

function classifyDeployment(gpus: number, nodes: number): SizingOutput["deployment_classification"] {
  if (gpus === 1)             return "Single GPU";
  if (gpus > 1 && nodes === 1) return "Multi-GPU Single Node";
  return "Multi-GPU Multi-Node";
}

// ── Token volume (PRD §17.9) ──────────────────────────────────────────────────

function calcTokenVolume(
  users: number,
  requestsPerUserPerDay: number,
  sequenceLength: number
): { daily: number; monthly: number; annual: number } {
  const daily = users * requestsPerUserPerDay * sequenceLength;
  return { daily, monthly: daily * 30, annual: daily * DAYS_PER_YEAR };
}

// ── Main sizing engine ────────────────────────────────────────────────────────

export function runSizingEngine(
  modelSelector: ModelSelectorOutput,
  classifier: ClassifierOutput,
  userCount: number,
  requestsPerUserPerDay: number,
  concurrentUsers: number
): SizingOutput {
  const m = modelSelector.selected_model;
  const sequenceLength = classifier.total_sequence_length;

  // Memory
  const weightsMemory = calcModelWeightsMemory(m.parameters_b, m.quantization_bytes);
  const kvCacheMemory = calcKvCacheMemory(
    concurrentUsers,
    sequenceLength,
    m.layers,
    m.kv_heads,
    m.head_dim,
    m.quantization_bytes
  );
  const totalMemory = weightsMemory + kvCacheMemory + RUNTIME_OVERHEAD_GB;

  // GPU selection
  const gpu = recommendGpu(totalMemory, classifier.workload_pattern);
  const effectiveMemory = getEffectiveMemory(gpu);
  const gpusRequired = ceilDiv(totalMemory, effectiveMemory);
  const nodesRequired = ceilDiv(gpusRequired, gpu.gpus_per_node);
  const availableMemory = gpusRequired * effectiveMemory;
  const headroom = availableMemory - totalMemory;

  // Deployment classification
  const deploymentClass = classifyDeployment(gpusRequired, nodesRequired);

  // Token volume
  const tokens = calcTokenVolume(userCount, requestsPerUserPerDay, sequenceLength);

  return {
    model_weights_memory_gb:   Math.round(weightsMemory * 100) / 100,
    kv_cache_memory_gb:        Math.round(kvCacheMemory * 100) / 100,
    runtime_overhead_gb:       RUNTIME_OVERHEAD_GB,
    total_gpu_memory_gb:       Math.round(totalMemory * 100) / 100,
    gpu_model:                 gpu.name,
    gpu_memory_gb:             gpu.memory_gb,
    gpu_utilization:           gpu.utilization_factor,
    effective_gpu_memory_gb:   Math.round(effectiveMemory * 100) / 100,
    gpus_required:             gpusRequired,
    nodes_required:            nodesRequired,
    gpus_per_node:             gpu.gpus_per_node,
    available_memory_gb:       Math.round(availableMemory * 100) / 100,
    memory_headroom_gb:        Math.round(headroom * 100) / 100,
    deployment_classification: deploymentClass,
    daily_token_volume:        tokens.daily,
    monthly_token_volume:      tokens.monthly,
    annual_token_volume:       tokens.annual,
  };
}
