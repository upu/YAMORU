export type RecordedActivityLog = {
  action: string;
  id: string;
  occurred_at: string;
  recorded_at: string;
};

type OccurrenceWithActivityLogs<T extends RecordedActivityLog> = {
  activity_logs: T[];
  status: string;
};

export function selectActiveCompletionLogs<T extends RecordedActivityLog>(
  occurrences: OccurrenceWithActivityLogs<T>[],
): T[] {
  return occurrences.flatMap((occurrence) => {
    if (occurrence.status !== "completed") return [];

    const completionLogs = occurrence.activity_logs.filter(
      (log) => log.action === "completed",
    );
    if (completionLogs.length === 0) return [];

    return [
      completionLogs.reduce((latest, log) => {
        const recordedOrder = log.recorded_at.localeCompare(latest.recorded_at);
        if (recordedOrder !== 0) return recordedOrder > 0 ? log : latest;
        return log.id.localeCompare(latest.id) > 0 ? log : latest;
      }),
    ];
  });
}
