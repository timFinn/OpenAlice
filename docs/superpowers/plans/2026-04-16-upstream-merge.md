# Upstream Merge Plan (PR #102–#124)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge ~60 upstream commits (PRs #102–#124) into the fork while preserving all fork-specific features (signal router, Market Pulse, paper bot scorecard, economy tools, quote streaming, dual accounts, safety guards).

**Architecture:** Single merge commit from `upstream/master` into the fork branch. The dry-run shows 10 conflict files across 134 changed files (+8082/-3444 lines). We resolve conflicts in priority order: backend core → tools → UI routing → UI pages. Each conflict gets its own resolution + verification step.

**Tech Stack:** TypeScript, tsup bundler, pnpm, systemd service

**Branch:** `merge/upstream-beta12` (created from current HEAD)

---

## Pre-Merge: Conflict Map

The dry-run merge identified these 10 conflict files, grouped by subsystem:

| # | File | Conflict Nature |
|---|------|----------------|
| 1 | `src/main.ts` | Fork adds signal-router/quote-cache/guards boot; upstream adds session tools, persona hot-reload, AgentEvent system |
| 2 | `src/core/config.ts` | Auto-merged but high-risk — fork stripped config, upstream rewrote for profile system |
| 3 | `src/connectors/web/web-plugin.ts` | Fork adds dashboard route; upstream adds news, persona, trading-config, tools routes |
| 4 | `src/task/heartbeat/heartbeat.ts` | Fork has active-hours guard + compaction; upstream adds AgentEvent emission |
| 5 | `src/tool/analysis.ts` | Fork expanded indicators; upstream added dataRange + commodity support |
| 6 | `src/tool/trading.ts` | Fork added guard integration; upstream added Decimal fields + TPSL |
| 7 | `src/domain/analysis/indicator/functions/technical.ts` | Both sides added indicator functions |
| 8 | `ui/src/App.tsx` | Fork adds MarketPulse/Heartbeat/AgentStatus routes; upstream reorganized to Automation/Logs/News/Connectors |
| 9 | `ui/src/components/Sidebar.tsx` | Fork adds Pulse/Heartbeat/Signals nav; upstream reorganized nav structure |
| 10 | `ui/src/pages/PortfolioPage.tsx` | Fork adds PaperScorecard; upstream adds currency-aware display + FX sidebar |
| — | `ui/src/api/index.ts` | Fork adds dashboard API; upstream adds news/persona/tools APIs |

Additionally, upstream creates files the fork previously deleted (and vice versa). These auto-resolve but need verification:
- Upstream adds: `LogsPage.tsx`, `NewsCollectorPage.tsx`, `ConnectorsPage.tsx`, `DevPage.tsx` expansion, `SettingsPage.tsx` expansion
- Upstream deletes: `HeartbeatPage.tsx`, `ToolsPage.tsx`, `AgentStatusPage.tsx` (fork has its own versions)
- Fork has: `MarketPulsePage.tsx`, `FearGreedGauge.tsx`, `PaperScorecard.tsx`, `SignalFeed.tsx` (fork-only, no conflict)

---

### Task 0: Prepare the Merge Branch

**Files:**
- Modify: working tree state

- [ ] **Step 0.1: Commit the SDK update**

The agent-sdk 0.2.72 → 0.2.110 update is currently uncommitted. Commit it first so the merge branch starts clean.

```bash
cd /home/tim/projects/trading/OpenAlice
git add package.json pnpm-lock.yaml
git commit -m "chore: update @anthropic-ai/claude-agent-sdk 0.2.72 → 0.2.110"
```

- [ ] **Step 0.2: Create the merge branch**

```bash
git checkout -b merge/upstream-beta12
```

- [ ] **Step 0.3: Start the merge**

```bash
git merge --no-ff upstream/master -m "Merge upstream/master (PRs #102-#124) into fork"
```

This will stop with 10 conflicts. Do NOT abort — the remaining tasks resolve each conflict.

---

### Task 1: Resolve `src/main.ts`

**Files:**
- Modify: `src/main.ts`

This is the application entry point. Both sides added initialization code.

- [ ] **Step 1.1: Open the file and examine conflict markers**

```bash
grep -n "<<<<<<" src/main.ts
```

