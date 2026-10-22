import { writeFileSync } from "node:fs";
import { promptDoc } from "./promptDoc.ts";

writeFileSync(
  new URL("../docs/ai-setup-prompt.md", import.meta.url),
  promptDoc(),
);
console.log("docs/ai-setup-prompt.md written");
