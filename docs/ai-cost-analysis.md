# AI Cost Analysis

**Project:** CollabBoard -- Real-Time Collaborative Whiteboard with AI Agent
**Generated:** February 20, 2026
**Data Source:** LangSmith traces (all AI agent commands during development)

---

## Development Spend

Total cost of all AI agent operations during the 5-day development period:

| Metric | Value |
|---|---|
| Total cost | $1.56 |
| Total tokens | 1,297,526 |
| Input tokens | 1,235,994 (95.3%) |
| Output tokens | 61,532 (4.7%) |
| Total LLM API calls | 495 |
| Total AI commands executed | 270 |

### Per-Command Averages

| Metric | Value |
|---|---|
| Avg tokens/command | 4,806 |
| Avg input tokens | 4,578 |
| Avg output tokens | 228 |
| Avg cost/command | $0.0058 |

---

## Model Breakdown (Development)

Multiple models were tested during development to find the best balance of speed, reliability, and cost:

| Model | Input Tokens | Output Tokens | Total Tokens | Cost | API Calls |
|---|---|---|---|---|---|
| **gpt-5.1** | 533,749 | 35,126 | 568,875 | $0.71 | 153 |
| gpt-4o | 359,682 | 12,690 | 372,372 | $0.80 | 183 |
| gpt-4.1-nano | 215,694 | 7,051 | 222,745 | $0.02 | 93 |
| gpt-4o-mini | 118,213 | 4,733 | 122,946 | $0.02 | 54 |
| gpt-5-mini | 5,817 | 802 | 6,619 | $0.003 | 4 |
| ChatGoogle (Gemini) | -- | -- | -- | $0.00 | 3 |
| gpt-5-nano | 2,839 | 1,130 | 3,969 | $0.001 | 3 |
| gpt-5.1-mini | -- | -- | -- | $0.00 | 2 |

---

## Production Model Selection: GPT-5.1

After testing multiple models, **GPT-5.1** was selected as the production model for the following reasons:

- **System prompt comprehension**: Best understanding of our complex system prompt with 11 tool schemas, placement rules, and frame auto-parenting logic. Cheaper models (gpt-4.1-nano, gpt-4o-mini) frequently ignored tool constraints or produced malformed JSON for complex template commands.
- **Speed on simple commands**: Single-object creation and modification commands consistently complete in 1-2 seconds.
- **Reliable tool calling**: Correctly selects the right tool and provides valid arguments on the first attempt for the vast majority of commands. Lower error rate means fewer retry loops.
- **Trade-off acknowledged**: GPT-5.1 is pricier per token than alternatives, but its reliability reduces total cost per successful command (fewer retries, fewer multi-step corrections).

---

## Production Cost Projections (GPT-5.1)

These projections use the per-command cost observed with GPT-5.1 specifically, not the blended average across all development models.

**Assumptions:**
- 10 AI commands per user per session
- 20 sessions per user per month
- 200 commands per user per month

| Users | Monthly Commands | Monthly Cost | Cost/User/Month |
|---|---|---|---|
| 100 | 20,000 | $52.62 | $0.53 |
| 1,000 | 200,000 | $526.24 | $0.53 |
| 10,000 | 2,000,000 | $5,262.45 | $0.53 |
| 100,000 | 20,000,000 | $52,624.46 | $0.53 |

---

## Model Cost Comparison

To illustrate the cost-reliability trade-off, here are projections for each model tested:

| Model | Avg Cost/Command | 1K Users/Month | 10K Users/Month | 100K Users/Month | Notes |
|---|---|---|---|---|---|
| **gpt-5.1** | $0.00263 | $526 | $5,262 | $52,624 | Production choice -- best reliability |
| gpt-4o | $0.00298 | $596 | $5,962 | $59,617 | Slower, similar cost, lower reliability |
| gpt-4.1-nano | $0.00008 | $16 | $160 | $1,603 | Very cheap but unreliable on complex tools |
| gpt-4o-mini | $0.00007 | $14 | $135 | $1,353 | Very cheap but unreliable on complex tools |

**Key insight:** The nano/mini models are 30-40x cheaper per command but require significantly more retry loops and produce more errors on complex template commands (SWOT analysis, flowcharts, column layouts). For simple commands, a model routing strategy could use a cheaper model and fall back to gpt-5.1 for complex operations.

---

## Optimization Opportunities

1. **Model routing**: Route simple commands (create single element, move, recolor) to gpt-4o-mini or gpt-4.1-nano ($0.01/user/month) and reserve gpt-5.1 for complex templates. Could reduce average cost by 60-70%.

2. **Prompt caching**: OpenAI prompt caching would reduce input token costs on the system prompt (~2,500 tokens) which is identical across all commands. At 200 commands/user/month, this saves ~500K cached tokens/user/month.

3. **Request batching**: For template commands that create many elements, the current `batchCreateElements` tool already minimizes round-trips. Further batching of user commands within a session window could reduce per-command overhead.

4. **Output token optimization**: Average output is only 228 tokens/command (4.7% of total). The bulk of cost is input tokens from the system prompt and board state context. Reducing `getBoardState` payload size for large boards would have the highest impact.

---

## Other Related Costs

| Service | Monthly Cost (Estimate) | Notes |
|---|---|---|
| Railway hosting (backend) | $5-20 | Bun container, scales with traffic |
| Railway hosting (frontend) | $5-20 | Next.js standalone container |
| Railway PostgreSQL | $5-10 | Included in plan |
| LangSmith tracing | $0 (free tier) | Dev/small-scale production |
| **Total infrastructure** | **$15-50/month** | Excluding AI API costs |

At 1,000 users, total monthly cost would be approximately $526 (AI) + $50 (infra) = **~$576/month**.

---

*Generated by `bun run ai:cost-analysis` from LangSmith trace data.*
*Raw data: `artifacts/ai-cost-analysis.json`*
