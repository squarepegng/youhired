import { describe, expect, it } from "vitest";
import { type FormField, mapField, pickOption } from "../server/apply/mapper.js";
import { defaultProfile } from "../server/store.js";
import type { Profile } from "../server/types.js";

const p: Profile = {
  ...defaultProfile(),
  legalName: "Ada Grace Example",
  preferredName: "Ada",
  email: "ada@example.com",
  phone: "+234 800 000 0000",
  country: "Nigeria",
  city: "Lagos",
  timezone: "UTC+1",
  workAuth: { Nigeria: "citizen", "United States": "not_authorized", "United Kingdom": "not_authorized" },
  needsSponsorship: true,
  noticePeriod: "4 weeks",
  links: { portfolio: "https://ada.design", linkedin: "https://linkedin.com/in/ada", github: "", website: "" },
  experience: [{ company: "Sample Fintech", title: "Senior Product Designer", start: "2021", end: "present", highlights: [] }],
  savedAnswers: [{ question: "Are you at least 18 years old?", answer: "Yes" }],
};
const job = { location: "Remote, EMEA", salaryMin: null as number | null, source: "greenhouse" as const, company: "GitLab" };

let n = 0;
const F = (label: string, kind: FormField["kind"] = "text", over: Partial<FormField> = {}): FormField => ({ id: `f${++n}`, frame: 0, kind, label, name: "", required: true, options: [], value: "", ...over });
const m = (label: string, kind: FormField["kind"] = "text", over: Partial<FormField> = {}, j = job, prof = p) => mapField(F(label, kind, over), prof, j);

describe("identity and contact", () => {
  it("splits names", () => {
    expect(m("First Name").value).toBe("Ada");
    expect(m("Last Name").value).toBe("Grace Example");
    expect(m("Full name").value).toBe("Ada Grace Example");
    expect(m("What's the name you'd prefer us to use throughout the interview process?").value).toBe("Ada");
  });
  it("contact and links", () => {
    expect(m("Email", "email").value).toBe("ada@example.com");
    expect(m("Phone", "tel").value).toBe("+234 800 000 0000");
    expect(m("LinkedIn Profile").value).toBe("https://linkedin.com/in/ada");
    expect(m("Portfolio URL").value).toBe("https://ada.design");
  });
  it("doesn't confuse company questions with names", () => {
    expect(m("Current company").value).toBe("Sample Fintech");
    expect(m("Are you subject to any employment agreements with your current employer?").source).toBe("ai");
  });
  it("missing optional link is left blank, missing required asks the user", () => {
    expect(m("GitHub", "url", { required: false }).value).toBeNull();
    expect(m("GitHub", "url", { required: true }).need).toBe("user");
  });
});

describe("location is never stated falsely", () => {
  it("answers from the profile", () => {
    expect(m("Location (City)", "combobox").value).toBe("Lagos");
    expect(m("Where are you based?").value).toBe("Lagos, Nigeria");
    expect(m("Please choose the country in which you are located.", "select", { options: ["Kenya", "Nigeria", "United States"] }).value).toBe("Nigeria");
    expect(m("What is your current country of residence?").value).toBe("Nigeria");
  });
  it("answers 'do you live in X' honestly", () => {
    expect(m("Do you live in the Washington DC metro area?", "select", { options: ["Yes", "No"] }).value).toBe("No");
    expect(m("Are you based in Lagos?", "select", { options: ["Yes", "No"] }).value).toBe("Yes");
  });
  it("nationality comes from citizenship, not residence", () => {
    expect(m("Please indicate your nationality:").value).toBe("Nigeria");
  });
});

describe("work authorisation and sponsorship", () => {
  it("US authorisation → No", () => {
    expect(m("Are you legally authorized to work in the United States?", "select", { options: ["Yes", "No"] }).value).toBe("No");
  });
  it("US sponsorship → Yes", () => {
    expect(m("Will you now or in the future require visa sponsorship to work in the US?", "radio", { options: ["Yes", "No"] }).value).toBe("Yes");
  });
  it("sponsorship to stay where you live → No", () => {
    expect(m("Will you now or in the future require sponsorship for a visa to remain in your current location?", "combobox").value).toBe("No");
  });
  it("authorised in your country of residence → Yes", () => {
    expect(m("Are you authorized to work in the country where you reside?", "select", { options: ["Yes", "No"] }).value).toBe("Yes");
  });
  it("ambiguous questions go to the user, never guessed", () => {
    const r = m("Do you require sponsorship?", "select", { options: ["Yes", "No"] });
    expect(r.need).toBe("user");
    expect(r.value).toBeNull();
    expect(m("Are you legally authorized to work in the country where this job is located?", "select", { options: ["Yes", "No"] }).need).toBe("user");
  });
  it("unknown country authorisation is not assumed", () => {
    expect(m("Are you authorized to work in Germany?", "select", { options: ["Yes", "No"] }).need).toBe("user");
  });
  it("travel questions mentioning visas aren't sponsorship questions", () => {
    expect(m("We meet in person; travel may require entry visas. Are you willing and able to commit to this?").source).not.toBe("rule");
  });
});