- [ ] **Step 1.2: Resolve — keep BOTH sides**

The fork's additions (signal-router startup, quote-cache init, guard registration, dual-account streaming) and upstream's additions (session tools, persona hot-reload, AgentEvent system, snapshot management) are independent features. Accept both blocks. The merge resolution should:

1. Keep all fork imports (signal-router, quote-cache, guards)
2. Add all upstream imports (session tools, agent-event, persona, snapshot)
3. In the boot sequence, keep fork's init order then append upstream's new inits
4. If upstream changed the AI provider initialization (profile-based), keep upstream's version — the fork didn't modify that path

```bash
# After manual resolution:
git add src/main.ts
```

- [ ] **Step 1.3: Verify it parses**

```bash
npx tsc --noEmit src/main.ts 2>&1 | head -20
```

Fix any type errors before proceeding.

---

### Task 2: Resolve `src/connectors/web/web-plugin.ts`

**Files:**
- Modify: `src/connectors/web/web-plugin.ts`

Fork added `/api/dashboard` route. Upstream added `/api/news`, `/api/persona`, `/api/trading-config`, `/api/tools` routes.

- [ ] **Step 2.1: Examine conflicts**

```bash
grep -n "<<<<<<" src/connectors/web/web-plugin.ts
```

- [ ] **Step 2.2: Resolve — keep ALL routes**

Both sides add new route registrations. Accept both. The routes don't overlap — each mounts a different path prefix.

```bash
git add src/connectors/web/web-plugin.ts
```

---

### Task 3: Resolve `src/task/heartbeat/heartbeat.ts`

**Files:**
- Modify: `src/task/heartbeat/heartbeat.ts`

Fork added active-hours guard, compaction threshold, and microcompact logic. Upstream added AgentEvent emission on heartbeat fire/skip.

- [ ] **Step 3.1: Examine conflicts**

```bash
grep -n "<<<<<<" src/task/heartbeat/heartbeat.ts
```

- [ ] **Step 3.2: Resolve — keep fork's guard logic + add upstream's event emission**

The fork's active-hours and compaction logic is the more complete version. Add upstream's `AgentEvent.emit(...)` calls at the appropriate points (after heartbeat fires, after skip). Don't lose the fork's compaction threshold or microcompact logic.

```bash
git add src/task/heartbeat/heartbeat.ts
```

---

### Task 4: Resolve `src/tool/analysis.ts`

**Files:**
- Modify: `src/tool/analysis.ts`

Fork expanded indicator list. Upstream added `dataRange` return field and commodity asset class support.

- [ ] **Step 4.1: Examine conflicts**

```bash
grep -n "<<<<<<" src/tool/analysis.ts
```

- [ ] **Step 4.2: Resolve — merge both enhancements**

Keep fork's expanded indicator list AND upstream's `dataRange` + commodity support. These are additive changes to the same tool definition — the indicator list is one field, dataRange is a new return field, commodity is a new asset class in the schema.

```bash
git add src/tool/analysis.ts
```

---

### Task 5: Resolve `src/tool/trading.ts`

**Files:**
- Modify: `src/tool/trading.ts`

Fork integrated safety guards into order placement. Upstream added Decimal string fields and TPSL (take-profit/stop-loss) parameters.

- [ ] **Step 5.1: Examine conflicts**

```bash
grep -n "<<<<<<" src/tool/trading.ts
```

- [ ] **Step 5.2: Resolve — keep both**

The guard check wraps order execution (pre-check before placing). Upstream's Decimal fields and TPSL are changes to the order parameters/response types. These compose:
1. Keep upstream's Decimal field types and TPSL parameters
2. Keep fork's guard pre-check before `placeOrder()`
3. Guards should check against the new Decimal values (may need `parseFloat()` or `Decimal` comparison)

```bash
git add src/tool/trading.ts
```

---

### Task 6: Resolve `src/domain/analysis/indicator/functions/technical.ts`

**Files:**
- Modify: `src/domain/analysis/indicator/functions/technical.ts`

Both sides added indicator calculation functions.

- [ ] **Step 6.1: Examine conflicts**

```bash
grep -n "<<<<<<" src/domain/analysis/indicator/functions/technical.ts
```

