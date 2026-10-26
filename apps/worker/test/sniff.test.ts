import { describe, expect, it } from "vitest";
import { sniffXbrl } from "../src/sniff.js";

const enc = (s: string) => new TextEncoder().encode(s);

const INSTANCE = `<?xml version="1.0" encoding="UTF-8"?>
<!--IFIndAs V1.0 (07-10-2025)-->
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:in-capmkt="http://www.sebi.gov.in/xbrl/2025-01-31/in-capmkt">
  <xbrli:context id="OneD"/>
</xbrli:xbrl>`;

describe("sniffXbrl", () => {
  it("answers xbrl for an instance with its declaration and a comment before the root", () => {
    expect(sniffXbrl(enc(INSTANCE))).toBe("xbrl");
  });

  it("answers xbrl for the instance namespace as the default namespace", () => {
    expect(sniffXbrl(enc(`<xbrl xmlns="http://www.xbrl.org/2003/instance"/>`))).toBe("xbrl");
  });

  it("skips a UTF-8 byte-order mark and leading whitespace", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const body = enc(`\n  \r\n${INSTANCE}`);
    const head = new Uint8Array(bom.length + body.length);
    head.set(bom, 0);
    head.set(body, bom.length);
    expect(sniffXbrl(head)).toBe("xbrl");
  });

  it("answers xbrl when only the head of a large instance is given", () => {
    const cut = enc(`${INSTANCE.split("<xbrli:context")[0]}<xbrli:context id="OneD"/><xbrli:context id="Tw`);
    expect(sniffXbrl(cut)).toBe("xbrl");
  });

  it("answers doctype for any DOCTYPE, before it reads an entity", () => {
    const hostile = `<?xml version="1.0"?><!DOCTYPE xbrl [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance">&b;</xbrli:xbrl>`;
    expect(sniffXbrl(enc(hostile))).toBe("doctype");
    expect(sniffXbrl(enc(`<!DOCTYPE html><html/>`))).toBe("doctype");
  });

  it("answers not_xbrl for another root or another namespace", () => {
    expect(sniffXbrl(enc("<html/>"))).toBe("not_xbrl");
    expect(sniffXbrl(enc(`<xbrl xmlns="urn:other"/>`))).toBe("not_xbrl");
    expect(sniffXbrl(enc(`<xbrl/>`))).toBe("not_xbrl");
    expect(sniffXbrl(enc(`<root xmlns="http://www.xbrl.org/2003/instance"/>`))).toBe("not_xbrl");
  });

  it("answers not_xbrl for text, a PDF, an empty head and a parse error", () => {
    expect(sniffXbrl(enc("hello world"))).toBe("not_xbrl");
    expect(sniffXbrl(enc("%PDF-1.7\n1 0 obj << >> endobj"))).toBe("not_xbrl");
    expect(sniffXbrl(new Uint8Array(0))).toBe("not_xbrl");
    expect(sniffXbrl(enc("<<<>>>"))).toBe("not_xbrl");
  });

  it("answers not_xbrl when 65,536 bytes hold no root", () => {
    const head = enc(`<?xml version="1.0"?><!--${"x".repeat(65536)}`).subarray(0, 65536);
    expect(head.length).toBe(65536);
    expect(sniffXbrl(head)).toBe("not_xbrl");
  });
});
