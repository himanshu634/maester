import type { ResearchCompanies } from "@maester/contracts";
import { listCompanies, listCompanyFilings, type Db } from "@maester/db";
import { toCompany } from "../serialize.js";
import { counts } from "./financials.js";

/** Most companies the Research list shows: the API's largest page. Personal use keeps far fewer. */
const COMPANY_LIMIT = 100;

/** The workspace's companies with what was read of each: the body of `GET /research/companies`. */
export async function listResearchCompanies(db: Db, workspaceId: string): Promise<ResearchCompanies> {
  const [page, filings] = await Promise.all([listCompanies(db, workspaceId, { limit: COMPANY_LIMIT }), listCompanyFilings(db, workspaceId)]);
  const items = page.items
    .map((company) => {
      const mine = filings.filter((f) => f.companyId === company.id);
      const read = mine.filter((f) => counts(f.kind, f.intakeState));
      const latest = read.map((f) => f.periodEnd).filter((d): d is string => d !== null).sort().at(-1) ?? null;
      return {
        company: toCompany(company),
        annualReportsRead: read.length,
        latestPeriodEnd: latest,
        reading: mine.filter((f) => f.intakeState === "identifying" || f.intakeState === "reading").length,
        failed: mine.filter((f) => f.intakeState === "identify_failed" || f.intakeState === "read_failed").length,
      };
    })
    .sort((a, b) => a.company.displayName.localeCompare(b.company.displayName));
  return { items };
}