- [ ] **Step 6.2: Resolve — keep all functions**

Both sides added new exports to this file. Accept all functions from both sides. Check for duplicate function names — if both sides added the same indicator, keep upstream's version (it has dataRange support).

```bash
git add src/domain/analysis/indicator/functions/technical.ts
```

---

### Task 7: Resolve UI Routing (`ui/src/App.tsx`, `ui/src/components/Sidebar.tsx`, `ui/src/api/index.ts`)

**Files:**
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/components/Sidebar.tsx`
- Modify: `ui/src/api/index.ts`

Upstream reorganized navigation: Tools → merged into Settings (now "Automation"), Events → Automation, added Logs/News/Connectors pages. Fork added MarketPulse, Heartbeat monitor, AgentStatus, SignalFeed pages.

- [ ] **Step 7.1: Examine all three conflicts**

```bash
grep -n "<<<<<<" ui/src/App.tsx ui/src/components/Sidebar.tsx ui/src/api/index.ts
```

- [ ] **Step 7.2: Resolve App.tsx — adopt upstream's page structure + add fork pages**

Upstream's reorganization is the new canonical structure. Accept upstream's route layout, then ADD fork-specific routes:
- `/pulse` → `MarketPulsePage`
- `/heartbeat` → keep if upstream didn't remove the concept (they reorganized into Scheduler+Logs — decide if fork's standalone HeartbeatPage still makes sense or should fold into upstream's Logs page)
- `/agent-status` → upstream removed `AgentStatusPage` and folded into Scheduler — keep fork's version as a separate route if it has unique functionality

```bash
git add ui/src/App.tsx
```

- [ ] **Step 7.3: Resolve Sidebar.tsx — upstream nav structure + fork additions**

Accept upstream's nav reorganization. Add fork-specific nav items:
- "Pulse" link under a Markets section or top-level
- Keep or remove Heartbeat/AgentStatus links depending on Step 7.2 decision

```bash
git add ui/src/components/Sidebar.tsx
```

- [ ] **Step 7.4: Resolve api/index.ts — keep all API exports**

Both sides add API module re-exports. Accept all — `dashboard`, `news`, `persona`, `tools` APIs.

```bash
git add ui/src/api/index.ts
```

---

### Task 8: Resolve `ui/src/pages/PortfolioPage.tsx`

**Files:**
- Modify: `ui/src/pages/PortfolioPage.tsx`

Fork added PaperScorecard component. Upstream added currency-aware display with FX rates sidebar.

- [ ] **Step 8.1: Examine conflicts**

```bash
grep -n "<<<<<<" ui/src/pages/PortfolioPage.tsx
```

- [ ] **Step 8.2: Resolve — keep both**

Accept upstream's currency-aware portfolio layout and FX sidebar. Add fork's `<PaperScorecard />` component into the page (likely below the portfolio summary or in a tab). Both are additive UI sections.

```bash
git add ui/src/pages/PortfolioPage.tsx
```

---

### Task 9: Handle Upstream Add/Delete Mismatches

**Files:**
- Verify: `ui/src/pages/HeartbeatPage.tsx` (upstream deletes, fork has custom version)
- Verify: `ui/src/pages/ToolsPage.tsx` (upstream deletes, fork has custom version)
- Verify: `ui/src/pages/AgentStatusPage.tsx` (upstream deletes, fork has custom version)
- Verify: `ui/src/pages/LogsPage.tsx` (upstream adds new version)
- Verify: `ui/src/pages/NewsCollectorPage.tsx` (upstream adds)
- Verify: `ui/src/pages/ConnectorsPage.tsx` (upstream adds)
- Verify: `ui/src/pages/DevPage.tsx` (upstream expands significantly)

- [ ] **Step 9.1: Check which files git auto-resolved vs deleted**

```bash
git status -- ui/src/pages/ | grep -E "(deleted|new file|modified)"
```

- [ ] **Step 9.2: Decide on page overlaps**

The fork has standalone pages that upstream reorganized into combined views:
- **HeartbeatPage**: Fork has 348-line monitor. Upstream folded heartbeat into Scheduler+Logs. **Keep fork's version** if it has features the upstream Logs page doesn't (real-time status, prompt editing).
- **ToolsPage**: Fork has 217-line tool discovery. Upstream merged into Settings. **Decide**: keep as separate page or adopt upstream's Settings integration.
- **AgentStatusPage**: Fork has agent status monitor. Upstream removed it. **Keep fork's version** — it serves the autonomous bot use case.

- [ ] **Step 9.3: Re-add any fork pages that git deleted**

If the merge deleted fork-specific pages (because upstream deleted the file), restore them:

```bash
# Example — only run for files that were incorrectly deleted:
git checkout HEAD -- ui/src/pages/HeartbeatPage.tsx
git checkout HEAD -- ui/src/pages/AgentStatusPage.tsx
# etc.
```

- [ ] **Step 9.4: Accept upstream's new pages**

Upstream's new pages (`LogsPage`, `NewsCollectorPage`, `ConnectorsPage`, expanded `DevPage`) should come in as-is. These don't conflict with fork features.

```bash
git add ui/src/pages/LogsPage.tsx ui/src/pages/NewsCollectorPage.tsx ui/src/pages/ConnectorsPage.tsx ui/src/pages/DevPage.tsx
```

---

### Task 10: Post-Merge Verification

**Files:**
- All resolved files

- [ ] **Step 10.1: Verify no remaining conflict markers**

```bash
grep -rn "<<<<<<" src/ ui/src/ --include="*.ts" --include="*.tsx"
```

Must return zero results.

- [ ] **Step 10.2: Type check**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Fix any type errors. Common issues to expect:
- Missing imports for upstream's new types (`AgentEvent`, `Decimal`, `FxService`)
- Fork's guard code referencing old numeric types where upstream switched to Decimal strings
- Removed re-exports that fork code depends on

- [ ] **Step 10.3: Run tests**

```bash
npx vitest run 2>&1 | tail -20
```

Target: all 942+ existing tests pass, plus any new upstream tests.

- [ ] **Step 10.4: Build the bundle**

```bash
npx tsup src/main.ts --format esm --dts
```

Must succeed with no errors (the eval warning in calculate.tool.ts is expected).

- [ ] **Step 10.5: Build the frontend**

```bash
cd ui && npx vite build 2>&1 | tail -10
```

- [ ] **Step 10.6: Commit the merge**

```bash
cd /home/tim/projects/trading/OpenAlice
git commit -m "Merge upstream/master (PRs #102-#124) into fork

