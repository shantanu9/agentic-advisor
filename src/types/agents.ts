export type AgentType = "discovery" | "workload" | "deployment" | "tco";

export interface AgentResponse {
  agent: AgentType;
  output: string;
  completedAt: Date;
}

export interface PipelineState {
  status: "idle" | "running" | "completed" | "error";
  currentAgent: AgentType | null;
  results: Partial<Record<AgentType, AgentResponse>>;
  error?: string;
}

export interface BusinessRequirement {
  description: string;
}

export interface PipelineResult {
  discovery: AgentResponse;
  workload: AgentResponse;
  deployment: AgentResponse;
  tco: AgentResponse;
}
