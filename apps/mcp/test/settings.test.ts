import { describe, expect, it } from "vitest";
import { loadSettings, SettingsError } from "../src/settings.js";

const DATABASE_URL = "postgres://maester:maester@localhost:5432/maester";

describe("loadSettings", () => {
  it("reads the user email and defaults the rest as the API does", () => {
    expect(loadSettings({ DATABASE_URL, MAESTER_USER_EMAIL: "a@b.c" })).toEqual({
      databaseUrl: DATABASE_URL,
      workspaceId: null,
      userEmail: "a@b.c",
      embedderUrl: null,
      embeddingModel: "Snowflake/snowflake-arctic-embed-l-v2.0",
      xbrlPdfCheck: true,
    });
  });

  it("reads a workspace id, the embedder and the XBRL check switch", () => {
    const s = loadSettings({
      DATABASE_URL,
      MAESTER_WORKSPACE_ID: "0b1c9f0e-3c0a-4b53-9a52-2f6a3d6a1f10",
      EMBEDDER_URL: "http://localhost:8080",
      EMBEDDING_MODEL: "other/model",
      XBRL_PDF_CHECK: "false",
    });
    expect(s).toMatchObject({
      workspaceId: "0b1c9f0e-3c0a-4b53-9a52-2f6a3d6a1f10",
      userEmail: null,
      embedderUrl: "http://localhost:8080",
      embeddingModel: "other/model",
      xbrlPdfCheck: false,
    });
  });

  it("treats an empty string as unset, as agent hosts pass one for a blank env entry", () => {
    const s = loadSettings({ DATABASE_URL, MAESTER_USER_EMAIL: "a@b.c", MAESTER_WORKSPACE_ID: "", EMBEDDER_URL: "" });
    expect(s.workspaceId).toBeNull();
    expect(s.embedderUrl).toBeNull();
  });

  it("names DATABASE_URL when it is missing", () => {
    expect(() => loadSettings({ MAESTER_USER_EMAIL: "a@b.c" })).toThrow(SettingsError);
    expect(() => loadSettings({ MAESTER_USER_EMAIL: "a@b.c" })).toThrow(/DATABASE_URL/);
  });

  it("names both workspace settings when neither is set", () => {
    expect(() => loadSettings({ DATABASE_URL })).toThrow(/MAESTER_WORKSPACE_ID/);
    expect(() => loadSettings({ DATABASE_URL })).toThrow(/MAESTER_USER_EMAIL/);
  });

  it("names MAESTER_WORKSPACE_ID when it is not a UUID", () => {
    expect(() => loadSettings({ DATABASE_URL, MAESTER_WORKSPACE_ID: "not-a-uuid" })).toThrow(/MAESTER_WORKSPACE_ID/);
  });

  it("names XBRL_PDF_CHECK and EMBEDDER_URL when they are bad", () => {
    const base = { DATABASE_URL, MAESTER_USER_EMAIL: "a@b.c" };
    expect(() => loadSettings({ ...base, XBRL_PDF_CHECK: "maybe" })).toThrow(/XBRL_PDF_CHECK/);
    expect(() => loadSettings({ ...base, EMBEDDER_URL: "not a url" })).toThrow(/EMBEDDER_URL/);
  });
});
