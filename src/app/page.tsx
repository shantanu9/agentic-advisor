"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  AgentType, PipelineState,
  DiscoveryOutput, WorkloadOutput, DeploymentOutput, TcoOutput,
} from "@/types/agents";
import { Session } from "@/lib/sessions";

const AGENT_LABELS: Record<AgentType, string> = {
  discovery: "Discovery Agent",
  workload: "Workload Profiling Agent",
  deployment: "Deployment Options Agent",
  tco: "TCO Agent",
};

const AGENT_ORDER: AgentType[] = ["discovery", "workload", "deployment", "tco"];

const AGENT_BADGE: Record<AgentType, string> = {
  discovery: "bg-blue-100 text-blue-700",
  workload: "bg-purple-100 text-purple-700",
  deployment: "bg-green-100 text-green-700",
  tco: "bg-orange-100 text-orange-700",
};

const AGENT_BORDER: Record<AgentType, string> = {
  discovery: "border-l-blue-400",
  workload: "border-l-purple-400",
  deployment: "border-l-green-400",
  tco: "border-l-orange-400",
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

function tryParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()) as T;
  } catch { return null; }
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{label}</span>
      <span className="text-sm text-zinc-800">{value}</span>
    </div>
  );
}

function Pill({ text, color = "zinc" }: { text: string; color?: string }) {
  const colors: Record<string, string> = {
    green: "bg-green-100 text-green-700",
    red: "bg-red-100 text-red-700",
    blue: "bg-blue-100 text-blue-700",
    zinc: "bg-zinc-100 text-zinc-600",
    orange: "bg-orange-100 text-orange-700",
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[color] ?? colors.zinc}`}>{text}</span>;
}

// ── Agent output renderers ─────────────────────────────────────────────────────

function DiscoveryCard({ data }: { data: DiscoveryOutput }) {
  return (
    <div className="space-y-4">
      <KV label="Use Case" value={data.use_case} />
      <div className="grid grid-cols-2 gap-3">
        <KV label="Data Type" value={data.data.type} />
        <KV label="Volume" value={data.data.volume} />
        <KV label="Format" value={data.data.format} />
        <KV label="Users" value={data.scale.users} />
        <KV label="Requests/sec" value={data.scale.requests_per_sec} />
        <KV label="Latency Tolerance" value={data.scale.latency_tolerance} />
        <KV label="Budget" value={data.constraints.budget} />
        <KV label="Timeline" value={data.constraints.timeline} />
        <KV label="Team Size" value={data.constraints.team_size} />
        <KV label="Regulatory" value={data.constraints.regulatory} />
      </div>
      <div>
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Success Metrics</span>
        <div className="flex flex-wrap gap-2 mt-1">
          {data.success_metrics.map((m, i) => <Pill key={i} text={m} color="blue" />)}
        </div>
      </div>
    </div>
  );
}

function WorkloadCard({ data }: { data: WorkloadOutput }) {
  const intensityColor: Record<string, string> = { Low: "green", Medium: "zinc", High: "orange", Extreme: "red" };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Pill text={data.primary_type} color="blue" />
        <Pill text={`Compute: ${data.compute_intensity}`} color={intensityColor[data.compute_intensity]} />
        <Pill text={data.latency_class} color="zinc" />
        <Pill text={`Model: ${data.model_size_recommendation}`} color="orange" />
        {data.data_pipeline_needed && <Pill text="Data Pipeline Needed" color="red" />}
      </div>
      <KV label="Memory Requirement" value={data.memory_requirement} />
      <KV label="Reasoning" value={data.reasoning} />
    </div>
  );
}

function DeploymentCard({ data }: { data: DeploymentOutput }) {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {data.options.map((opt, i) => (
          <div key={i} className={`rounded-xl border p-4 space-y-2 ${opt.option === data.recommended ? "border-green-400 bg-green-50" : "border-zinc-200 bg-white"}`}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-sm font-semibold text-zinc-800">{opt.option}</span>
              <div className="flex gap-2 items-center">
                <span className="text-xs text-zinc-500">{opt.estimated_cost_usd_month}</span>
                {opt.option === data.recommended && <Pill text="Recommended" color="green" />}
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {opt.provider_examples.map((p, j) => <Pill key={j} text={p} color="zinc" />)}
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="font-medium text-green-600 mb-1">Pros</p>
                <ul className="space-y-0.5 text-zinc-600">{opt.pros.map((p, j) => <li key={j}>+ {p}</li>)}</ul>
              </div>
              <div>
                <p className="font-medium text-red-500 mb-1">Cons</p>
                <ul className="space-y-0.5 text-zinc-600">{opt.cons.map((c, j) => <li key={j}>− {c}</li>)}</ul>
              </div>
            </div>
            <p className="text-xs text-zinc-500"><span className="font-medium">Best for:</span> {opt.best_for}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-green-50 border border-green-200 p-3">
        <p className="text-xs font-semibold text-green-700 mb-1">Why {data.recommended}?</p>
        <p className="text-xs text-green-800">{data.recommendation_reason}</p>
      </div>
      {data.gpu_specs_used?.length > 0 && (
        <div>
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">GPU Specs Referenced</span>
          <div className="flex flex-wrap gap-2 mt-1">
            {data.gpu_specs_used.map((g, i) => <Pill key={i} text={g} color="zinc" />)}
          </div>
        </div>
      )}
    </div>
  );
}

function TcoCard({ data }: { data: TcoOutput }) {
  const fmt = (n: number) => n.toLocaleString("en-IN");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-center">
          <p className="text-xs text-blue-500 font-medium mb-1">Year 1 Total</p>
          <p className="text-xl font-bold text-blue-700">${fmt(data.total_year1_usd)}</p>
          <p className="text-xs text-blue-500 mt-0.5">₹{fmt(data.total_year1_inr)}</p>
        </div>
        <div className="rounded-xl bg-purple-50 border border-purple-200 p-4 text-center">
          <p className="text-xs text-purple-500 font-medium mb-1">3-Year Total</p>
          <p className="text-xl font-bold text-purple-700">${fmt(data.total_year3_usd)}</p>
          <p className="text-xs text-purple-500 mt-0.5">₹{fmt(data.total_year3_inr)}</p>
        </div>
      </div>
      <div className="rounded-xl border border-zinc-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200">
              <th className="text-left px-3 py-2 font-medium text-zinc-500">Category</th>
              <th className="text-right px-3 py-2 font-medium text-zinc-500">Year 1 (USD)</th>
              <th className="text-right px-3 py-2 font-medium text-zinc-500">Year 3 (USD)</th>
            </tr>
          </thead>
          <tbody>
            {data.costs.map((row, i) => (
              <tr key={i} className="border-b border-zinc-100 last:border-0">
                <td className="px-3 py-2 text-zinc-700">{row.category}</td>
                <td className="px-3 py-2 text-right text-zinc-700">${fmt(row.year1_usd)}</td>
                <td className="px-3 py-2 text-right text-zinc-700">${fmt(row.year3_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl bg-orange-50 border border-orange-200 p-3">
        <p className="text-xs font-semibold text-orange-700 mb-1">Key Insight</p>
        <p className="text-xs text-orange-800">{data.key_insight}</p>
      </div>
      {data.assumptions?.length > 0 && (
        <div>
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Assumptions</span>
          <ul className="mt-1 space-y-0.5">
            {data.assumptions.map((a, i) => <li key={i} className="text-xs text-zinc-500">· {a}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function AgentOutputCard({ agent, raw }: { agent: AgentType; raw: string }) {
  if (agent === "discovery") {
    const data = tryParse<DiscoveryOutput>(raw);
    if (data) return <DiscoveryCard data={data} />;
  }
  if (agent === "workload") {
    const data = tryParse<WorkloadOutput>(raw);
    if (data) return <WorkloadCard data={data} />;
  }
  if (agent === "deployment") {
    const data = tryParse<DeploymentOutput>(raw);
    if (data) return <DeploymentCard data={data} />;
  }
  if (agent === "tco") {
    const data = tryParse<TcoOutput>(raw);
    if (data) return <TcoCard data={data} />;
  }
  return <pre className="text-xs text-zinc-600 whitespace-pre-wrap">{raw}</pre>;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [requirement, setRequirement] = useState("");
  const [pipeline, setPipeline] = useState<PipelineState>({ status: "idle", currentAgent: null, results: {} });
  const [agentRaw, setAgentRaw] = useState<Partial<Record<AgentType, string>>>({});
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSessions = useCallback(async () => {
    if (typeof window === "undefined") return;
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) setSessions(await res.json());
    } catch { /* ignore network errors during SSR */ }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const loadSession = async (id: string) => {
    const res = await fetch(`/api/sessions?id=${id}`);
    if (res.ok) {
      const s: Session = await res.json();
      setRequirement(s.requirement);
      setAgentRaw({ discovery: s.discovery, workload: s.workload, deployment: s.deployment, tco: s.tco });
      setPipeline({ status: "completed", currentAgent: null, results: {} });
    }
  };

  const runPipeline = async () => {
    if (!requirement.trim()) return;
    abortRef.current = new AbortController();
    setAgentRaw({});
    setPipeline({ status: "running", currentAgent: null, results: {} });

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
          if (data.type === "agent_start") {
            setPipeline((p) => ({ ...p, currentAgent: data.agent }));
          } else if (data.type === "chunk") {
            setAgentRaw((p) => ({ ...p, [data.agent]: (p[data.agent as AgentType] ?? "") + data.chunk }));
          } else if (data.type === "done") {
            setPipeline((p) => ({ ...p, status: "completed", currentAgent: null }));
            fetchSessions();
          } else if (data.type === "error") {
            setPipeline((p) => ({ ...p, status: "error", error: data.message, currentAgent: null }));
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setPipeline((p) => ({ ...p, status: "error", error: String(err), currentAgent: null }));
      }
    }
  };

  const isRunning = pipeline.status === "running";
  const hasResults = Object.keys(agentRaw).length > 0;

  return (
    <div className="min-h-screen bg-zinc-50 font-sans flex flex-col">
      <header className="border-b border-zinc-200 bg-white px-6 py-4 flex items-center gap-4 shrink-0">
        <button onClick={() => setSidebarOpen((o) => !o)} className="text-zinc-400 hover:text-zinc-600">☰</button>
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Agentic Advisor</h1>
          <p className="text-xs text-zinc-400">AI stack recommendations · 4 sequential agents · GPU knowledge base</p>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <aside className="w-64 shrink-0 border-r border-zinc-200 bg-white flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">History</span>
              <button onClick={() => { setRequirement(""); setAgentRaw({}); setPipeline({ status: "idle", currentAgent: null, results: {} }); }} className="text-xs text-blue-600 font-medium">+ New</button>
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
            <div className="bg-white rounded-2xl border border-zinc-200 p-6 space-y-4">
              <label className="block text-sm font-medium text-zinc-700">Describe your business requirement</label>
              <textarea
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-900 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={4}
                placeholder="e.g. Build a customer support chatbot for 10,000 daily queries in English and Hindi. Budget $2000/month, 2 developers, need <2s response time."
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
                disabled={isRunning}
              />
              <button
                onClick={runPipeline}
                disabled={isRunning || !requirement.trim()}
                className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 text-sm transition-colors"
              >
                {isRunning ? "Analyzing..." : "Run AI Advisory Pipeline"}
              </button>
            </div>

            {(isRunning || hasResults) && (
              <div className="flex flex-wrap items-center gap-2 text-xs px-1">
                {AGENT_ORDER.map((agent, i) => {
                  const isDone = !!agentRaw[agent];
                  const isCurrent = pipeline.currentAgent === agent;
                  return (
                    <div key={agent} className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded-full font-medium transition-all ${isDone ? AGENT_BADGE[agent] : isCurrent ? "bg-zinc-200 text-zinc-600 animate-pulse" : "bg-zinc-100 text-zinc-400"}`}>
                        {isDone ? "✓ " : ""}{AGENT_LABELS[agent]}
                      </span>
                      {i < AGENT_ORDER.length - 1 && <span className="text-zinc-300">→</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {AGENT_ORDER.map((agent) => {
              const raw = agentRaw[agent];
              const isCurrent = pipeline.currentAgent === agent;
              if (!raw && !isCurrent) return null;

              return (
                <div key={agent} className={`rounded-2xl border-l-4 border border-zinc-200 bg-white p-6 space-y-4 ${AGENT_BORDER[agent]}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${AGENT_BADGE[agent]}`}>{AGENT_LABELS[agent]}</span>
                    {isCurrent && <span className="text-xs text-zinc-400 animate-pulse">{raw ? "writing..." : "thinking..."}</span>}
                  </div>
                  {raw && (
                    isCurrent
                      ? <pre className="text-xs text-zinc-500 whitespace-pre-wrap font-mono">{raw}</pre>
                      : <AgentOutputCard agent={agent} raw={raw} />
                  )}
                </div>
              );
            })}

            {pipeline.status === "error" && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">Error: {pipeline.error}</div>
            )}
            {pipeline.status === "completed" && (
              <p className="text-center text-sm text-zinc-400 py-4">Advisory complete · saved to history</p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
