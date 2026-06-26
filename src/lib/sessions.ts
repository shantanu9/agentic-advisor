import { supabaseAdmin } from "./supabase";
import { PipelineResult } from "@/types/agents";

export interface Session {
  id: string;
  requirement: string;
  discovery: string;
  workload: string;
  deployment: string;
  tco: string;
  created_at: string;
}

export async function saveSession(
  requirement: string,
  result: PipelineResult
): Promise<Session | null> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .insert({
      requirement,
      discovery: result.discovery.raw,
      workload: result.workload.raw,
      deployment: result.deployment.raw,
      tco: result.tco.raw,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to save session:", JSON.stringify(error));
    throw new Error(JSON.stringify(error));
  }
  return data;
}

export async function listSessions(): Promise<Session[]> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("id, requirement, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("Failed to list sessions:", JSON.stringify(error));
    return [];
  }
  return data ?? [];
}

export async function getSession(id: string): Promise<Session | null> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Failed to get session:", error.message);
    return null;
  }
  return data;
}
