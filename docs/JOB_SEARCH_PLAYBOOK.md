# Applied AI / Forward-Deployed Engineer — Job Search Playbook

Target: land a **Forward Deployed Engineer (FDE)** or **Applied AI Engineer** role,
using Berebaso (this repo) as the primary proof of work.

Explicitly **not** targets: technical program/product manager, founding engineer at a
random startup, research scientist, large-scale infra roles.

---

## 1. What these roles actually are (so you filter correctly)

Both titles describe the same core job: **embed in a messy real-world business,
translate ambiguous needs into working AI-powered software, own the outcome
end-to-end.**

- **Forward Deployed Engineer** — customer-facing variant. You parachute into a
  client's environment (legacy systems, compliance, non-technical staff) and build
  the deployment. Hired by: Palantir, OpenAI, Anthropic, Google Cloud, Databricks,
  Scale AI, Mistral, Cohere, Cresta, Sierra, Decagon, Distyl, Glean, Harvey.
- **Applied AI Engineer** — same skills pointed inward: building AI products/
  integrations that serve many customers. At Anthropic and OpenAI this is the
  official title for the forward-deployed function.

Berebaso maps 1:1 onto this job: real business constraints (Telegram-first ops,
birr pricing, Amharic UI, no automated checkout), LLM components with engineering
contracts (timeouts, token budgets, never-throw error handling), phased risk
rollout (TEST-mode payment rails, approval-gated migrations), and end-to-end
ownership from schema to deploy to a 700-line ops manual.

---

## 2. Filtering mechanism

### 2a. Titles to search (exact strings)

- "Forward Deployed Engineer" / "Forward Deployed AI Engineer" / "Forward Deployed Software Engineer"
- "Applied AI Engineer" / "Applied AI, Member of Technical Staff"
- "AI Solutions Engineer" / "Solutions Architect, AI" / "AI Deployment Engineer"
- "Product Engineer, AI" (at small AI-native companies this is often the same job)

### 2b. Where to search

| Source | How |
|---|---|
| Company career pages directly | Anthropic, OpenAI, Palantir, Databricks, Scale, Sierra, Decagon, Cresta, Cohere, Mistral, Glean, Harvey, Distyl — check weekly; these fill fast |
| startup.jobs / workatastartup.com (YC) | Filter role = forward deployed / solutions engineer |
| Hacker News "Who is hiring?" (1st of each month) | Ctrl-F: "forward deployed", "applied AI", "solutions engineer" |
| LinkedIn boolean | `("forward deployed" OR "applied AI") AND engineer NOT recruiter` — set alert, filter past week |

### 2c. Scoring rubric — score each posting 0–2 per line, apply only at ≥7/12

| Signal | What to look for |
|---|---|
| Customer/domain embedding | "work directly with customers", "own deployments", "ambiguous problems" |
| End-to-end ownership | "prototype to production", "full stack", "you ship it and run it" |
| LLM as a component | Mentions agents, RAG, evals, tool use — not just "ML experience" |
| Small blast radius | Team < ~50, or a named new pod inside a big co |
| Builder interview | Take-home or live build > leetcode-only loop |
| Judgment valued | "safety", "evaluation", "phased rollout", "governance" language |

