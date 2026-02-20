# AI Development Log

**Project:** CollabBoard -- Real-Time Collaborative Whiteboard with AI Agent
**Duration:** 5 days (February 16-20, 2026)
**Developer:** Solo

---

## Tools and Workflow

**Cursor** was the sole development tool for this project -- 112 agent sessions across 5 days, from initial architecture through final polish. The goal was fully agentic development: the developer wrote virtually no code by hand, relying entirely on the AI agent for implementation.

### Workflow Pattern

- **Plan mode** for every complex task (multi-file changes, architectural decisions, performance investigations). The agent researches the codebase, proposes a plan with specific file changes, and waits for approval before executing.
- **Agent mode** for execution after plan approval, and for straightforward single-file changes.
- **`AGENTS.md`** as the persistent instruction file, loaded into every session. Contains immutable rules (auth-first, Yjs as source of truth, AI mutations server-side, performance budgets enforced), the current milestone, memory protocol, and required behaviors. This file was the single most impactful tool for maintaining consistency across 112 sessions.
- **Cursor Skills** for domain knowledge injection. 10 skill files provided best practices for specific technologies:
  - `better-auth-best-practices` -- auth patterns, session management
  - `elysiajs` -- backend framework patterns
  - `next-best-practices` -- App Router, RSC boundaries, async APIs
  - `zustand-state-management` -- store patterns, hydration, TypeScript
  - `vercel-react-best-practices` -- performance optimization
  - `frontend-design` -- UI quality standards
  - `langfuse-observability` -- tracing setup
  - And others for Bun, composition patterns, browser automation
- **Cursor Rules** (`.cursor/rules/*.mdc`) for file-pattern-specific guidance (backend collab layer, frontend canvas, shared types).
- **Memory protocol** -- `docs/memory/decisions.md` (17 ADRs), `docs/memory/known-issues.md`, `docs/build-checklist.md` give each session historical context and prevent re-discovery of solved problems.

### Developer's Role

Architecture decisions, UX judgment (manually testing the app and reporting issues back to the agent), prompt engineering, and plan review/approval.

---

## MCP Usage

**Cursor IDE Browser MCP** was the only MCP integration used. It provided browser automation for frontend testing and verification -- navigating the app, interacting with UI elements, taking screenshots to verify visual changes, and checking state after operations. This was particularly useful for verifying canvas interactions that are hard to assert programmatically (cursor rendering, drag behavior, visual feedback).

---

## Effective Prompts

### 1. Problem Description with Specific Bug Scenarios

> *"I'm not sure I'm happy with the approach we are taking with frames. It feels like objects are considered part of the frame as long as they are within the bounds of the frame but this causes issues because lets say I duplicate a frame with cmd+D it will duplicate it slightly below it to the right and when I drag it away, it just picks up all the elements even behind the frame -- is there a more structured way we can do this and maybe have some add and remove from frame functionality so that is more fixed? Also, when I drag an object to a frame there is no feedback to the user that it's about to be added to the frame. Maybe if an object is dragged into a frame, the frame changes border or something."*

**Why it worked:** Described the current behavior, the specific failure mode (duplicate + drag picking up wrong elements), the desired behavior (explicit membership), and even suggested a visual indicator. The agent produced a clean architectural plan: replace spatial containment with an explicit `frameId` property, auto-assign on drop, and add drop-target highlighting. One session, zero back-and-forth.

**Pattern:** Describe what's happening, why it's wrong, and suggest a direction.

### 2. Real Evidence (Traces/Screenshots) for Debugging

> *"Check this chat -- the second prompt created the frame on top of the creation from the first prompt and it wasn't consistent on the frameId assigned to the sticky notes and frame so I deleted everything created by prompt 2. Because the frameId wasn't consistent across the created stickies, when I attempted to move the frame, some stickies stayed behind and some moved with the frame. Anyways -- I went ahead and deleted everything from prompt 2. Then on prompt 3 you can see that it deleted some items, well one of those items was the result of prompt 1 which was nicely completed. I know we are sending some history with the message but how do we guard against some actions like this?"*

**Why it worked:** Included a screenshot of the AI chat session showing the exact sequence of commands. Walked through the step-by-step failure. The agent could reason about the concrete scenario instead of guessing. Led to implementing occupied-region hints (prevent overlap), delete-only-what-AI-created guardrails, and scoped auto-parenting.

**Pattern:** Give the agent real evidence -- traces, screenshots, logs -- not just symptoms.

### 3. Performance Debugging with Constraints

> *"Our biggest problem right now left performance is that over time our mouse movements cause frame drops... for some reason as I interact with the platform over time the more frames I drop to the point that frames are taking 70-90ms and dropping below 15 FPS. Is there some sort of memory leak somewhere? I load into a 50 object board. I don't create anything new. Zoom out, see all objects in my viewport, I move things around, change some colors, 3-5 minutes go by and I'm on frame hell. Dropping to 15 FPS with just mouse movements. The caveat to all of this is that multi-user support is a hard requirement. Other users must be able to see cursor position of other users. How do we tackle this?"*

**Why it worked:** Provided reproduction steps (50 objects, zoom out, interact for 3-5 minutes), specific metrics (70-90ms frames, 15 FPS), a hypothesis (memory leak), and a constraint (multi-user cursors are non-negotiable). The agent couldn't just "turn off cursor sync" -- it had to find a better architecture. Led to decoupling cursor presence from the Yjs CRDT into a lightweight WebSocket protocol.