describe("salary rules", () => {
  it("leaves optional salary blank", () => {
    const r = m("Salary expectations", "text", { required: false });
    expect(r.value).toBeNull();
  });
  it("uses the posted minimum for numbers", () => {
    expect(m("Desired annual salary (USD)", "number", {}, { ...job, salaryMin: 95000 }).value).toBe("95000");
  });
  it("uses the default number when no range is posted", () => {
    const prof = { ...p, salary: { ...p.salary, defaultAmount: 60000 } };
    expect(m("Desired salary", "number", {}, job, prof).value).toBe("60000");
  });
  it("asks the user when a number is required and none is set", () => {
    expect(m("Desired salary", "number").need).toBe("user");
  });
  it("uses the text answer for written questions", () => {
    expect(m("Please indicate your salary expectation for this role.", "text").value).toMatch(/Open to discussing/);
  });
  it("'have you reviewed the salary range' is not a salary answer", () => {
    expect(m("Have you reviewed the compensation details (salary range)?", "select", { options: ["Yes", "No"] }).source).toBe("ai");
  });
});

describe("EEO, consent, misc", () => {
  it("declines to self-identify using the form's own wording", () => {
    expect(m("Gender", "select", { options: ["Male", "Female", "Decline To Self Identify"] }).value).toBe("Decline To Self Identify");
    expect(m("Veteran Status", "select", { options: ["I am a veteran", "I am not a veteran", "I don't wish to answer"] }).value).toBe("I don't wish to answer");
    expect(m("Disability Status", "radio", { options: ["Yes", "No", "I do not want to answer"] }).value).toBe("I do not want to answer");
  });
  it("ticks required consent and flags it for review", () => {
    const r = m("I agree to the privacy policy", "checkbox-single");
    expect(r.value).toBe("true");
    expect(r.note).toMatch(/review/);
    expect(m("Send me marketing updates; I agree", "checkbox-single", { required: false }).value).toBeNull();
  });
  it("reuses answers you gave before", () => {
    expect(m("Are you at least 18 years old?", "select", { options: ["Yes", "No"] }).value).toBe("Yes");
  });
  it("answers 'worked here before' from the CV's employer list", () => {
    expect(m("Have you previously worked at or consulted for GitLab?", "combobox").value).toBe("No");
  });
  it("uploads the CV and attaches a cover letter wherever there's a slot", () => {
    expect(m("Resume/CV", "file").value).toBe("cv");
    expect(m("Cover Letter", "file", { required: false }).value).toBe("cover");
  });
  it("experience questions go to the AI (which must say if it can't answer)", () => {
    expect(m("Have you shipped a React Native app?", "select", { options: ["Yes", "No"] }).need).toBe("ai");
    expect(m("Why do you want to work here?", "textarea").need).toBe("ai");
  });
  it("pickOption is forgiving but not reckless", () => {
    expect(pickOption(["Select...", "Yes, I am", "No, I am not"], ["No"])).toBe("No, I am not");
    expect(pickOption(["Red", "Blue"], ["Decline"])).toBeNull();
  });
});

describe("questions that assume you live somewhere else", () => {
  it("never answers 'where in the US' for someone in Nigeria", () => {
    const r = m("Where are you located in the United States (city, state) ?");
    expect(r.value).toBeNull();
    expect(r.need).toBe("user");
    expect(r.note).toMatch(/assumes you live in/);
  });
});

it("visa names imply the country (H-1B → US)", () => {
  expect(m("Will you now or in the future require sponsorship for employment visa status (for example, H-1B)?", "select", { options: ["Yes", "No"] }).value).toBe("Yes");
});

describe("fixes from live Ashby test", () => {
  it("never fills password fields", () => {
    expect(m("Portfolio Password", "text", { required: false }).value).toBeNull();
    expect(m("Portfolio Password", "text", { required: true }).need).toBe("user");
  });
  it("asks how to pronounce your name", () => expect(m("How do you pronounce your name?").need).toBe("user"));
  it("city/country question gets both", () => expect(m("What city/country will you work from?").value).toBe("Lagos, Nigeria"));
  it("recognises 'how you heard about this role'", () => expect(m("Please share specific information on how you heard about this role").source).toBe("rule"));
});
