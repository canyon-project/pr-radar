import axios from "axios";

export type GithubTokenStatus = {
  configured: boolean;
};

export type PrRadarWatchTask = {
  id: string;
  repositoryUrl: string;
  owner: string;
  repo: string;
  branch: string;
  intervalMinutes: number;
  enabled: boolean;
  botWorkflowYaml: string;
  botOverlayFiles: { path: string; content: string }[];
  lastPolledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatePrRadarWatchTaskInput = {
  repositoryUrl: string;
  branch: string;
  intervalMinutes: number;
  enabled?: boolean;
  botWorkflowYaml: string;
  botOverlayFiles?: { path: string; content: string }[];
};

export type UpdatePrRadarWatchTaskInput = {
  repositoryUrl?: string;
  branch?: string;
  intervalMinutes?: number;
  enabled?: boolean;
  botWorkflowYaml?: string;
  botOverlayFiles?: { path: string; content: string }[];
};

export type PrRadarMergedPr = {
  id: string;
  taskId: string;
  githubPrNumber: number;
  title: string;
  mergedAt: string;
  htmlUrl: string;
  mergedByLogin: string | null;
  baseRef: string;
  mergeCommitSha: string | null;
  botBranchName: string | null;
  botBranchHtmlUrl: string | null;
  botPushedAt: string | null;
  botLastError: string | null;
  createdAt: string;
  taskSummary: {
    repositoryUrl: string;
    branch: string;
  };
};

export type PrRadarJobDto = {
  id: string;
  taskId: string;
  status: string;
  logText: string;
  newCount: number | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type PollEnqueueResult = {
  jobId: string;
  reused: boolean;
};

const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

export async function getGithubTokenStatus(): Promise<GithubTokenStatus> {
  const { data } = await api.get<GithubTokenStatus>("/infra/github-token");
  return data;
}

export async function putGithubToken(token: string): Promise<void> {
  await api.put("/infra/github-token", { token });
}

export async function listPrRadarWatchTasks(): Promise<PrRadarWatchTask[]> {
  const { data } = await api.get<PrRadarWatchTask[]>("/pr-radar/watch-tasks");
  return data;
}

export async function createPrRadarWatchTask(input: CreatePrRadarWatchTaskInput): Promise<PrRadarWatchTask> {
  const { data } = await api.post<PrRadarWatchTask>("/pr-radar/watch-tasks", input);
  return data;
}

export async function updatePrRadarWatchTask(
  id: string,
  input: UpdatePrRadarWatchTaskInput,
): Promise<PrRadarWatchTask> {
  const { data } = await api.patch<PrRadarWatchTask>(`/pr-radar/watch-tasks/${id}`, input);
  return data;
}

export async function deletePrRadarWatchTask(id: string): Promise<void> {
  await api.delete(`/pr-radar/watch-tasks/${id}`);
}

export async function enqueuePrRadarWatchTaskPoll(taskId: string): Promise<PollEnqueueResult> {
  const response = await api.post<PollEnqueueResult>(
    `/pr-radar/watch-tasks/${taskId}/poll`,
    {},
    {
      validateStatus: (s) => s === 202,
    },
  );
  return response.data;
}

export async function getPrRadarJob(jobId: string): Promise<PrRadarJobDto> {
  const { data } = await api.get<PrRadarJobDto>(`/pr-radar/jobs/${jobId}`);
  return data;
}

export async function listPrRadarJobsForTask(
  taskId: string,
  limit = 10,
): Promise<PrRadarJobDto[]> {
  const { data } = await api.get<PrRadarJobDto[]>("/pr-radar/jobs", {
    params: { taskId, limit },
  });
  return data;
}

export async function pollPrRadarWatchTaskNow(taskId: string): Promise<PollEnqueueResult> {
  return enqueuePrRadarWatchTaskPoll(taskId);
}

export async function listPrRadarMergedPrs(taskId?: string): Promise<PrRadarMergedPr[]> {
  const { data } = await api.get<PrRadarMergedPr[]>("/pr-radar/merged-prs", {
    params: taskId ? { taskId } : {},
  });
  return data;
}

export function prRadarApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const msg = (error.response?.data as { message?: string } | undefined)?.message;
    if (typeof msg === "string" && msg.length > 0) {
      return msg;
    }
  }
  return fallback;
}
