import { decryptSecret } from "./secrets.js";

/**
 * The part of a `market_connection` row this needs. It takes rows rather than a database so
 * that @maester/market does not depend on @maester/db; callers pass `listConnections(db)`.
 */
export type SavedConnection = { provider: string; clientId: string | null; secretCiphertext: string };

export type LoadedConnections = {
  dhan: { clientId: string; accessToken: string } | null;
  fred: { apiKey: string } | null;
};

function open(row: SavedConnection, key: Buffer): string {
  try {
    return decryptSecret(row.secretCiphertext, key);
  } catch {
    throw new Error(`the saved ${row.provider} connection could not be decrypted; save it again in Settings`);
  }
}

/** Decrypts the saved connections. Throws, naming only the provider, when one will not decrypt. */
export function loadConnections(rows: SavedConnection[], key: Buffer): LoadedConnections {
  const out: LoadedConnections = { dhan: null, fred: null };
  for (const row of rows) {
    if (row.provider === "dhan" && row.clientId) out.dhan = { clientId: row.clientId, accessToken: open(row, key) };
    else if (row.provider === "fred") out.fred = { apiKey: open(row, key) };
  }
  return out;
}
