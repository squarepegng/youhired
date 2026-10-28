import { describe, expect, it } from "vitest";
import { checkTailored, renderCvHtml } from "../server/tailor.js";
import { defaultProfile } from "../server/store.js";

const p = { ...defaultProfile(), legalName: "Ada Example", email: "ada@example.com", cvText: "Senior Product Designer, Sample Fintech (2021-present). Lifted activation by 18%. Product Designer, Demo Studio (2018-2021). BSc, University of Lagos." };
const good = {
  headline: "Product designer",
  summary: "Designer focused on onboarding.",
  skills: ["Figma"],
  experience: [{ company: "Sample Fintech", title: "Senior Product Designer", dates: "2021-present", location: "", bullets: ["Lifted activation by 18%"] }],
  education: [{ school: "University of Lagos", degree: "BSc", year: "" }],
  extras: [],
};

describe("tailored CV fact check", () => {
  it("passes when everything comes from the documents", () => expect(checkTailored(good, p)).toEqual([]));
  it("rejects invented employers, titles and numbers", () => {
    const bad = { ...good, experience: [{ ...good.experience[0], company: "Google", title: "Head of Design", bullets: ["Grew revenue 300%"] }] };
    const problems = checkTailored(bad, p).join(" | ");
    expect(problems).toMatch(/Google/);
    expect(problems).toMatch(/Head of Design/);
    expect(problems).toMatch(/300%/);
  });
  it("renders escaped, ATS-readable HTML", () => {
    const html = renderCvHtml({ ...good, summary: "<script>x</script>" }, p);
    expect(html).toContain("Ada Example");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<h2>Experience</h2>");
  });
});
