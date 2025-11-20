import { ChangeLogPlugin } from './plugin';
import { LogHistoryEntry, LogHistorySaver } from './types';

export class DefaultLogHistorySaver implements LogHistorySaver {
  async saveLogHistories(plugin: ChangeLogPlugin, histories: LogHistoryEntry[]): Promise<void> {
    const LogHistory = plugin.getLogHistoryModelPlugin();

    if (histories.length > 1) {
      const bulkOperations = histories.map((logEntry) => {
        return {
          insertOne: {
            document: logEntry,
          },
        };
      });

      await LogHistory.bulkWrite(bulkOperations, { ordered: false });
    } else {
      await LogHistory.create(histories[0]);
    }
  }
}
