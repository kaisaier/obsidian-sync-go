import type { TransItemType } from "./i18n";
import type { SyncLogRecord } from "./localdb";
import {
  buildSyncLogSummary,
  classifySyncLogPath,
  mapSyncDecision,
  type SyncLogItem,
  type SyncLogStatus,
  type SyncLogSummary,
} from "./syncLogModel";

export type SyncLogRun = {
  readonly id: string;
  readonly timestamp: number;
  readonly timeText: string;
  readonly status: SyncLogStatus;
  readonly triggerSource: string;
  readonly message: string;
  readonly items: readonly SyncLogItem[];
  readonly summary: SyncLogSummary;
};

type Translate = (key: TransItemType, vars?: Record<string, string>) => string;

const getTimePart = (value: string): string =>
  value.match(/(\d{1,2}:\d{2}:\d{2})/)?.[1] ?? value;

const extractOperations = (
  record: SyncLogRecord
): readonly { readonly decision: string; readonly path: string }[] =>
  record.lines.flatMap((line) => {
    const matched = line.match(/SYNC\s+\d+\/\d+\s+\|\s+(.+?)\s+\|\s+(.+)$/);
    if (matched === null) return [];
    const decision = matched[1];
    const path = matched[2];
    return decision === undefined || path === undefined
      ? []
      : [{ decision, path }];
  });

const extractFailureMessage = (record: SyncLogRecord): string => {
  const errorLine = [...record.lines]
    .reverse()
    .find((line) => /(?:^|\]\s+)ERROR(?: ITEM)?:\s*/.test(line));
  return errorLine?.replace(/^.*?ERROR(?: ITEM)?:\s*/, "").trim() || record.summary;
};

export const buildSyncLogRun = (
  record: SyncLogRecord,
  translate: Translate,
  live: boolean
): SyncLogRun => {
  const status: SyncLogStatus = live
    ? "pending"
    : record.success
      ? "success"
      : "error";
  const timeText = getTimePart(record.tsFmt);
  const items = extractOperations(record).map((operation, index) => {
    const display = mapSyncDecision(operation.decision);
    return {
      id: `${record.id}-${index}`,
      timestamp: record.ts + index,
      timeText,
      title: translate(display.titleKey),
      path: operation.path,
      category: classifySyncLogPath(
        operation.path,
        display.action === "folder"
      ),
      direction: display.direction,
      action: display.action,
      // SYNC lines are emitted by the completion callback. A later operation may
      // still fail the run, but it must not retroactively turn completed rows red.
      status: live ? "pending" : "success",
      message: "",
      decision: operation.decision,
    } satisfies SyncLogItem;
  });
  return {
    id: record.id,
    timestamp: record.ts,
    timeText,
    status,
    triggerSource: record.triggerSource,
    message: record.success ? "" : extractFailureMessage(record),
    items,
    summary: buildSyncLogSummary(items),
  };
};

export const buildSyncLogRuns = (
  records: readonly SyncLogRecord[],
  translate: Translate,
  liveRecord?: SyncLogRecord
): readonly SyncLogRun[] => {
  const runs = records.map((record) => buildSyncLogRun(record, translate, false));
  if (liveRecord !== undefined) {
    runs.push(buildSyncLogRun(liveRecord, translate, true));
  }
  return runs.sort((left, right) => right.timestamp - left.timestamp);
};