**Pattern:** Reproduction steps + constraints prevent the agent from taking shortcuts that break requirements.

### 4. Letting the Agent Prioritize

> *"Lets review our docs and lets determine where we go next. Give me a list and I'll help decide."*

**Why it worked:** Instead of dictating tasks, the agent read the build checklist, analyzed dependencies, and proposed prioritized batches. The developer then selected which items to tackle. This leveraged plan mode's strength: the agent has full codebase context and can assess what's blocking what.

**Pattern:** Use plan mode to let the agent analyze state and propose work rather than micromanaging.

### 5. Test-Driven Verification

Throughout development, performance and reliability tests were written early and treated as first-class agent tools:

- `bun run perf:ws:ci` -- WebSocket sync benchmarks (latency, throughput, capacity)
- `bun run perf:frontend:ci` -- Playwright-based FPS, input-to-render, long frame measurement
- `bun run ai:perf-check` -- AI response latency vs budgets from LangSmith traces
- `bun run ai:reliability-check` -- AI command success rate

After every feature, the agent ran the relevant perf check. Instead of "does it look right?" the agent had concrete pass/fail signals. This turned performance from a subjective concern into an enforceable contract.

---

## Code Analysis

**~99% AI-generated.** The developer wrote virtually no code by hand. Human contributions were limited to occasional minor CSS tweaks and copy edits. The intent from day one was to rely entirely on agentic development.

The entire codebase -- backend (Elysia server, WebSocket handlers, Yjs room management, AI agent with 11 tools), frontend (Next.js app, Konva.js canvas with 7 element types, selection system, transforms, AI chat panel), shared packages, database schema, Docker configuration, CI/CD pipeline, performance benchmarks, and analysis scripts -- was produced by the Cursor agent across 112 sessions.

---

## Strengths and Limitations

### Where AI Excelled

- **Systematic multi-file refactoring**: Changing the frame model from spatial containment to explicit `frameId` touched 7 files with coordinated changes. The agent tracked all call sites and updated them consistently.
- **Performance infrastructure**: Building benchmarks, budget enforcement, CI integration, and Playwright-based perf tests from scratch -- the agent handled the entire pipeline.
- **Exploring unfamiliar APIs**: Yjs CRDT internals, Konva.js canvas rendering, LangChain tool calling, LangSmith SDK -- the agent learned and applied these effectively.
- **Consistency at scale**: `AGENTS.md` rules ensured every session followed the same patterns (auth-first, Yjs source of truth, performance budgets enforced). No drift across 112 sessions.
- **Boilerplate and wiring**: UI components (shadcn/ui), API routes, database schemas, TypeScript types -- the agent generated these quickly and correctly.

### Where AI Struggled

- **Canvas rendering nuances**: Konva-specific behaviors (layer ordering, hit detection regions, transform origins) required human visual testing. The agent couldn't "see" that a rotation handle was in the wrong position or that a connector endpoint was offset by 2 pixels.
- **Performance profiling**: The agent could run benchmarks and read numbers, but couldn't perceive lag. Human testing with "it feels slow after 3 minutes" was essential input that the agent couldn't generate on its own.
- **AI latency optimization**: Required multiple rounds of human-guided debugging with real LangSmith traces. The agent could implement optimizations, but identifying which optimization to try next required human analysis of actual trace data.
- **UX judgment calls**: When should a frame highlight during drag? How long should a tooltip linger? These required human testing and course corrections.

---

## Key Learnings

1. **Plan mode for anything complex.** Always use plan mode for multi-file changes. The agent researches first, proposes a plan, gets approval, then executes. This prevents wasted work on wrong approaches and gives the developer a chance to course-correct before code is written.

2. **`AGENTS.md` as persistent context.** Project rules, immutable constraints, and workflow instructions survive across all sessions. This was the single most impactful pattern -- without it, every session would start from scratch and risk violating architectural decisions.

3. **Memory protocol prevents knowledge loss.** `decisions.md` (17 ADRs), `known-issues.md`, and `build-checklist.md` give each new session historical context. The agent reads these before starting work and updates them after completing features. No decision is made twice; no known issue is re-investigated.

4. **Test-driven AI development.** Writing performance and reliability tests early gave the agent concrete pass/fail signals. Instead of "make it fast," the agent could run `bun run perf:ws:ci` and see if budgets pass. This transformed subjective quality into enforceable contracts.

5. **Skills for domain expertise.** Cursor Skills injected best practices for specific technologies without bloating every prompt. The agent loaded the relevant skill when it encountered a technology-specific task (auth setup, state management, frontend optimization).

6. **Rich prompts with constraints beat vague instructions.** The most productive sessions started with: problem description + reproduction steps + constraints + suggested direction. The least productive started with vague requests like "make this better."

---

## Note on AI Agent Latency

Our automated perf check reports single-step p95 latency of 3268ms against a 2000ms budget. This metric is inflated because complex template commands (SWOT analysis, diagrams, column layouts) were optimized into single atomic tool calls. These are semantically multi-step operations -- creating 10-20 elements with positioning, frames, and relationships -- but execute as one LLM round-trip with a large structured JSON output.

Simple single-object commands (create a sticky note, move an element, change a color) consistently complete in 1-2 seconds, well within budget. This is a deliberate trade-off: better UX through atomic creation of complex templates, at the cost of higher tail latency on those specific commands. The alternative -- splitting templates into multiple LLM round-trips -- would be slower overall and risk partial failures.
