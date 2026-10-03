import { z } from "zod";
import { IsoTimestamp, Uuid } from "./common.js";

/** ISO 3166-1 alpha-2, upper case. */
export const CountryCode = z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2 country code");

export const Company = z.object({
  id: Uuid,
  workspaceId: Uuid,
  displayName: z.string(),
  country: CountryCode,
  createdAt: IsoTimestamp,
});
export type Company = z.infer<typeof Company>;

export const CreateCompanyRequest = z.object({
  displayName: z.string().trim().min(1).max(200),
  country: CountryCode,
});
export type CreateCompanyRequest = z.infer<typeof CreateCompanyRequest>;
