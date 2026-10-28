// Story bank: 5-8 of your strongest career stories (situation, what you did, result), built once from
// your CV, LinkedIn and portfolio and reused for "tell us about a time…" questions. Idea from career-ops (MIT).
// Every number in a story must appear in your documents.

import { groundTruth, knowledge } from "./apply/answers.js";
import { inventedNumbers } from "./guardrails.js";
import type { LLM } from "./providers/types.js";
import type { Profile, Story } from "./types.js";

const SCHEMA = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short name, e.g. 'Rebuilt onboarding at Selar'" },
          situation: { type: "string" },
          action: { type: "string", description: "What the candidate did, first person" },
          result: { type: "string", description: "Outcome, with numbers only if the documents state them" },
          tags: { type: "array", items: { type: "string" }, description: "e.g. leadership, ai, design systems, conflict, failure, research" },
        },
        required: ["title", "situation", "action", "result", "tags"],
      },
    },
  },
  required: ["stories"],
};

export async function buildStories(llm: LLM, p: Profile): Promise<Story[]> {
  const out = await llm.json<{ stories: Story[] }>({
    schemaName: "story_bank",
    schema: SCHEMA,
    maxTokens: 8000,
    system:
      "Build a story bank for job applications: 5-8 distinct stories from the candidate's documents, covering different themes (impact, leadership, collaboration, a hard problem, using AI, research, a mistake or lesson if the documents show one). Use only what the documents say. Keep every number exactly as written; don't add any.",
    messages: [{ role: "user", content: knowledge(p, 40000) }],
  });
  const truth = groundTruth(p);
  return (out.stories ?? []).filter((s) => inventedNumbers(`${s.situation} ${s.action} ${s.result}`, truth).length === 0).slice(0, 8);
}
