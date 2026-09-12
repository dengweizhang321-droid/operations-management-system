// Synthetic Worker lifecycle only: no application imports, credentials or APIs.
import { createServer } from "node:http";
import { parentPort, workerData } from "node:worker_threads";

const server = createServer((request, response) => {
  if (request.headers["x-teruisi-helper-slot-token"] !== workerData.token) {
    response.writeHead(403); response.end(); return;
  }
  response.end("ok");
  if (request.url === "/finish") server.close(() => parentPort.postMessage({ type: "finished", clean: true }));
  if (request.url === "/crash") setTimeout(() => process.exit(1), 10);
});
server.listen(0, "127.0.0.1", () => parentPort.postMessage({ type: "ready", port: server.address().port }));
