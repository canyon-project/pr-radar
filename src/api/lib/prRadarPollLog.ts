/** PR 抓取 / Fork 流水线写日志回调 */
export type PrRadarPollLogFn = (line: string) => void | Promise<void>;
