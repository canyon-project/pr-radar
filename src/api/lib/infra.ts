import { prisma } from "./prisma";

const store = new Map<string, string>();

let loaded = false;

/**
 * 常用 Infra 配置键，便于 IDE 补全与类型检查
 */
export const InfraKey = {
  GITHUB_PRIVATE_TOKEN: "GITHUB_PRIVATE_TOKEN",
} as const;

/**
 * 从数据库加载 Infra 配置到内存，应在后端启动时调用
 */
export async function loadInfra(): Promise<void> {
  const rows = await prisma.infra.findMany();
  store.clear();
  for (const row of rows) {
    store.set(row.id, row.value);
  }
  loaded = true;
}

/**
 * 获取配置值
 * @param key 配置键，如 InfraKey.GITLAB_PRIVATE_TOKEN
 * @returns 配置值，不存在时返回 undefined
 */
export function getInfra(key: string): string | undefined {
  return store.get(key);
}

/**
 * 获取配置值，不存在时抛出错误
 * @param key 配置键
 */
export function getInfraOrThrow(key: string): string {
  const value = store.get(key);
  if (value === undefined) {
    throw new Error(`Infra config "${key}" is not found`);
  }
  return value;
}

/**
 * 检查是否已加载
 */
export function isInfraLoaded(): boolean {
  return loaded;
}

/**
 * 写入或更新一条 Infra，并刷新内存缓存
 */
export async function upsertInfra(id: string, name: string, value: string): Promise<void> {
  await prisma.infra.upsert({
    where: { id },
    create: { id, name, value },
    update: { name, value },
  });
  store.set(id, value);
}
