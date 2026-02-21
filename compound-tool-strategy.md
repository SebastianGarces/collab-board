**Compound Tool Strategy: Reducing AI Tool Calls for Complex Board Objects**

**The Problem**

When an AI agent builds complex whiteboard templates (SWOT analysis, flowcharts, kanban boards), a naive approach requires multiple LLM round-trips:

1. Create a frame
2. Create axis lines
3. Create axis labels
4. Create quadrant labels
5. Create sticky notes (one call per batch)
6. Assign all children to the frame
7. Resize the frame to fit

For a SWOT diagram, that's 7+ tool calls — each one a full LLM request/response cycle. Every round-trip adds latency (~1-2s each), risks partial failure (half the diagram exists if step 4 errors), and increases token cost (the full system prompt + board state is re-sent every call).

**The Solution: Compound Tools**

We moved the layout logic server-side into single atomic tools. Instead of the LLM orchestrating 7 steps, it makes one call with declarative intent and the server handles all element creation, positioning, and frame management in a single Yjs transaction.

`createQuadrant` is a good example. The LLM call looks like:

```json
{
  "tool": "createQuadrant",
  "args": {
    "title": "SWOT Analysis",
    "xAxisLabel": "Impact",
    "yAxisLabel": "Likelihood",
    "quadrantLabels": {
      "topLeft": "Strengths",
      "topRight": "Weaknesses",
      "bottomLeft": "Opportunities",
      "bottomRight": "Threats"
    },
    "items": {
      "topLeft": ["Strong brand", "Loyal customers"],
      "topRight": ["High costs", "Legacy tech"],
      "bottomLeft": ["New markets", "AI adoption"],
      "bottomRight": ["Competitors", "Regulation"]
    }
  }
}
```

One tool call. The server then creates ~15-20 elements in a single Yjs transaction: a frame, two axis lines, four axis endpoint labels, four quadrant section titles, and eight sticky notes — all correctly positioned in a grid layout with per-quadrant colors, auto-fit frame, and proper parent-child relationships.

**What the server does inside that one call:**
- Scans existing elements to find open canvas space (collision avoidance)
- Creates the frame
- Draws horizontal + vertical axis lines
- Places axis labels (Low ← → High)
- Places quadrant section titles (Strengths, Weaknesses, etc.)
- Creates sticky notes in a grid within each quadrant with distinct colors
- Assigns all children to the frame via `frameId`
- Auto-fits the frame to content

**We apply the same pattern to three compound tools:**

| Tool | What it replaces | Elements created |
|---|---|---|
| `createQuadrant` | 7+ calls for SWOT/matrix diagrams | Frame + axes + labels + sticky notes |
| `createColumnLayout` | 5+ calls for kanban/retro/journey maps | Frame + column headings + sticky notes |
| `createDiagram` | N+E calls for flowcharts/org charts | Nodes + connectors + auto-layout |

**Results:**

- **Latency**: Complex templates complete in a single LLM round-trip (~2-3s) instead of 7+ sequential calls (~10-15s)
- **Reliability**: Atomic Yjs transaction = all-or-nothing. No half-built diagrams from mid-sequence failures
- **Cost**: One LLM call instead of 7+ means the system prompt + board state context (~2,500+ tokens) is sent once, not seven times
- **Sync**: All elements appear simultaneously for every connected user, instead of trickling in one-by-one

The trade-off is slightly higher p95 latency on these specific commands (the single call does more work), but overall user-perceived speed is dramatically better since there's only one round-trip instead of many.
