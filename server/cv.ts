import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { LLM } from "./providers/types.js";
import type { Profile } from "./types.js";

export async function cvToText(buf: Buffer, fileName: string): Promise<string> {
  if (/\.pdf$/i.test(fileName)) {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text).replace(/[ \t]+/g, " ").trim();
  }
  if (/\.docx$/i.test(fileName)) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value.trim();
  }
  throw new Error("Upload a PDF or DOCX file.");
}

// Only things that can be read off a CV. Legal name, work authorisation, salary, notice period etc.
// are deliberately NOT extracted as facts: the user confirms those in the Profile form.
const CV_SCHEMA = {
  type: "object",
  properties: {
    name_on_cv: { type: "string" },
    email_on_cv: { type: "string" },
    phone_on_cv: { type: "string" },
    location_on_cv: { type: "string", description: "City/country as written on the CV, or empty" },
    headline: { type: "string", description: "Short professional headline, e.g. 'Product designer, 7 years in fintech'" },
    summary: { type: "string", description: "3-4 sentence factual summary using only what the CV says" },
    years_experience: { type: "number", description: "Total years of professional experience, 0 if unknown" },
    skills: { type: "array", items: { type: "string" } },
    links: {
      type: "object",
      properties: { portfolio: { type: "string" }, linkedin: { type: "string" }, github: { type: "string" }, website: { type: "string" } },
      required: ["portfolio", "linkedin", "github", "website"],
    },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" },
          title: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          location: { type: "string" },
          highlights: { type: "array", items: { type: "string" }, description: "Achievements copied or lightly condensed from the CV. Keep every number exactly as written." },
        },
        required: ["company", "title", "start", "end", "location", "highlights"],
      },
    },
    education: {
      type: "array",
      items: { type: "object", properties: { school: { type: "string" }, degree: { type: "string" }, year: { type: "string" } }, required: ["school", "degree", "year"] },
    },
  },
  required: ["name_on_cv", "email_on_cv", "phone_on_cv", "location_on_cv", "headline", "summary", "years_experience", "skills", "links", "experience", "education"],
};

interface CvExtract {
  name_on_cv: string;
  email_on_cv: string;
  phone_on_cv: string;
  location_on_cv: string;
  headline: string;
  summary: string;
  years_experience: number;
  skills: string[];
  links: Profile["links"];
  experience: Profile["experience"];
  education: Profile["education"];
}

export async function extractProfile(llm: LLM, cvText: string): Promise<CvExtract> {
  return llm.json<CvExtract>({
    schemaName: "cv_profile",
    schema: CV_SCHEMA,
    maxTokens: 12000,
    system:
      "Extract a structured profile from this CV. Use only what is written. Never add skills, employers, dates or numbers that aren't in the text. Use empty strings for anything missing.",
    messages: [{ role: "user", content: `<cv>\n${cvText.slice(0, 60000)}\n</cv>` }],
  });
}

/**
 * Merge an extract into the profile. CV-derived fields are replaced; contact facts only fill blanks
 * (they're shown to the user as suggestions to confirm, never silently trusted over what they typed).
 */
export function mergeExtract(p: Profile, x: CvExtract): Profile {
  const fill = (cur: string, v: string) => (cur?.trim() ? cur : (v ?? "").trim());
  return {
    ...p,
    legalName: fill(p.legalName, x.name_on_cv),
    email: fill(p.email, x.email_on_cv),
    phone: fill(p.phone, x.phone_on_cv),
    headline: x.headline || p.headline,
    summary: x.summary || p.summary,
    yearsExperience: x.years_experience > 0 ? x.years_experience : p.yearsExperience,
    skills: x.skills?.length ? x.skills : p.skills,
    experience: x.experience?.length ? x.experience : p.experience,
    education: x.education?.length ? x.education : p.education,
    links: {
      portfolio: fill(p.links.portfolio, x.links?.portfolio),
      linkedin: fill(p.links.linkedin, x.links?.linkedin),
      github: fill(p.links.github, x.links?.github),
      website: fill(p.links.website, x.links?.website),
    },
    confirmed: false, // new CV → user re-confirms
  };
}
