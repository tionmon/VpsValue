import test from "node:test";
import assert from "node:assert/strict";
import { AI_SYSTEM_PROMPT } from "../scripts/ai-prompt.mjs";

test("AI prompt covers CAD and the three-year billing example", () => {
  assert.match(AI_SYSTEM_PROMPT, /CAD/);
  assert.match(AI_SYSTEM_PROMPT, /triennial/);
  assert.match(AI_SYSTEM_PROMPT, /2029-04-22到期 三年付95刀/);
  assert.match(AI_SYSTEM_PROMPT, /整个多年周期的总价/);
});
