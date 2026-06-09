/**
 * Natural-language wrapper over the Tier-1 ops actions (Phase C — Tier 2).
 *
 * `parseOwnerIntent` takes the owner's free-text message and asks Claude to map
 * it onto EXACTLY ONE of the Tier-1 actions, or to ask a clarifying question.
 * The model is constrained by a single forced tool whose schema enumerates the
 * allowed commands and arguments — it CANNOT emit free-form SQL or anything
 * outside that enum. The function never throws: every failure path returns a
 * structured object the caller can switch on.
 *
 * Model: claude-haiku-4-5-20251001 — cheap, constrained parse task.
 */

import Anthropic from "@anthropic-ai/sdk";
import { STATUSES } from "@/lib/shoes";
import type { EditableShoeField } from "@/lib/shoes";
import type { ShoeStatus } from "@/lib/supabase";
import type { SiteCopyKey, SiteCopyLang } from "@/lib/site-copy";

// Model id is fixed for this cheap, constrained parsing task.
const MODEL = "claude-haiku-4-5-20251001";

// The four editable shoe fields (DB names), mirrored from EditableShoeField so
// the tool schema and the Tier-1 helpers stay in lock-step.
const SHOE_FIELDS: EditableShoeField[] = ["title", "brand", "price_usd", "notes"];

const COPY_KEYS: SiteCopyKey[] = [
  "hero_tagline",
  "section_available",
  "section_on_the_way",
  "section_coming_soon",
  "section_previously",
  "footer",
];

const COPY_LANGS: SiteCopyLang[] = ["en", "am"];

/** A minimal shoe descriptor the model uses to resolve a target by name. */
export interface ShoeRef {
  id: string;
  title: string;
  brand?: string | null;
  status: ShoeStatus;
}

// ---------------------------------------------------------------------------
// Structured result types — exactly the Tier-1 action set, plus clarify/error.
// ---------------------------------------------------------------------------

export type OwnerIntent =
  | { command: "edit_field"; args: { shoe_id: string; field: EditableShoeField; value: string } }
  | { command: "set_sales"; args: { shoe_id: string; status: ShoeStatus } }
  | { command: "set_copy"; args: { key: SiteCopyKey; lang: SiteCopyLang; value: string } }
  | { command: "remove_shoe"; args: { shoe_id: string } }
  | { clarify: string }
  | { error: "not_configured" }
  | { error: "parse_failed" };

// ---------------------------------------------------------------------------
// The single forced tool. Its schema is the only thing the model can output.
// ---------------------------------------------------------------------------

const SUBMIT_TOOL: Anthropic.Tool = {
  name: "submit_intent",
  description:
    "Record the owner's intent as exactly one structured ops action, or ask a clarifying question. " +
    "You MUST call this tool exactly once. Never write SQL, code, or prose outside this tool.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      command: {
        type: "string",
        enum: ["edit_field", "set_sales", "set_copy", "remove_shoe", "clarify"],
        description:
          "edit_field: change a shoe's title/brand/price/notes. " +
          "set_sales: change a shoe's sales status. " +
          "set_copy: change a website copy string. " +
          "remove_shoe: hide a shoe from the storefront. " +
          "clarify: the request is ambiguous or the target is unknown — ask a question instead.",
      },
      shoe_id: {
        type: "string",
        description:
          "For edit_field / set_sales / remove_shoe: the id of the target shoe, taken verbatim from the provided shoe list. Omit for set_copy and clarify.",
      },
      field: {
        type: "string",
        enum: SHOE_FIELDS,
        description: "For edit_field only: which shoe field to change.",
      },
      status: {
        type: "string",
        enum: STATUSES,
        description: "For set_sales only: the new sales status.",
      },
      key: {
        type: "string",
        enum: COPY_KEYS,
        description: "For set_copy only: which website copy key to change.",
      },
      lang: {
        type: "string",
        enum: COPY_LANGS,
        description: "For set_copy only: en (English) or am (Amharic).",
      },
      value: {
        type: "string",
        description:
          "For edit_field and set_copy: the new value to set. For price_usd, a bare number. Omit otherwise.",
      },
      question: {
        type: "string",
        description:
          "For clarify only: a short question to ask the owner so the request can be completed.",
      },
    },
    required: ["command"],
  },
};

