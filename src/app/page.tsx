"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  AgentStage, PipelineState, PipelineResult,
  IntakeOutput, ClassifierOutput, ModelSelectorOutput,
  SizingOutput, DeploymentTcoOutput, RecommendationOutput,
} from "@/types/agents";
import { Session } from "@/lib/sessions";
import { AgentMetrics } from "@/lib/observability";

// ── Stage config ───────────────────────────────────────────────────────────────

const STAGES: { id: AgentStage; label: string; type: "llm" | "engine" }[] = [
  { id: "intake",         label: "Intake Agent",        type: "llm"    },
  { id: "classifier",     label: "Classifier",          type: "engine" },
  { id: "model_selector", label: "Model Selector",      type: "llm"    },
  { id: "sizing",         label: "Sizing Engine",       type: "engine" },
  { id: "deployment_tco", label: "Deployment + TCO",    type: "llm"    },
  { id: "recommendation", label: "Recommendation",      type: "llm"    },
];

const STAGE_COLOR: Record<AgentStage, { badge: string; border: string; dot: string }> = {
  intake:         { badge: "bg-blue-100 text-blue-700",   border: "border-l-blue-400",   dot: "bg-blue-400"   },
  classifier:     { badge: "bg-sky-100 text-sky-700",     border: "border-l-sky-400",    dot: "bg-sky-400"    },
  model_selector: { badge: "bg-violet-100 text-violet-700", border: "border-l-violet-400", dot: "bg-violet-400" },
  sizing:         { badge: "bg-cyan-100 text-cyan-700",   border: "border-l-cyan-400",   dot: "bg-cyan-400"   },
  deployment_tco: { badge: "bg-emerald-100 text-emerald-700", border: "border-l-emerald-400", dot: "bg-emerald-400" },
  recommendation: { badge: "bg-orange-100 text-orange-700", border: "border-l-orange-400",  dot: "bg-orange-400" },
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmt(n: number) { return n.toLocaleString("en-IN"); }
function fmtUsd(n: number) { return `$${fmt(Math.round(n))}`; }

// ── Small UI primitives ────────────────────────────────────────────────────────

function KV({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{label}</span>
      <span className="text-sm text-zinc-800">{String(value)}</span>
    </div>
  );
}

function Pill({ text, color = "zinc" }: { text: string; color?: string }) {
  const map: Record<string, string> = {
    green: "bg-green-100 text-green-700", red: "bg-red-100 text-red-700",
    blue: "bg-blue-100 text-blue-700", zinc: "bg-zinc-100 text-zinc-600",
    orange: "bg-orange-100 text-orange-700", violet: "bg-violet-100 text-violet-700",
    amber: "bg-amber-100 text-amber-700",
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[color] ?? map.zinc}`}>{text}</span>;
}

function ScoreBar({ score, status }: { score: number; status: string }) {
  const color = score >= 90 ? "bg-green-500" : score >= 70 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-zinc-500">{status}</span>
        <span className="font-mono font-semibold text-zinc-700">{score}%</span>
      </div>
      <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

// ── Stage output cards ─────────────────────────────────────────────────────────

function IntakeCard({ data }: { data: IntakeOutput }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <KV label="Industry" value={data.industry} />
        <KV label="Use Case" value={data.use_case} />
        <KV label="Primary Goal" value={data.primary_goal} />
        <KV label="Lifecycle" value={data.lifecycle_stage} />
        <KV label="Users" value={fmt(data.user_count)} />
        <KV label="Req / User / Day" value={fmt(data.requests_per_user_per_day)} />
        <KV label="Concurrent Users" value={fmt(data.concurrent_users)} />
        <KV label="Latency Target" value={`${data.latency_requirement_ms} ms`} />
        <KV label="Data Volume" value={`${fmt(data.data_volume_gb)} GB`} />
        <KV label="Budget" value={`$${fmt(data.budget_usd_month)} / mo`} />
        <KV label="Data Sensitivity" value={data.data_sensitivity} />
        <KV label="Deployment Pref" value={data.deployment_preference} />
      </div>
      {data.compliance.length > 0 && (
        <div>
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Compliance</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {data.compliance.map((c, i) => <Pill key={i} text={c} color="red" />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ClassifierCard({ data }: { data: ClassifierOutput }) {
  const riskColor = data.data_risk === "High" ? "red" : data.data_risk === "Medium" ? "amber" : "green";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <KV label="Workload Pattern" value={data.workload_pattern} />
        <KV label="AI Technique" value={data.ai_technique} />
        <KV label="Data Risk" value={data.data_risk} />
        <KV label="Volume Category" value={data.data_volume_category} />
        <KV label="Hosting Preference" value={data.hosting_preference} />
        <KV label="Sequence Length" value={`${fmt(data.total_sequence_length)} tokens`} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {data.rag_required && <Pill text="RAG Required" color="violet" />}
        {data.embedding_required && <Pill text="Embeddings" color="blue" />}
        {data.fine_tuning_required && <Pill text="Fine-tuning" color="orange" />}
        <Pill text={`Data Risk: ${data.data_risk}`} color={riskColor} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Requirement Completeness</p>
          <ScoreBar score={data.completeness_score} status={data.completeness_status} />
        </div>
        <div>
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Data Readiness</p>
          <ScoreBar score={data.data_readiness_score} status={data.data_readiness_status} />
        </div>
      </div>
      {data.missing_fields.length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
          <p className="text-xs font-semibold text-amber-700 mb-1">Missing Fields</p>
          <div className="flex flex-wrap gap-1">
            {data.missing_fields.map((f, i) => <Pill key={i} text={f} color="amber" />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelSelectorCard({ data }: { data: ModelSelectorOutput }) {
  const m = data.selected_model;
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-violet-50 border border-violet-200 p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm font-bold text-violet-900">{m.name}</p>
          <div className="flex gap-1.5">
            <Pill text={`${m.parameters_b}B params`} color="violet" />
            <Pill text={data.precision} color="blue" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div><p className="text-zinc-400 mb-0.5">Context</p><p className="font-mono font-semibold">{fmt(m.context_length)}</p></div>
          <div><p className="text-zinc-400 mb-0.5">Layers</p><p className="font-mono font-semibold">{m.layers}</p></div>
          <div><p className="text-zinc-400 mb-0.5">KV Heads</p><p className="font-mono font-semibold">{m.kv_heads}</p></div>
          <div><p className="text-zinc-400 mb-0.5">Head Dim</p><p className="font-mono font-semibold">{m.head_dim}</p></div>
          <div><p className="text-zinc-400 mb-0.5">License</p><p className="font-mono font-semibold">{m.license}</p></div>
          <div><p className="text-zinc-400 mb-0.5">Deployment</p><p className="font-mono font-semibold">{m.deployment_type}</p></div>
        </div>
      </div>
      <KV label="AI Technique" value={data.ai_technique} />
      <KV label="Hosting Preference" value={data.hosting_preference} />
      <KV label="Selection Rationale" value={data.selection_rationale} />
      {!data.context_window_valid && data.context_window_warning && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
          ⚠ {data.context_window_warning}
        </div>
      )}
      <div>
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Retrieved Candidates (RAG)</p>
        <div className="flex flex-wrap gap-1">
          {data.retrieved_models.map((r, i) => (
            <Pill key={i} text={`${r.name} (${r.parameters_b}B)`} color={r.model_id === m.model_id ? "violet" : "zinc"} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SizingCard({ data }: { data: SizingOutput }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-cyan-50 border border-cyan-200 p-3 text-center">
          <p className="text-xs text-cyan-500 font-medium mb-1">Total Memory</p>
          <p className="text-xl font-bold text-cyan-700 font-mono">{data.total_gpu_memory_gb} <span className="text-sm">GB</span></p>
        </div>
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-center">
          <p className="text-xs text-blue-500 font-medium mb-1">GPUs Required</p>
          <p className="text-xl font-bold text-blue-700 font-mono">{data.gpus_required}</p>
        </div>
        <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-3 text-center">
          <p className="text-xs text-indigo-500 font-medium mb-1">Nodes</p>
          <p className="text-xl font-bold text-indigo-700 font-mono">{data.nodes_required}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <KV label="GPU Model" value={data.gpu_model} />
        <KV label="Deployment Class" value={data.deployment_classification} />
        <KV label="Weights Memory" value={`${data.model_weights_memory_gb} GB`} />
        <KV label="KV Cache Memory" value={`${data.kv_cache_memory_gb} GB`} />
        <KV label="Available Memory" value={`${data.available_memory_gb} GB`} />
        <KV label="Headroom" value={`${data.memory_headroom_gb} GB`} />
      </div>
      <div className="rounded-xl border border-zinc-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead><tr className="bg-zinc-50 border-b"><th className="text-left px-3 py-2 text-zinc-500 font-medium">Token Volume</th><th className="text-right px-3 py-2 text-zinc-500 font-medium">Count</th></tr></thead>
          <tbody>
            <tr className="border-b border-zinc-100"><td className="px-3 py-2 text-zinc-700">Daily</td><td className="px-3 py-2 text-right font-mono">{fmt(data.daily_token_volume)}</td></tr>
            <tr className="border-b border-zinc-100"><td className="px-3 py-2 text-zinc-700">Monthly</td><td className="px-3 py-2 text-right font-mono">{fmt(data.monthly_token_volume)}</td></tr>
            <tr><td className="px-3 py-2 text-zinc-700">Annual</td><td className="px-3 py-2 text-right font-mono">{fmt(data.annual_token_volume)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CostTable({ rows, col1Label = "Year 1", col2Label = "Year 3" }: { rows: DeploymentTcoOutput["cost_rows"]; col1Label?: string; col2Label?: string }) {
  if (!rows?.length) return null;
  const total1 = rows.reduce((s, r) => s + r.year1_usd, 0);
  const total2 = rows.reduce((s, r) => s + r.year3_usd, 0);
  return (
    <div className="rounded-xl border border-zinc-200 overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-zinc-50 border-b">
            <th className="text-left px-3 py-2 text-zinc-500 font-medium">Cost Element</th>
            <th className="text-right px-3 py-2 text-zinc-500 font-medium">{col1Label}</th>
            <th className="text-right px-3 py-2 text-zinc-500 font-medium">{col2Label}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
              <td className="px-3 py-2 text-zinc-700">{row.category}</td>
              <td className="px-3 py-2 text-right font-mono text-zinc-800">{fmtUsd(row.year1_usd)}</td>
              <td className="px-3 py-2 text-right font-mono text-zinc-800">{fmtUsd(row.year3_usd)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-zinc-100 border-t border-zinc-200 font-semibold">
            <td className="px-3 py-2 text-zinc-700">Total</td>
            <td className="px-3 py-2 text-right font-mono text-zinc-900">{fmtUsd(total1)}</td>
            <td className="px-3 py-2 text-right font-mono text-zinc-900">{fmtUsd(total2)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function DeploymentTcoCard({ data }: { data: DeploymentTcoOutput }) {
  const [mainTab, setMainTab] = useState<"cloud" | "onprem">("cloud");
  const [cloudSub, setCloudSub] = useState<"payg" | "1yr" | "3yr">("1yr");
  const [onpremSub, setOnpremSub] = useState<"1yr" | "3yr">("1yr");

  const cloudTabs = [
    { id: "payg" as const, label: "Pay-as-you-go", year1: data.cloud_payg_year1_usd ?? data.cloud_year1_usd, year3: data.cloud_payg_year3_usd ?? data.cloud_year3_usd, rows: data.cloud_cost_rows_payg ?? data.cost_rows },
    { id: "1yr"  as const, label: "1-Year Reserved", year1: data.cloud_year1_usd, year3: data.cloud_year3_usd, rows: data.cloud_cost_rows_1yr ?? data.cost_rows },
    { id: "3yr"  as const, label: "3-Year Reserved", year1: data.cloud_3yr_year1_usd ?? data.cloud_year1_usd, year3: data.cloud_3yr_total_usd ?? data.cloud_year3_usd, rows: data.cloud_cost_rows_3yr ?? data.cost_rows },
  ];
  const onpremTabs = [
    { id: "1yr" as const, label: "1-Year",  year1: data.onprem_year1_usd, year3: data.onprem_year1_usd, rows: data.onprem_cost_rows ?? data.cost_rows },
    { id: "3yr" as const, label: "3-Year",  year1: data.onprem_year3_usd, year3: data.onprem_year3_usd, rows: data.onprem_cost_rows ?? data.cost_rows },
  ];

  const activeCloud  = cloudTabs.find((t) => t.id === cloudSub)!;
  const activeOnprem = onpremTabs.find((t) => t.id === onpremSub)!;

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-zinc-50 border p-2"><p className="text-zinc-400 mb-0.5">Yr1 Lower Cost</p><p className="font-semibold">{data.lower_cost_year1}</p></div>
        <div className="rounded-lg bg-zinc-50 border p-2"><p className="text-zinc-400 mb-0.5">3yr Lower Cost</p><p className="font-semibold">{data.lower_cost_year3}</p></div>
        <div className="rounded-lg bg-zinc-50 border p-2"><p className="text-zinc-400 mb-0.5">Break-even</p><p className="font-semibold">{data.breakeven_month ? `Mo ${data.breakeven_month}` : "None <36mo"}</p></div>
      </div>

      {/* Main tabs: Cloud | On-Prem */}
      <div className="flex gap-1 rounded-xl bg-zinc-100 p-1">
        <button
          onClick={() => setMainTab("cloud")}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all ${mainTab === "cloud" ? "bg-white shadow text-emerald-700" : "text-zinc-500 hover:text-zinc-700"}`}
        >
          ☁ Cloud (Azure)
        </button>
        <button
          onClick={() => setMainTab("onprem")}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all ${mainTab === "onprem" ? "bg-white shadow text-slate-700" : "text-zinc-500 hover:text-zinc-700"}`}
        >
          🏢 On-Prem
        </button>
      </div>

      {/* Cloud panel */}
      {mainTab === "cloud" && (
        <div className="space-y-3">
          {/* Cloud sub-tabs */}
          <div className="flex gap-1.5">
            {cloudTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setCloudSub(t.id)}
                className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-all ${cloudSub === t.id ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "border-zinc-200 text-zinc-500 hover:border-zinc-300"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Active cloud term summary */}
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex justify-between items-center">
            <div>
              <p className="text-xs text-emerald-600 font-medium mb-1">{activeCloud.label}</p>
              <p className="text-xl font-bold text-emerald-700">{fmtUsd(activeCloud.year1)} <span className="text-xs font-normal">year 1</span></p>
              <p className="text-sm text-emerald-600 mt-0.5">{fmtUsd(activeCloud.year3)} <span className="text-xs">3-year total</span></p>
            </div>
            <div className="text-right text-xs text-emerald-500">
              <p>${data.cost_per_1m_tokens_cloud}</p>
              <p>per 1M tokens</p>
            </div>
          </div>

          {/* Cloud cost breakdown */}
          <CostTable rows={activeCloud.rows} col1Label="Year 1 Cost" col2Label="3-Year Cost" />
        </div>
      )}

      {/* On-Prem panel */}
      {mainTab === "onprem" && (
        <div className="space-y-3">
          {/* On-Prem sub-tabs */}
          <div className="flex gap-1.5">
            {onpremTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setOnpremSub(t.id)}
                className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-all ${onpremSub === t.id ? "bg-slate-100 border-slate-300 text-slate-700" : "border-zinc-200 text-zinc-500 hover:border-zinc-300"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Active on-prem term summary */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-600 font-medium mb-1">On-Prem · {activeOnprem.label}</p>
              <p className="text-xl font-bold text-slate-700">{fmtUsd(activeOnprem.year1)} <span className="text-xs font-normal">{onpremSub === "1yr" ? "year 1 total" : "3-year total"}</span></p>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>${data.cost_per_1m_tokens_onprem}</p>
              <p>per 1M tokens</p>
            </div>
          </div>

          {/* On-prem cost breakdown — show year1 or year3 col depending on sub-tab */}
          {(activeOnprem.rows?.length > 0) && (
            <div className="rounded-xl border border-zinc-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-zinc-50 border-b">
                    <th className="text-left px-3 py-2 text-zinc-500 font-medium">Cost Element</th>
                    <th className="text-right px-3 py-2 text-zinc-500 font-medium">{onpremSub === "1yr" ? "Year 1 Cost" : "3-Year Cost"}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeOnprem.rows.map((row, i) => (
                    <tr key={i} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                      <td className="px-3 py-2 text-zinc-700">{row.category}</td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-800">{fmtUsd(onpremSub === "1yr" ? row.year1_usd : row.year3_usd)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-zinc-100 border-t border-zinc-200 font-semibold">
                    <td className="px-3 py-2 text-zinc-700">Total</td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-900">{fmtUsd(onpremSub === "1yr" ? data.onprem_year1_usd : data.onprem_year3_usd)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      <KV label="Architecture" value={data.architecture_type} />
      <KV label="Deployment Model" value={data.deployment_model} />
    </div>
  );
}

function RecommendationCard({ data }: { data: RecommendationOutput }) {
  const confColor = data.confidence === "High" ? "green" : data.confidence === "Medium" ? "amber" : "red";
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-orange-50 border border-orange-300 p-4 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm font-bold text-orange-900">{data.final_recommendation}</p>
          <div className="flex gap-1.5">
            <Pill text={`Confidence: ${data.confidence}`} color={confColor} />
            {data.compliance_override && <Pill text="Compliance Override" color="red" />}
          </div>
        </div>
        <p className="text-xs text-orange-700">{data.confidence_rationale}</p>
      </div>
      <div className="rounded-xl bg-zinc-50 border p-3">
        <p className="text-xs font-semibold text-zinc-500 mb-1 uppercase tracking-wider">Engagement Type</p>
        <p className="text-sm font-semibold text-zinc-800">{data.engagement_type}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Rationale</p>
        <p className="text-sm text-zinc-700 leading-relaxed">{data.rationale}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Executive Summary</p>
        <p className="text-sm text-zinc-700 leading-relaxed italic">{data.executive_summary}</p>
      </div>
      {data.risks?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Risks</p>
          <ul className="space-y-1">{data.risks.map((r, i) => <li key={i} className="text-xs text-zinc-600 flex gap-2"><span className="text-red-400">▪</span>{r}</li>)}</ul>
        </div>
      )}
      {data.next_steps?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Next Steps</p>
          <ul className="space-y-1">{data.next_steps.map((s, i) => <li key={i} className="text-xs text-zinc-600 flex gap-2"><span className="text-emerald-500">→</span>{s}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

// ── Executive Dashboard ────────────────────────────────────────────────────────

function ExecDashboard({ pipeline }: { pipeline: PipelineResult }) {
  const intake     = pipeline.intake.output as IntakeOutput;
  const classifier = pipeline.classifier.output as ClassifierOutput;
  const model      = pipeline.model_selector.output as ModelSelectorOutput;
  const sizing     = pipeline.sizing.output as SizingOutput;
  const tco        = pipeline.deployment_tco.output as DeploymentTcoOutput;
  const rec        = pipeline.recommendation.output as RecommendationOutput;
  const confColor  = rec.confidence === "High" ? "text-green-600" : rec.confidence === "Medium" ? "text-amber-600" : "text-red-600";

  return (
    <div className="rounded-2xl bg-zinc-900 text-white overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-800">
        <p className="text-xs font-mono text-zinc-400 uppercase tracking-widest mb-1">Executive Dashboard</p>
        <p className="text-lg font-bold">{intake.use_case}</p>
        <p className="text-xs text-zinc-400">{intake.industry} · {intake.lifecycle_stage}</p>
      </div>
      <div className="grid grid-cols-3 divide-x divide-zinc-800">
        {/* Business */}
        <div className="p-5 space-y-3">
          <p className="text-xs font-mono text-violet-400 uppercase tracking-widest">Business</p>
          <div><p className="text-xs text-zinc-500">Workload</p><p className="text-sm font-semibold">{classifier.workload_pattern}</p></div>
          <div><p className="text-xs text-zinc-500">AI Technique</p><p className="text-sm">{classifier.ai_technique}</p></div>
          <div><p className="text-xs text-zinc-500">Model</p><p className="text-sm font-semibold">{model.selected_model.name}</p></div>
          <div>
            <p className="text-xs text-zinc-500 mb-1">Completeness</p>
            <div className="h-1 bg-zinc-700 rounded-full"><div className="h-full bg-violet-400 rounded-full" style={{ width: `${classifier.completeness_score}%` }} /></div>
            <p className="text-xs text-zinc-400 mt-0.5">{classifier.completeness_score}% · {classifier.completeness_status}</p>
          </div>
        </div>
        {/* Technical */}
        <div className="p-5 space-y-3">
          <p className="text-xs font-mono text-sky-400 uppercase tracking-widest">Technical</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-zinc-800 p-2"><p className="text-xs text-zinc-500">GPUs</p><p className="text-lg font-bold font-mono">{sizing.gpus_required}</p></div>
            <div className="rounded-lg bg-zinc-800 p-2"><p className="text-xs text-zinc-500">Nodes</p><p className="text-lg font-bold font-mono">{sizing.nodes_required}</p></div>
            <div className="rounded-lg bg-zinc-800 p-2"><p className="text-xs text-zinc-500">Memory</p><p className="text-sm font-bold font-mono">{sizing.total_gpu_memory_gb}<span className="text-xs font-normal">GB</span></p></div>
          </div>
          <div><p className="text-xs text-zinc-500">GPU Model</p><p className="text-sm">{sizing.gpu_model}</p></div>
          <div><p className="text-xs text-zinc-500">Architecture</p><p className="text-sm">{sizing.deployment_classification}</p></div>
          <div><p className="text-xs text-zinc-500">Data Risk</p><p className={`text-sm font-semibold ${classifier.data_risk === "High" ? "text-red-400" : classifier.data_risk === "Medium" ? "text-amber-400" : "text-green-400"}`}>{classifier.data_risk}</p></div>
        </div>
        {/* Commercial */}
        <div className="p-5 space-y-3">
          <p className="text-xs font-mono text-amber-400 uppercase tracking-widest">Commercial</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-zinc-800 p-2"><p className="text-xs text-zinc-500">Cloud 1yr</p><p className="text-sm font-bold font-mono text-emerald-400">{fmtUsd(tco.cloud_year1_usd)}</p></div>
            <div className="rounded-lg bg-zinc-800 p-2"><p className="text-xs text-zinc-500">On-Prem 1yr</p><p className="text-sm font-bold font-mono text-slate-300">{fmtUsd(tco.onprem_year1_usd)}</p></div>
            <div className="rounded-lg bg-zinc-800 p-2"><p className="text-xs text-zinc-500">Cloud 3yr</p><p className="text-sm font-bold font-mono text-emerald-400">{fmtUsd(tco.cloud_year3_usd)}</p></div>
            <div className="rounded-lg bg-zinc-800 p-2"><p className="text-xs text-zinc-500">On-Prem 3yr</p><p className="text-sm font-bold font-mono text-slate-300">{fmtUsd(tco.onprem_year3_usd)}</p></div>
          </div>
          <div><p className="text-xs text-zinc-500">Final Recommendation</p><p className="text-sm font-bold text-orange-300">{rec.final_recommendation}</p></div>
          <div><p className="text-xs text-zinc-500">Confidence</p><p className={`text-sm font-semibold ${confColor}`}>{rec.confidence}</p></div>
          <div><p className="text-xs text-zinc-500">Engagement</p><p className="text-xs text-zinc-300">{rec.engagement_type}</p></div>
        </div>
      </div>
    </div>
  );
}

// ── Stage output dispatcher ────────────────────────────────────────────────────

function StageOutputCard({ stage, raw }: { stage: AgentStage; raw: string }) {
  try {
    const data = JSON.parse(raw);
    if (stage === "intake")         return <IntakeCard data={data as IntakeOutput} />;
    if (stage === "classifier")     return <ClassifierCard data={data as ClassifierOutput} />;
    if (stage === "model_selector") return <ModelSelectorCard data={data as ModelSelectorOutput} />;
    if (stage === "sizing")         return <SizingCard data={data as SizingOutput} />;
    if (stage === "deployment_tco") return <DeploymentTcoCard data={data as DeploymentTcoOutput} />;
    if (stage === "recommendation") return <RecommendationCard data={data as RecommendationOutput} />;
  } catch {}
  return <pre className="text-xs text-zinc-600 whitespace-pre-wrap">{raw}</pre>;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [requirement, setRequirement] = useState("");
  const [pipelineState, setPipelineState] = useState<PipelineState>({ status: "idle", currentStage: null });
  const [stageRaw, setStageRaw] = useState<Partial<Record<AgentStage, string>>>({});
  const [stageMetrics, setStageMetrics] = useState<Partial<Record<AgentStage, AgentMetrics>>>({});
  const [completedPipeline, setCompletedPipeline] = useState<PipelineResult | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedStage, setExpandedStage] = useState<AgentStage | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) setSessions(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchSessions();
    const id = setInterval(fetchSessions, 5000);
    return () => clearInterval(id);
  }, [fetchSessions]);

  const loadSession = async (sessionId: string) => {
    const res = await fetch(`/api/sessions?id=${sessionId}`);
    if (!res.ok) return;
    const s = await res.json();
    setRequirement(s.requirement);
    try {
      const p: PipelineResult = JSON.parse(s.pipeline_json);
      setCompletedPipeline(p);
      const raw: Partial<Record<AgentStage, string>> = {};
      (Object.keys(p) as AgentStage[]).forEach((k) => { raw[k] = p[k]?.raw ?? ""; });
      setStageRaw(raw);
    } catch {}
    setPipelineState({ status: "completed", currentStage: null });
  };

  const runPipeline = async () => {
    if (!requirement.trim()) return;
    abortRef.current = new AbortController();
    setStageRaw({});
    setStageMetrics({});
    setCompletedPipeline(null);
    setPipelineState({ status: "running", currentStage: null });

    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirement }),
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) throw new Error("Pipeline request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));
          if (data.type === "stage_start") {
            setPipelineState((p) => ({ ...p, currentStage: data.stage }));
          } else if (data.type === "stage_done") {
            setStageRaw((p) => ({ ...p, [data.stage]: data.raw }));
            if (data.metrics) setStageMetrics((p) => ({ ...p, [data.stage]: data.metrics }));
            setPipelineState((p) => ({ ...p, currentStage: null }));
          } else if (data.type === "done") {
            setPipelineState({ status: "completed", currentStage: null });
            if (data.pipeline) {
              const p = data.pipeline as PipelineResult;
              setCompletedPipeline(p);
              const raw: Partial<Record<AgentStage, string>> = {};
              (Object.keys(p) as AgentStage[]).forEach((k) => { raw[k] = p[k]?.raw ?? "{}"; });
              setStageRaw(raw);
              setExpandedStage("recommendation");
            }
            fetchSessions();
          } else if (data.type === "error") {
            setPipelineState({ status: "error", currentStage: null, error: data.message });
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setPipelineState({ status: "error", currentStage: null, error: String(err) });
      }
    }
  };

  const isRunning = pipelineState.status === "running";
  const hasResults = Object.keys(stageRaw).length > 0;

  return (
    <div className="min-h-screen bg-zinc-50 font-sans flex flex-col">
      <header className="border-b border-zinc-200 bg-white px-6 py-4 flex items-center gap-4 shrink-0">
        <button onClick={() => setSidebarOpen((o) => !o)} className="text-zinc-400 hover:text-zinc-600">☰</button>
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Agentic Advisor</h1>
          <p className="text-xs text-zinc-400">4 LLM agents · 2 code engines · RAG model selection · Azure TCO</p>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <aside className="w-64 shrink-0 border-r border-zinc-200 bg-white flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">History</span>
              <button onClick={() => { setRequirement(""); setStageRaw({}); setCompletedPipeline(null); setPipelineState({ status: "idle", currentStage: null }); }} className="text-xs text-blue-600 font-medium">+ New</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sessions.length === 0 && <p className="text-xs text-zinc-400 px-4 py-6 text-center">No sessions yet</p>}
              {sessions.map((s) => (
                <button key={s.id} onClick={() => loadSession(s.id)} className="w-full text-left px-4 py-3 border-b border-zinc-100 hover:bg-zinc-50">
                  <p className="text-xs font-medium text-zinc-800 line-clamp-2">{s.requirement}</p>
                  <p className="text-xs text-zinc-400 mt-1" suppressHydrationWarning>{timeAgo(s.created_at)}</p>
                </button>
              ))}
            </div>
          </aside>
        )}

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

            {/* Input */}
            <div className="bg-white rounded-2xl border border-zinc-200 p-6 space-y-4">
              <label className="block text-sm font-medium text-zinc-700">Describe your business requirement</label>
              <textarea
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-900 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={4}
                placeholder="e.g. Build a healthcare claims copilot for 600 internal users. PII/PHI data, need <2s latency, $5k/month budget, 3 engineers, on Azure. Looking at production deployment."
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
                disabled={isRunning}
              />
              <button
                onClick={runPipeline}
                disabled={isRunning || !requirement.trim()}
                className="w-full rounded-xl bg-zinc-900 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 text-sm transition-colors"
              >
                {isRunning ? "Running pipeline..." : "Run Advisory Pipeline"}
              </button>
            </div>

            {/* Pipeline tracker + expandable stage details */}
            {(isRunning || hasResults) && (
              <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
                {/* Stage pills row */}
                <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-zinc-100">
                  {STAGES.map((s, i) => {
                    const isDone = !!stageRaw[s.id];
                    const isCurrent = pipelineState.currentStage === s.id;
                    const isExpanded = expandedStage === s.id;
                    const c = STAGE_COLOR[s.id];
                    return (
                      <div key={s.id} className="flex items-center gap-1.5">
                        <button
                          onClick={() => isDone && setExpandedStage(isExpanded ? null : s.id)}
                          disabled={!isDone}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
                            isExpanded ? `${c.badge} border-current ring-2 ring-offset-1 ring-current` :
                            isDone ? `${c.badge} border-transparent hover:ring-1 hover:ring-current hover:ring-offset-1 cursor-pointer` :
                            isCurrent ? "bg-white border-zinc-300 text-zinc-600 animate-pulse cursor-default" :
                            "bg-zinc-50 border-zinc-200 text-zinc-300 cursor-default"
                          }`}
                        >
                          {s.type === "engine" && <span className="opacity-60">[⚙]</span>}
                          {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                          {isDone && <span>✓</span>}
                          {s.label}
                          {isDone && <span className="opacity-50">{isExpanded ? "▲" : "▼"}</span>}
                        </button>
                        {i < STAGES.length - 1 && <span className="text-zinc-300 text-xs">›</span>}
                      </div>
                    );
                  })}
                </div>

                {/* Expanded stage panel */}
                {expandedStage && stageRaw[expandedStage] && (() => {
                  const s = STAGES.find((x) => x.id === expandedStage)!;
                  const raw = stageRaw[expandedStage]!;
                  const m = stageMetrics[expandedStage];
                  const c = STAGE_COLOR[expandedStage];
                  return (
                    <div className={`border-l-4 ${c.border} p-5 space-y-4`}>
                      {/* Header row with metadata chips */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.badge}`}>{s.label}</span>
                        <span className="text-xs text-zinc-400 font-mono">{s.type === "engine" ? "code engine" : "LLM"}</span>
                        {m && (
                          <>
                            <span className="text-xs bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full font-mono">{(m.latency_ms / 1000).toFixed(1)}s</span>
                            <span className="text-xs bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full font-mono">{(m.input_tokens + m.output_tokens).toLocaleString()} tok</span>
                            {m.cost_usd > 0 && <span className="text-xs bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full font-mono">${m.cost_usd.toFixed(5)}</span>}
                            <span className="text-xs bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full font-mono">{m.model}</span>
                          </>
                        )}
                      </div>
                      <StageOutputCard stage={expandedStage} raw={raw} />
                    </div>
                  );
                })()}

                {/* Spinner when a stage is actively running */}
                {pipelineState.currentStage && !stageRaw[pipelineState.currentStage] && (
                  <div className="flex items-center gap-2 px-5 py-4 text-sm text-zinc-400 border-t border-zinc-100">
                    <div className="w-4 h-4 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin shrink-0" />
                    Running {STAGES.find((x) => x.id === pipelineState.currentStage)?.label}…
                  </div>
                )}
              </div>
            )}

            {/* Executive Dashboard */}
            {pipelineState.status === "completed" && completedPipeline && (
              <ExecDashboard pipeline={completedPipeline} />
            )}

            {pipelineState.status === "error" && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="text-red-400 text-lg leading-none">⚠</span>
                  <div>
                    <p className="text-sm font-semibold text-red-700">Pipeline failed</p>
                    <p className="text-xs text-red-500 mt-0.5">{pipelineState.error}</p>
                    <p className="text-xs text-red-400 mt-1">This is usually a transient Groq API rate-limit. Wait 5–10 seconds and retry.</p>
                  </div>
                </div>
                <button
                  onClick={runPipeline}
                  className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg transition-colors"
                >
                  Retry pipeline
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