**Red flags (skip regardless of score):** title says engineer but duties are
ticket triage or pre-sales demos only; "AI" appears only in the company mission,
not in your responsibilities; role reports into sales with no build time;
requires PhD/research publications (that's a different job).

---

## 3. Positioning — projecting the right signal

### 3a. The one-liner

> "I build and operate an AI-run import business: a US→Addis Ababa sneaker pipeline
> where six Telegram bots, an LLM vision matcher, and governance-gated payment rails
> replace an ops team. I'm the kind of engineer you drop into a messy real-world
> workflow and get working software out of."

### 3b. Resume bullets (derived from this repo — keep them quantified)

- Designed and shipped a 5-role logistics platform (Next.js 14, Supabase/Postgres
  RLS, 16 versioned migrations, CI migration pipeline with approval gates for
  destructive SQL) — 45 PRs merged solo.
- Built 6 production Telegram bots (grammY, webhooks) running the full ops
  workflow — procurement, purchasing caps, arrival confirmation, photo upload —
  because that's where the ops staff actually work.
- Integrated LLM vision (Gemini 2.5 Flash) for receipt→catalog photo matching with
  engineering contracts: token budgets, 30s timeouts, errors-as-values, graceful
  degradation when dependencies are missing.
- Shipped tiered natural-language site editing (structured commands → NL → agentic
  design doc) and an autonomous agent worker with scoped DB access and
  Stripe Issuing spend-governance rails, gated in TEST mode before granting real
  spending power.
- Localized for an emerging market: bilingual EN/Amharic UI, Chapa (Ethiopian)
  payments, birr pricing, human-in-the-loop purchasing by design.

### 3c. Proof assets to build (the actual differentiator)

1. **Case-study write-up** (blog post or repo-pinned README): *"Running a
   cross-border sneaker business on six Telegram bots and an LLM"* — the business
   problem first, architecture second, judgment calls (what NOT to automate) third.
   This is the FDE interview in essay form.
2. **3–5 min demo video**: walk one shoe from retailer URL → bot pipeline →
   storefront → interest → delivery confirmation. Screen recording, no polish needed.
3. **Test layer**: add vitest coverage for `lib/shoes.ts` + bot handlers. Closes the
   biggest reviewer objection to this repo.
4. **Extract one open-source piece**: e.g. a grammY + Supabase "ops bot starter"
   with the allowlist/audit patterns. Small repo, good README — shows you can
   generalize.

---

## 4. Execution plan

### Weeks 1–2 — assets sprint
- [ ] Write the case study; publish (personal site, Substack, or dev.to).
- [ ] Record the demo video; link it from the case study and repo README.
- [ ] Add the test layer; badge the README.
- [ ] Rewrite resume around the bullets in §3b (one page, this project on top).
- [ ] Update LinkedIn headline to the target titles' keywords
      ("Applied AI Engineer — I build AI-run operations").

### Weeks 3–8 — pipeline
- [ ] Set up tracking sheet: company, role link, rubric score, contact, status, date.
- [ ] Apply to 5–8 rubric-passing roles/week. Quality over volume: tailor the first
      2 sentences of every application to the company's deployment problem.
- [ ] For each application, find 1 human (FDE/Applied AI team member or hiring
      manager) and send the outreach note below. Referral > cold apply, always.
- [ ] Check HN Who's Hiring on the 1st; check target career pages weekly.

### Outreach template (short version)

> Subject: Applied AI candidate — I run an AI-operated import business
>
> Hi ⟨name⟩ — I saw ⟨company⟩ is hiring ⟨role⟩. Relevant proof: I built and operate
> a US→Ethiopia sneaker import business where the ops team is six Telegram bots,
> an LLM vision matcher, and governance-gated payment rails — solo, 45 PRs,
> in production. Write-up: ⟨link⟩. The judgment calls (what I refused to automate,
> how I gated agent spending) are the interesting part. Open to a quick chat?

### Interview prep (ongoing)
- Practice the ambiguous-scoping interview: "Design an AI system for ⟨messy
  business⟩" — answer with workflow-first discovery, phased rollout, eval criteria,
  and explicit safety bounds. You already do this instinctively; rehearse saying it.
- Keep standard coding sharp (these loops still include live coding).
- Prepare 3 stories from this repo: a failure-mode decision (approval gates), a
  user-empathy decision (Telegram-first), an AI-restraint decision (human buys the
  shoe / TEST-mode rails).

### Metrics (review weekly)
- Applications sent (target 5–8/wk), outreach notes sent (1 per application),
  response rate (>15% means positioning works; below that, revise the one-liner),
  screens booked.

---

## 5. Rules of thumb

- Pitch the **business**, not the stack. Every other candidate says "Next.js +
  Supabase + LLM". Almost none say "I run an import operation with it."
- The evaluator is execution: every claim in the resume must be clickable —
  a commit, a doc, a video, or a live URL.
- Skip any role where you'd stop building. If the calendar is meetings, it's the
  TPM job wearing a different title.
