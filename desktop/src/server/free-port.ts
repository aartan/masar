import { createServer, type AddressInfo } from "node:net";

/**
 * Ask the OS for a free ephemeral port on the given loopback host. There is a
 * tiny TOCTOU window between closing this probe socket and the Next server
 * binding; the caller handles the rare EADDRINUSE by retrying with a new port.
 */
export function getFreePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}
