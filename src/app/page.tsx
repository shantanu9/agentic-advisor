"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { AgentType, PipelineState } from "@/types/agents";
import { Session } from "@/lib/sessions";

const AGENT_LABELS: Record<AgentType, string> = {
  discovery: "Discovery Agent",
  workload: "Workload Profiling Agent",
  deployment: "Deployment Options Agent",
  tco: "TCO Agent",
};

const AGENT_ORDER: AgentType[] = ["discovery", "workload", "deployment", "tco"];

const AGENT_COLORS: Record<AgentType, string> = {
  discovery: "border-l-blue-400 bg-blue-50 dark:bg-blue-950/30",
  workload: "border-l-purple-400 bg-purple-50 dark:bg-purple-950/30",
  deployment: "border-l-green-400 bg-green-50 dark:bg-green-950/30",
  tco: "border-l-orange-400 bg-orange-50 dark:bg-orange-950/30",
};

const AGENT_BADGE: Record<AgentType, string> = {
  discovery: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  workload: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  deployment: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  tco: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
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

export default function Home() {
  const [requirement, setRequirement] = useState("");
  const [pipeline, setPipeline] = useState<PipelineState>({
    status: "idle",
    currentAgent: null,
    results: {},
  });
  const [agentText, setAgentText] = useState<Partial<Record<AgentType, string>>>({});
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    if (res.ok) setSessions(await res.json());
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const loadSession = async (id: string) => {
    setLoadingSession(true);
    const res = await fetch(`/api/sessions?id=${id}`);
    if (res.ok) {
      const s: Session = await res.json();
      setRequirement(s.requirement);
      setAgentText({
        discovery: s.discovery,
        workload: s.workload,
        deployment: s.deployment,
        tco: s.tco,
      });
      setPipeline({ status: "completed", currentAgent: null, results: {} });
    }
    setLoadingSession(false);
  };

  const runPipeline = async () => {
    if (!requirement.trim()) return;

    abortRef.current = new AbortController();
    setAgentText({});
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
            setPipeline((prev) => ({ ...prev, currentAgent: data.agent }));
          } else if (data.type === "chunk") {
            setAgentText((prev) => ({
              ...prev,
              [data.agent]: (prev[data.agent as AgentType] ?? "") + data.chunk,
            }));
          } else if (data.type === "done") {
            setPipeline((prev) => ({ ...prev, status: "completed", currentAgent: null }));
            fetchSessions();
          } else if (data.type === "error") {
            setPipeline((prev) => ({ ...prev, status: "error", error: data.message, currentAgent: null }));
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setPipeline((prev) => ({ ...prev, status: "error", error: String(err), currentAgent: null }));
      }
    }
  };

  const isRunning = pipeline.status === "running";
  const hasResults = Object.keys(agentText).length > 0;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-4 flex items-center gap-4 shrink-0">
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
          title="Toggle history"
        >
          ☰
        </button>
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Agentic Advisor</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">AI stack recommendations powered by 4 sequential agents</p>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="w-64 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">History</span>
              <button
                onClick={() => {
                  setRequirement("");
                  setAgentText({});
                  setPipeline({ status: "idle", currentAgent: null, results: {} });
                }}
                className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium"
              >
                + New
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sessions.length === 0 && (
                <p className="text-xs text-zinc-400 px-4 py-6 text-center">No sessions yet</p>
              )}
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => loadSession(s.id)}
                  disabled={loadingSession}
                  className="w-full text-left px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 line-clamp-2 leading-relaxed">
                    {s.requirement}
                  </p>
                  <p className="text-xs text-zinc-400 mt-1" suppressHydrationWarning>{timeAgo(s.created_at)}</p>
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
            {/* Input */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Describe your business requirement
              </label>
              <textarea
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={4}
                placeholder="e.g. We want to build a customer support chatbot for an e-commerce platform handling 10,000 queries per day in English and Hindi. We have 2 developers, a $2000/month budget, and need <2s response time."
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

            {/* Agent pipeline status */}
            {(isRunning || hasResults) && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 px-1">
                {AGENT_ORDER.map((agent, i) => {
                  const isDone = !!agentText[agent];
                  const isCurrent = pipeline.currentAgent === agent;
                  return (
                    <div key={agent} className="flex items-center gap-2">
                      <span
                        className={`px-2 py-1 rounded-full font-medium transition-all ${
                          isDone
                            ? AGENT_BADGE[agent]
                            : isCurrent
                            ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 animate-pulse"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {AGENT_LABELS[agent]}
                      </span>
                      {i < AGENT_ORDER.length - 1 && <span>→</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Agent outputs */}
            {AGENT_ORDER.map((agent) => {
              const text = agentText[agent];
              const isCurrent = pipeline.currentAgent === agent;
              if (!text && !isCurrent) return null;

              return (
                <div
                  key={agent}
                  className={`rounded-2xl border-l-4 border border-zinc-200 dark:border-zinc-800 p-6 space-y-3 ${AGENT_COLORS[agent]}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${AGENT_BADGE[agent]}`}>
                      {AGENT_LABELS[agent]}
                    </span>
                    {isCurrent && !text && (
                      <span className="text-xs text-zinc-400 animate-pulse">thinking...</span>
                    )}
                    {isCurrent && text && (
                      <span className="text-xs text-zinc-400 animate-pulse">writing...</span>
                    )}
                  </div>
                  {text && (
                    <pre className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed font-sans">
                      {text}
                    </pre>
                  )}
                </div>
              );
            })}

            {/* Error */}
            {pipeline.status === "error" && (
              <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-6 text-sm text-red-700 dark:text-red-300">
                Error: {pipeline.error}
              </div>
            )}

            {/* Done */}
            {pipeline.status === "completed" && (
              <div className="text-center text-sm text-zinc-400 dark:text-zinc-500 py-4">
                Advisory complete — saved to history.
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
