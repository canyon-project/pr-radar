import axios from "axios";

import { ghHeaders } from "@/api/lib/githubGhRest.ts";

const GH_API_BASE = "https://api.github.com";

type RefResp = {
  object?: { sha?: string; type?: string };
};

type CommitDetail = {
  sha: string;
  tree: { sha: string };
};

type TreeUpsertBlob = {
  path: string;
  mode: "100644";
  type: "blob";
  content: string;
};

type TreeDeleteBlob = {
  path: string;
  mode: "100644";
  type: "blob";
  sha: null;
};

type TreeResp = { sha: string };
type CreatedCommitResp = { sha: string };

function axiosErrSnippet(status: number, data: unknown): string {
  const raw =
    typeof data === "string" ? data : JSON.stringify(data ?? {}).slice(0, 2200);
  return `${status}: ${raw}`;
}

async function getBranchHeadCommitAndTreeSha(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ commitSha: string; treeSha: string }> {
  const refUrl = `${GH_API_BASE}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`;
  const refRes = await axios.get<RefResp>(refUrl, {
    headers: ghHeaders(token),
    validateStatus: () => true,
  });
  if (refRes.status !== 200 || !refRes.data.object?.sha) {
    throw new Error(
      `读取分支「${branch}」HEAD 失败：${axiosErrSnippet(refRes.status, refRes.data)}`,
    );
  }
  const commitSha = refRes.data.object.sha;
  const cRes = await axios.get<CommitDetail>(
    `${GH_API_BASE}/repos/${owner}/${repo}/git/commits/${commitSha}`,
    { headers: ghHeaders(token), validateStatus: () => true },
  );
  if (cRes.status !== 200 || !cRes.data.tree?.sha) {
    throw new Error(
      `读取 commit「${commitSha.slice(0, 7)}」的树失败：${axiosErrSnippet(cRes.status, cRes.data)}`,
    );
  }
  return { commitSha, treeSha: cRes.data.tree.sha };
}

/**
 * 在某一引用（分支 tip）上以 **单次 tree + commit** 批量删除 blob 路径、新增/替换 UTF-8 文件（相对仓库根）。
 * GitHub Contents API 每文件一次提交；此方法对应 **Git Data API** 仅产生 **一条提交**。
 */
export async function singleCommitUpsertRepoFiles(opts: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  commitMessage: string;
  deletePathsRelative: readonly string[];
  writeUtf8Relative: readonly { path: string; bodyUtf8: string }[];
}): Promise<{ newCommitSha: string }> {
  const {
    token,
    owner,
    repo,
    branch,
    commitMessage,
    deletePathsRelative,
    writeUtf8Relative,
  } = opts;

  const writeByPath = new Map<string, string>();
  for (const w of writeUtf8Relative) {
    writeByPath.set(w.path, w.bodyUtf8);
  }

  const deletes = [...new Set(deletePathsRelative)].filter((p) => !writeByPath.has(p));

  const treePayload: Array<TreeUpsertBlob | TreeDeleteBlob> = [];
  for (const p of deletes) {
    treePayload.push({ path: p, mode: "100644", type: "blob", sha: null });
  }
  for (const [path, bodyUtf8] of writeByPath) {
    treePayload.push({
      path,
      mode: "100644",
      type: "blob",
      content: bodyUtf8,
    });
  }

  const { commitSha: parentSha, treeSha: baseTreeSha } = await getBranchHeadCommitAndTreeSha(
    token,
    owner,
    repo,
    branch,
  );

  const treeRes = await axios.post<TreeResp>(
    `${GH_API_BASE}/repos/${owner}/${repo}/git/trees`,
    { base_tree: baseTreeSha, tree: treePayload },
    { headers: ghHeaders(token), validateStatus: () => true },
  );
  if (treeRes.status < 200 || treeRes.status >= 300 || !treeRes.data?.sha) {
    throw new Error(
      `Git create tree 失败：${axiosErrSnippet(treeRes.status, treeRes.data)}`,
    );
  }

  const commitRes = await axios.post<CreatedCommitResp>(
    `${GH_API_BASE}/repos/${owner}/${repo}/git/commits`,
    {
      message: commitMessage,
      tree: treeRes.data.sha,
      parents: [parentSha],
    },
    { headers: ghHeaders(token), validateStatus: () => true },
  );
  if (commitRes.status < 200 || commitRes.status >= 300 || !commitRes.data?.sha) {
    throw new Error(`Git create commit 失败：${axiosErrSnippet(commitRes.status, commitRes.data)}`);
  }

  const newCommitSha = commitRes.data.sha;
  const refUrl = `${GH_API_BASE}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`;
  const patchRes = await axios.patch<unknown>(
    refUrl,
    { sha: newCommitSha },
    { headers: ghHeaders(token), validateStatus: () => true },
  );
  if (patchRes.status < 200 || patchRes.status >= 300) {
    throw new Error(
      `Git 更新 refs/heads/${branch} 失败：${axiosErrSnippet(patchRes.status, patchRes.data)}`,
    );
  }

  return { newCommitSha };
}
