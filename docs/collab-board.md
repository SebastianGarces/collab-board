# Building Real-Time Collaborative Whiteboard Tools with AI-First Development

## Background
Miro solved hard problems: real-time synchronization, conflict resolution, and smooth performance while streaming data across networks. Multiple users brainstorm, map ideas, and run workshops simultaneously without merge conflicts. This project requires you to build production-scale collaborative whiteboard infrastructure, then extend it with an AI agent that manipulates the board through natural language. The focus is on AI-first development methodology—using coding agents, MCPs, and structured AI workflows throughout the build process.

**Gate: Project completion is required for Austin admission.**

---

## Project Overview
One-week sprint with three deadlines:

| Checkpoint | Deadline | Focus |
| :--- | :--- | :--- |
| **Pre-Search** | Monday (one hour in)  | Architecture, Planning  |
| **MVP** | Tuesday (24 hours)  | Collaborative infrastructure  |
| **Early Submission** | Friday (4 days)  | Full feature set  |
| **Final** | Sunday (7 days)  | Polish, documentation, deployment  |

---

## MVP Requirements (24 Hours)
Hard gate. All items required to pass:
* Infinite board with pan/zoom 
* Sticky notes with editable text 
* At least one shape type (rectangle, circle, or line) 
* Create, move, and edit objects 
* Real-time sync between 2+ users 
* Multiplayer cursors with name labels 
* Presence awareness (who's online) 
* User authentication 
* Deployed and publicly accessible 

> A simple whiteboard with bulletproof multiplayer beats a feature-rich board with broken sync.

---

## Core Collaborative Whiteboard
### Board Features
| Feature | Requirements |
| :--- | :--- |
| **Workspace** | Infinite board with smooth pan/zoom  |
| **Sticky Notes** | Create, edit text, change colors  |
| **Shapes** | Rectangles, circles, lines with solid colors  |
| **Connectors** | Lines/arrows connecting objects  |
| **Text** | Standalone text elements  |
| **Frames** | Group and organize content areas  |
| **Transforms** | Move, resize, rotate objects  |
| **Selection** | Single and multi-select (shift-click, drag-to-select)  |
| **Operations** | Delete, duplicate, copy/paste  |

### Real-Time Collaboration
| Feature | Requirements |
| :--- | :--- |
| **Cursors** | Multiplayer cursors with names, real-time movement  |
| **Sync** | Object creation/modification appears instantly for all users  |
| **Presence** | Clear indication of who's currently on the board  |
| **Conflicts** | Handle simultaneous edits (last-write-wins acceptable, document your approach)  |
| **Resilience** | Graceful disconnect/reconnect handling  |
| **Persistence** | Board state survives all users leaving and returning  |

### Performance Targets
| Metric | Target |
| :--- | :--- |
| **Frame rate** | 60 FPS during pan, zoom, object manipulation  |
| **Object sync latency** | <100ms  |
| **Cursor sync latency** | <50ms  |
| **Object capacity** | 500+ objects without performance drops  |
| **Concurrent users** | 5+ without degradation  |

---

## AI Board Agent
### Required Capabilities
Your AI agent must support at least 6 distinct commands across these categories:
* **Creation Commands:** e.g., "Add a yellow sticky note that says 'User Research'" , "Create a blue rectangle at position 100, 200" , "Add a frame called 'Sprint Planning'".
* **Manipulation Commands:** e.g., "Move all the pink sticky notes to the right side" , "Resize the frame to fit its contents" , "Change the sticky note color to green".
* **Layout Commands:** e.g., "Arrange these sticky notes in a grid" , "Create a $2\times3$ grid of sticky notes for pros and cons" , "Space these elements evenly".
* **Complex Commands:** e.g., "Create a SWOT analysis template with four quadrants" , "Build a user journey map with 5 stages" , "Set up a retrospective board with What Went Well, What Didn't, and Action Items columns".

### Tool Schema (Minimum)
* `createStickyNote(text, x, y, color)` 
* `createShape(type, x, y, width, height, color)` 
* `createFrame(title, x, y, width, height)` 
* `createConnector(fromId, told, style)` 
* `moveObject(objectId, x, y)` 
* `resizeObject(objectId, width, height)` 
* `updateText(objectId, newText)` 
* `changeColor(objectId, color)` 
* `getBoardState()` // returns current board objects for context 

### AI Agent Performance
| Metric | Target |
| :--- | :--- |
| **Response latency** | <2 seconds for single-step commands  |
| **Command breadth** | 6+ command types  |
| **Complexity** | Multi-step operation execution  |
| **Reliability** | Consistent, accurate execution  |

---

## AI-First Development Requirements
This week emphasizes learning AI-first development workflows. You must document your process.

### Required Tools
Use at least two of:
* Claude Code 
* Cursor 
* Codex 
* MCP integrations 

### AI Development Log (Required)
Submit a 1-page document covering:
* **Tools & Workflow:** AI coding tools used and integration method.
* **MCP Usage:** Which MCPs used and what they enabled.
* **Effective Prompts:** 3-5 prompts that worked well (include actual prompts).
* **Code Analysis:** Rough % of AI-generated vs hand-written code.
* **Strengths & Limitations:** Where AI excelled and where it struggled.
* **Key Learnings:** Insights about working with coding agents.

### AI Cost Analysis (Required)
Submit a cost analysis covering:
* **Development & Testing Costs:** Track actual spend including LLM API costs, total tokens (input/output breakdown), number of API calls, and other related costs.
* **Production Cost Projections:** Estimate monthly costs for 100, 1,000, 10,000, and 100,000 users. Include assumptions on commands per user, sessions per month, and tokens per command.

---

## Technical Stack
| Layer | Technology |
| :--- | :--- |
| **Backend** | Firebase, Supabase, AWS (DynamoDB, Lambda, WebSockets), or custom WebSocket server  |
| **Frontend** | React/Vue/Svelte with Konva.js, Fabric.js, PixiJS, HTML5 Canvas, or Vanilla JS  |
| **AI Integration** | OpenAI GPT-4 or Anthropic Claude with function calling  |
| **Deployment** | Vercel, Firebase Hosting, or Render  |

---

## Build Strategy: Priority Order
1. **Cursor sync:** Get two cursors moving across browsers.
2. **Object sync:** Create sticky notes that appear for all users.
3. **Conflict handling:** Handle simultaneous edits.
4. **State persistence:** Survive refreshes and reconnects.
5. **Board features:** Shapes, frames, connectors, transforms.
6. **AI commands (basic):** Single-step creation/manipulation.
7. **AI commands (complex):** Multi-step template generation.

---

## Submission Requirements
**Deadline: Sunday 10:59 PM CT **
* **GitHub Repository:** Setup guide, architecture overview, deployed link.
* **Demo Video (3-5 min):** Real-time collaboration, AI commands, architecture explanation.
* **Pre-Search Document:** Completed checklist from Phase 1-3.
* **AI Development Log:** 1-page breakdown using the required template.
* **AI Cost Analysis:** Dev spend + projections for tiered user counts.
* **Deployed Application:** Publicly accessible, supports 5+ users with auth.
* **Social Post:** Share on X or LinkedIn tagging @GauntletAI.

---

## Appendix: Pre-Search Checklist
*Complete before writing code. Save AI conversation as a reference document.*

### Phase 1: Define Your Constraints
1. **Scale & Load Profile:** Users at launch/6 months, traffic patterns, real-time needs.
2. **Budget & Cost Ceiling:** Monthly spend limits and trade-offs.
3. **Time to Ship:** MVP timeline and iteration cadence.
4. **Compliance & Regulatory Needs:** GDPR, HIPAA, SOC 2, data residency.
5. **Team & Skill Constraints:** Languages/frameworks known and learning appetite.

### Phase 2: Architecture Discovery
6. **Hosting & Deployment:** Serverless vs. containers, CI/CD, scaling.
7. **Authentication & Authorization:** social login, magic links, RBAC, multi-tenancy.
8. **Database & Data Layer:** Database type, sync, search, vector storage.
9. **Backend/API Architecture:** REST, GraphQL, tRPC, job queues.
10. **Frontend Framework:** SPA vs. SSR, SEO, offline support.
11. **Third-Party Integrations:** AI APIs, payments, vendor lock-in risk.

### Phase 3: Post-Stack Refinement
12. **Security Vulnerabilities:** Known pits and dependency risks.
13. **File Structure:** Folder patterns and repo organization.
14. **Naming Conventions:** Linting and style guides.
15. **Testing Strategy:** Unit, integration, e2e, and mocking patterns.
16. **Tooling & DX:** Extensions, CLI tools, debugging setup.