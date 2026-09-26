import { HistoryStore } from "../history-store.ts";

const [path, worker] = process.argv.slice(2);
const store = new HistoryStore(path, { maxEntries: 15, maxBytes: 10000 });
for (let i = 0; i < 12; i++) {
  await store.append({ version: 1, id: `${worker}-${i}`, text: `${worker}-${i}`, timestamp: new Date().toISOString(), cwd: "/repo", sessionId: worker });
}
