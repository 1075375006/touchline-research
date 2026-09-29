import { createApp } from "./app.js";
import { researchConfig } from "./db.js";
import { startWorker, stopWorker } from "./research.js";
import { closeSearchRuntimes } from "./search-runtime.js";
const port = Number(process.env.PORT || 4318);
const server = createApp().listen(port, process.env.HOST || "0.0.0.0", () =>
  console.log("Touchline Research listening on port " + port),
);
startWorker(() => researchConfig().concurrency);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, async () => {
    console.log("Saving research checkpoints…");
    await stopWorker();
    closeSearchRuntimes();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  });
