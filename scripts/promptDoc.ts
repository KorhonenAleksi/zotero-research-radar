import { AI_SETUP_PROMPT } from "../src/core/aiSetupPrompt.ts";

/** Content of docs/ai-setup-prompt.md, generated from the prompt in the code. */
export function promptDoc(): string {
  return `# Research Radar: AI setup prompt

<!-- Generated from src/core/aiSetupPrompt.ts by \`npm run docs:prompt\`. Do not edit by hand. -->

Use this to draft your journal list, keyword rules and watched authors from your own notes with an AI assistant that can read a folder (for example Claude Cowork):

1. Give the assistant access to the folder with your research notes (e.g. your Obsidian vault).
2. Paste the prompt below. The same text is available in Zotero under **Settings → Research Radar → Copy setup prompt**.
3. Review the notes file it writes, then import \`research-radar-profile.json\` under **Settings → Research Radar → Import profile…**. You will see a preview first; importing only adds to your settings.

Your notes are read by the assistant you choose, under that service's terms. Research Radar itself never reads your notes or sends them anywhere.

---

${AI_SETUP_PROMPT}
`;
}