const SYSTEM_PROMPT =
  "You translate a sneaker-shop owner's plain-language instruction into exactly ONE structured ops action " +
  "by calling the submit_intent tool. You can ONLY do four things: edit a shoe field (title, brand, price_usd, notes), " +
  "set a shoe's sales status, set a website copy string, or remove (hide) a shoe. " +
  "If the instruction maps cleanly to one of those, emit that command with its arguments. " +
  "To target a shoe you MUST pick its id from the provided shoe list by matching the owner's description to a title/brand. " +
  "If no shoe clearly matches, or the request is ambiguous, unsupported, or destructive in an unclear way, use command \"clarify\" and ask a short question. " +
  "Never invent a shoe id. Never output SQL, code, or anything other than a single submit_intent tool call.";

function buildShoeContext(shoes: ShoeRef[]): string {
  if (shoes.length === 0) return "There are currently no shoes in the catalog.";
  const lines = shoes.map(
    (s) => `- id=${s.id} | title="${s.title}" | brand="${s.brand ?? ""}" | status=${s.status}`
  );
  return `Shoes in the catalog:\n${lines.join("\n")}`;
}

// Narrowing helpers — the tool input is `unknown` at the type level.
function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Parse an owner's free-text instruction into a structured Tier-2 intent.
 *
 * Never throws. Returns `{ error: "not_configured" }` if ANTHROPIC_API_KEY is
 * absent (without calling the API), `{ error: "parse_failed" }` on any API or
 * validation failure, `{ clarify }` when the model needs more info, or one of
 * the four command shapes otherwise.
 */
export async function parseOwnerIntent(
  text: string,
  shoes: ShoeRef[] = []
): Promise<OwnerIntent> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "not_configured" };
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [SUBMIT_TOOL],
      tool_choice: { type: "tool", name: SUBMIT_TOOL.name },
      messages: [
        {
          role: "user",
          content: `${buildShoeContext(shoes)}\n\nOwner's instruction:\n${text}`,
        },
      ],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUse) return { error: "parse_failed" };

    const input = toolUse.input as Record<string, unknown>;
    const command = asString(input.command);

    switch (command) {
      case "clarify": {
        const question = asString(input.question);
        return { clarify: question ?? "Could you rephrase what you'd like to change?" };
      }
      case "edit_field": {
        const shoe_id = asString(input.shoe_id);
        const field = asString(input.field);
        const value = asString(input.value);
        if (!shoe_id || !field || value === null || !SHOE_FIELDS.includes(field as EditableShoeField)) {
          return { error: "parse_failed" };
        }
        return {
          command: "edit_field",
          args: { shoe_id, field: field as EditableShoeField, value },
        };
      }
      case "set_sales": {
        const shoe_id = asString(input.shoe_id);
        const status = asString(input.status);
        if (!shoe_id || !status || !STATUSES.includes(status as ShoeStatus)) {
          return { error: "parse_failed" };
        }
        return { command: "set_sales", args: { shoe_id, status: status as ShoeStatus } };
      }
      case "set_copy": {
        const key = asString(input.key);
        const lang = asString(input.lang);
        const value = asString(input.value);
        if (
          !key ||
          !lang ||
          value === null ||
          !COPY_KEYS.includes(key as SiteCopyKey) ||
          !COPY_LANGS.includes(lang as SiteCopyLang)
        ) {
          return { error: "parse_failed" };
        }
        return {
          command: "set_copy",
          args: { key: key as SiteCopyKey, lang: lang as SiteCopyLang, value },
        };
      }
      case "remove_shoe": {
        const shoe_id = asString(input.shoe_id);
        if (!shoe_id) return { error: "parse_failed" };
        return { command: "remove_shoe", args: { shoe_id } };
      }
      default:
        return { error: "parse_failed" };
    }
  } catch {
    // Never throw — surface as a structured failure the caller can handle.
    return { error: "parse_failed" };
  }
}