Upstream changes:
- AgentEvent type system with runtime validation
- Decimal precision for monetary fields (all brokers)
- Profile-based AI config with preset catalog
- Codex AI provider (OpenAI via ChatGPT OAuth)
- UI reorganization (Automation, Logs, News pages)
- News feed view with filtering + /api/news endpoint
- Currency-aware portfolio + FX rates
- CCXT Hyperliquid support + dynamic credentials
- Commodity canonical naming + catalog
- Telegram auth + trading panel
- Session awareness tools + Dev workbench

Fork features preserved:
- Signal router (8 signals, 2m poll)
- Market Pulse dashboard (/pulse)
- Paper bot scorecard + attribution
- Economy tools (FRED, CPI, rates)
- Quote streaming (Alpaca WS + CCXT Pro)
- Safety guards (6 autonomous guards)
- Dual account architecture
- Heartbeat active-hours + compaction
- Fear & Greed, GDELT, prediction markets"
```

---

### Task 11: Smoke Test the Running Service

- [ ] **Step 11.1: Restart the service**

```bash
systemctl --user restart open-alice.service
```

- [ ] **Step 11.2: Watch logs for 2 minutes**

```bash
journalctl --user -u open-alice.service -f --no-pager
```

Verify:
- Service starts without crash
- News collector fetches successfully
- No `Claude Code process exited with code 1` errors
- Heartbeat fires (if within active hours) without crash
- Signal router fires (if within market hours) without crash

- [ ] **Step 11.3: Check the UI**

Open the web UI and verify:
- Dashboard/chat loads
- Market Pulse page (`/pulse`) renders
- Portfolio page shows data (with new currency display if applicable)
- New upstream pages (Automation, Logs, News) load
- Sidebar navigation includes both upstream and fork items

- [ ] **Step 11.4: Commit and push**

```bash
git push origin merge/upstream-beta12
```
