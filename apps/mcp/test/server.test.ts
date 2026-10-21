import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { Db, WorkspaceRow } from "@maester/db";
import { silentLogger } from "../src/logger.js";
import { createServer } from "../src/server.js";
import { loadSettings } from "../src/settings.js";

async function connect() {
  const server = createServer({
    // No tool reads the database yet; later tasks pass real ones.
    db: {} as Db,
    workspace: {} as WorkspaceRow,
    embedder: null,
    settings: loadSettings({ DATABASE_URL: "postgres://x/y", MAESTER_USER_EMAIL: "a@b.c" }),
    logger: silentLogger,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, server };
}

describe("createServer", () => {
  it("lists no tools yet", async () => {
    const { client, server } = await connect();
    expect((await client.listTools()).tools).toEqual([]);
    await client.close();
    await server.close();
  });

  it("carries the six answer rules of the data layer design in its instructions", async () => {
    const { client, server } = await connect();
    const text = client.getInstructions() ?? "";
    for (const part of [
      "fact id",
      "never adds, divides, compares or ranks",
      "null with its reason",
      "consolidated and standalone never mix",
      "unreviewed",
      "No advice words",
    ]) {
      expect(text).toContain(part);
    }
    await client.close();
    await server.close();
  });
});
