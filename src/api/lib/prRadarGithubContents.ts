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

