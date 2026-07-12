# H Company platform: what each console feature does + demo plan

The H platform (platform.hcompany.ai) is a **layered config system** for the
computer-use agents. This maps every left-nav feature to what it does and how
we'd use / show it. Verified against the live console + the REST API reference
at hub.hcompany.ai (2026-07). Caveats: the whole **Build** section is **Beta**;
the account is on the **free Explorer plan** (60M tokens/mo ≈ ~60 tasks, **3
concurrent sessions**, **5 API req/min**).

## How the pieces fit (the mental model)

```
Environment = the browser surface (+ optional Vault + Browser Profile + proxy)
Skill       = a reusable instruction fragment ("how to file an incident")
Agent       = a named bundle of { model + environment(s) + skills + instructions }
Session     = one run of an agent against a prompt   ← our camera event triggers this
Schedule    = starts sessions on a cron (min every 5 min)
Webhook     = signed callback when a session's status changes
```

Everything has full CRUD via **both the console UI and the REST API**, so our
camera→event pipeline can drive all of it programmatically. Our Snowglobe
`h_agent` step already creates **Sessions** (via `run_agent` on the MCP/agent
API). The rest of these features make those sessions smarter and authenticated.

---

## BUILD section

| Feature | What it does | Our use | Demo priority |
|---|---|---|---|
| **Agents** | Named reusable config (model + env + skills + instructions). Presets: `h/web-surfer-pro/-flash` (visual), `h/web-scraper-pro/-flash` (reading), `h/deep-search-pro` (research). | Build `shop-ops` agents per task type so workflows call one by name instead of a long instruction string. | ⭐ High |
| **Browser Profiles** | Encrypted archive of cookies/sign-in state the agent restores at startup → begins **already logged in**. Uploaded directly to object storage (never through the API). | **Auth mechanism #1.** Log into Google Docs / a supplier portal once, save the profile, attach to an environment → agent acts as you without a password in the prompt. | ⭐ High (unblocks authed demos) |
| **Vaults** | Connect **1Password**; agent gets a `fill_secret_at` action that logs in inside H's infra. The password never touches the API or the model. Cloud browsers only. | **Auth mechanism #2.** Store the shop's portal/DoorDash logins; agent logs in fresh each run. | Medium |
| **Environments** | The browser surface: visual/text mode, start URL, proxy, and the attach points for a **Vault** + **Browser Profile**. | Wire "who the agent is logged in as": `google-docs-env`, `supplier-portal-env`. | ⭐ High (needed for profiles/vaults) |
| **Skills** | Reusable instruction fragments the agent loads on demand (name+description shown, body loaded when relevant → lean context). | Encode shop SOPs: "file a facilities incident", "reorder to par", "house style for the ops doc". | Medium |
| **Sessions** | One agent run: status, steps, token usage, `latest_answer`, pause/resume/cancel. **Our detector triggers these.** | Already what our `h_agent` step drives. Show the Sessions list = our workflow runs. | ⭐ High (already live) |
| **Schedules** | Cron-start a session (min every 5 min, tz-aware, 20/org). | Periodic sweeps that aren't camera-triggered: "every weekday 6am, check stock + update reorder doc." | Low (nice extra) |

## CONFIGURE section

| Feature | What it does | Our use |
|---|---|---|
| **Organisation** | Members + roles (console-only). | Share agents/vaults/profiles across the team under one org. *(Per org policy, do member/role changes yourself.)* |
| **API keys** | `hk-…` keys that auth all API calls. Free tier **5 req/min**. | Our backend holds one (`HAI_API_KEY`); use separate named keys per service. Keep server-side. |
| **Webhooks** | Signed HTTPS callbacks on session lifecycle (`session.completed/failed/timed_out/idle/awaiting_tool_results`). HMAC-SHA256 signed, at-least-once, auto-disable after 50 fails. | **Closes the loop**: instead of polling, get a callback when the agent finishes → alert the owner / log outcome. |
| **Billing** | Token metering; Explorer (free, 3 concurrent) / Developer ($29, 10 concurrent) / Enterprise. | **Concurrency is the constraint**: free tier = 3 simultaneous events. A busy shop needs Developer. |

---

## Demo plan: what to set up and what to show

**Tier 1 (highest impact), do these:**

1. **Build a custom Agent** (`shop-ops` or `incident-filer`) in Agents → New agent: preset model + instructions tuned for shop back-office tasks. Then in a workflow's H-agent step, reference it by name instead of a long instruction. *Show:* the agent config, then a run using it.
2. **Browser Profile + Environment for Google Docs.** Sign into Google once, save the profile, make an environment that uses it. *Show:* the agent updating a **private** doc (not just a link-shared one), which proves authenticated action. This is the "it acts as the owner" moment.
3. **Sessions + Webhook loop.** Point a webhook at the automation backend; when a workflow's agent session completes, the dashboard/owner gets notified without polling. *Show:* fire an event → session appears in H's Sessions list → webhook marks the run done in our Runs page.

**Tier 2, if time:**

4. **Skill** encoding one SOP (e.g. "file a facilities incident"), attached to the agent; show the agent loading it on demand.
5. **Vault** (1Password) for a portal login; show password-free authenticated login.
6. **Schedule**: a 6am daily stock-check sweep, to show the time-based trigger alongside camera triggers.

**The one-line pitch:** *"Cameras create the event; H's Sessions do the work; Browser Profiles/Vaults let the agent act as the owner; Webhooks close the loop, all driven from our pipeline via the API."*

## Wiring diagram (target)

```
camera → detector classifies event → backend (hk- key) POSTs a Session
  referencing a prebuilt Agent (bundles Environment→Vault/Profile + Skill)
  → agent does the browser work (fill form, research, update Google Doc)
  → Webhook fires session.completed → backend alerts owner / logs it
Schedules cover the periodic (non-real-time) sweeps.
```

## Honest gaps / risks

- **Concurrency:** free plan = 3 concurrent sessions; multiple simultaneous
  camera events queue. Budget the Developer plan for a real deployment.
- **Browser Profile capture:** the API flow (initiate → complete upload,
  encrypted) is confirmed, but the exact recommended tool to *capture* the
  profile `.zip` wasn't verified; check H's helper before relying on it.
- **`docs.hcompany.ai` has an expired TLS cert** right now; the working API
  docs are at **hub.hcompany.ai/computer-use-agents**.
- Build section is **Beta**; expect churn.
