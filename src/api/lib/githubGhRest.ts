/** GitHub REST v3（api.github.com）请求头 — 独立于业务模块以避免循环引用 */
export function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
