import axios from "axios";

import { ghHeaders } from "@/api/lib/githubGhRest.ts";

const GH_API_BASE = "https://api.github.com";

export function githubEncodeRepoContentPath(repoRelativePath: string): string {
  return repoRelativePath
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

export type GithubContentItem = {
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  sha: string;
};

type ContentGetResp = GithubContentItem | GithubContentItem[];

export async function githubGetRepoContents(
  token: string,
  owner: string,
  repo: string,
  repoRelativePath: string,
  ref: string,
): Promise<GithubContentItem[] | null> {
  const enc = githubEncodeRepoContentPath(repoRelativePath);
  const res = await axios.get<ContentGetResp>(`${GH_API_BASE}/repos/${owner}/${repo}/contents/${enc}`, {
    headers: ghHeaders(token),
    params: { ref },
    validateStatus: () => true,
  });
  if (res.status === 404) return null;
  if (res.status < 200 || res.status >= 300) return null;
  const d = res.data;
  return Array.isArray(d) ? d : [d];
}

export async function collectBlobFilesRecursive(
  token: string,
  owner: string,
  repo: string,
  ref: string,
  repoDirPath: string,
): Promise<Array<{ path: string; sha: string }>> {
  const entries = await githubGetRepoContents(token, owner, repo, repoDirPath, ref);
  if (!entries) return [];

  const out: Array<{ path: string; sha: string }> = [];
  for (const entry of entries) {
    if (entry.type === "file" || entry.type === "symlink") {
      out.push({ path: entry.path, sha: entry.sha });
    } else if (entry.type === "dir") {
      const sub = await collectBlobFilesRecursive(token, owner, repo, ref, entry.path);
      out.push(...sub);
    }
  }
  return out;
}

export async function githubDeleteRepoBlob(
  token: string,
  owner: string,
  repo: string,
  path: string,
  sha: string,
  branch: string,
  commitMessage: string,
): Promise<void> {
  const enc = githubEncodeRepoContentPath(path);
  const res = await axios.delete(`${GH_API_BASE}/repos/${owner}/${repo}/contents/${enc}`, {
    headers: ghHeaders(token),
    data: { message: commitMessage, sha, branch },
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300) {
    const raw =
      typeof res.data === "string"
        ? res.data
        : JSON.stringify(Object.assign({ status: res.status }, res.data ?? {})).slice(0, 2000);
    throw new Error(`删除「${path}」失败 (${res.status}) ${raw}`);
  }
}

export async function githubPutUtf8File(args: {
  token: string;
  owner: string;
  repo: string;
  path: string;
  branch: string;
  bodyUtf8: string;
  commitMessage: string;
}): Promise<void> {
  const { token, owner, repo, path, branch, bodyUtf8, commitMessage } = args;
  const enc = githubEncodeRepoContentPath(path);
  const url = `${GH_API_BASE}/repos/${owner}/${repo}/contents/${enc}`;

  type Head = { sha?: string; type?: string };
  const getRes = await axios.get<Head>(url, {
    headers: ghHeaders(token),
    params: { ref: branch },
    validateStatus: () => true,
  });

  const content = Buffer.from(bodyUtf8, "utf8").toString("base64");
  const payload: Record<string, string> = {
    message: commitMessage,
    content,
    branch,
  };

  if (getRes.status === 200 && getRes.data?.sha && getRes.data.type === "file") {
    payload.sha = getRes.data.sha;
  }

  const putRes = await axios.put(url, payload, {
    headers: ghHeaders(token),
    validateStatus: () => true,
  });
  if (putRes.status < 200 || putRes.status >= 300) {
    const raw =
      typeof putRes.data === "string"
        ? putRes.data
        : JSON.stringify(Object.assign({ status: putRes.status }, putRes.data ?? {})).slice(0, 2000);
    throw new Error(`写入「${path}」失败 (${putRes.status}) ${raw}`);
  }
}
