/**
 * 解析 GitHub 仓库为 owner/repo，并规范化展示 URL
 */
export type ParsedGithubRepo = {
  owner: string;
  repo: string;
  repositoryUrl: string;
};

export function parseGithubRepo(raw: string): ParsedGithubRepo {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("仓库地址不能为空");
  }

  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh) {
    const owner = ssh[1];
    const repo = ssh[2];
    return { owner, repo, repositoryUrl: `https://github.com/${owner}/${repo}` };
  }

  const sshAlt = trimmed.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshAlt) {
    const owner = sshAlt[1];
    const repo = sshAlt[2];
    return { owner, repo, repositoryUrl: `https://github.com/${owner}/${repo}` };
  }

  const https = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/)?(?:[#?].*)?$/i,
  );
  if (https) {
    const owner = https[1];
    const repo = https[2].replace(/\.git$/i, "");
    return { owner, repo, repositoryUrl: `https://github.com/${owner}/${repo}` };
  }

  const short = trimmed.match(/^([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (short) {
    const owner = short[1];
    const repo = short[2].replace(/\.git$/i, "");
    return { owner, repo, repositoryUrl: `https://github.com/${owner}/${repo}` };
  }

  throw new Error("无效的 GitHub 仓库地址，支持 https://github.com/o/r、git@github.com:o/r.git 或 o/r");
}
