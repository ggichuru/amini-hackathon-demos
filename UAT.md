# User Acceptance Testing (UAT) — Hackathon Demo Suite

**Test date:** 2026-08-13
**Method:** Automated browser walkthrough (Playwright, headless Chromium) against the **live production** GitHub Pages deployments — not local files. Each test drives the real UI the way a judge would, and records the actual on-screen output.
**Result:** **4 of 4 applications ACCEPTED.** One defect was found during testing (Shamba Steward), fixed at source, redeployed, and re-verified live before sign-off.

| App | Live URL | Verdict |
|---|---|---|
| Runway | https://ggichuru.github.io/amini-hackathon-demos/runway/ | ✅ ACCEPTED |
| GreenHour | https://ggichuru.github.io/amini-hackathon-demos/greenhour/ | ✅ ACCEPTED |
| PatternForge | https://ggichuru.github.io/amini-hackathon-demos/patternforge/ | ✅ ACCEPTED |
| Shamba Steward (demo) | https://ggichuru.github.io/amini-hackathon-demos/steward/ | ✅ ACCEPTED (after fix) |

---

## 1. Runway — financial resilience simulator

| ID | Scenario | Steps | Expected | Actual (observed) | Status |
|---|---|---|---|---|---|
| RW-01 | Baseline runway computes | Load page with income 4000 / expenses 2500 / savings 6000 / buffer 0 | A runway in months + a "funded until" date + a resilience band/score | "25 October 2026", **2.4 months of runway**, band **Critical**, score **20/100** | ✅ Pass |
| RW-02 | Live recalculation | Edit an input | Result updates with no submit button | Hero verdict recomputes on keystroke | ✅ Pass |
| RW-03 | Stress test — recurring rise | Click "Rent jumps 25%" | Baseline vs shocked panel + months lost + impact label | Baseline 2.4mo → **After Shock 1.9mo**, **Months Lost 0.5**, "Minor impact" | ✅ Pass |
| RW-04 | Stress test — one-off shock | Click "Medical bill $5,000" | Runway drops by a lump-sum amount | Shocked runway + months-lost recomputed for a $5,000 hit | ✅ Pass |
| RW-05 | Recommendations present | Read "How to extend your runway" | Concrete actions, each with months gained (not "No recommendations available") | **"Add one month of expenses +1.0mo / Cut $500/mo +0.6mo / Add $1000 +0.4mo"** | ✅ Pass |
| RW-06 | Privacy | Inspect network | No data leaves the browser | All computation client-side; no backend calls | ✅ Pass |

**Console errors:** none. **Sign-off:** Accepted.

---

## 2. GreenHour — greenest-hour carbon scheduler

| ID | Scenario | Steps | Expected | Actual (observed) | Status |
|---|---|---|---|---|---|
| GH-01 | Live carbon data fetch | Load page | Fetches a real carbon-intensity feed (National Grid) without CORS failure | API fetch succeeded, **no CORS errors** | ✅ Pass |
| GH-02 | Greenest window identified | Read result | A specific low-carbon time window vs a usual time | **Greenest 119 g CO2 (14:30–16:00)** vs usual **208 g (18:00)** | ✅ Pass |
| GH-03 | Savings quantified | Read summary | A percentage + annualised saving | **43% lower**, projects **~13.9 kg CO2/year** saved | ✅ Pass |
| GH-04 | Visualisation | Observe chart | A 48-hour intensity chart renders | 48h intensity chart displayed | ✅ Pass |

**Console errors:** none. **Sign-off:** Accepted.
*(Prior defect, already fixed before this run: an encoded colon in the API query string caused a redirect that dropped the CORS header — resolved by sending the raw timestamp.)*

---

## 3. PatternForge — regex by example

| ID | Scenario | Steps | Expected | Actual (observed) | Status |
|---|---|---|---|---|---|
| PF-01 | Synthesis from a painted example | Paint "alice@example.com" as a positive example | A regex is synthesised | **`\w+@\w+\.\w+`** generated | ✅ Pass |
| PF-02 | Live match feedback | Observe match counts | Highlighted matches + counts | **1 green example / 2 live matches** | ✅ Pass |
| PF-03 | Explainability | Read output | A plain-English explanation of the pattern | Plain-English explanation rendered | ✅ Pass |
| PF-04 | Expected-use clarity | Click "Load sample" | Loads text to paint on (does not auto-synthesise) | Loads text only; synthesis requires painting — **by design, not a defect** | ✅ Pass |

**Console errors:** none. **Sign-off:** Accepted.

---

## 4. Shamba Steward (browser demo) — agentic farm-ops assistant

| ID | Scenario | Steps | Expected | Actual (observed) | Status |
|---|---|---|---|---|---|
| SS-01 | No-key sample run | Click "Try with sample (no key)" | Agent runs without an API key and shows a plan | **DEFECT (see log), then:** full Parse→Plan→Verify→Deliver pipeline runs | ✅ Pass (after fix) |
| SS-02 | Deliverable output | Reach step 4 | A calendar file + a drafted message | **Download .ics** offered; market message **"Sell 3 bags of maize at the local market"** | ✅ Pass |
| SS-03 | No runtime errors | Inspect console | No uncaught errors | **0 console errors** after fix | ✅ Pass |
| SS-04 | Real model path guarded | Click "Run Agent" with no key | Prompts for a Gemini key rather than failing silently | Prompts for key; real path calls Gemini directly from the browser | ✅ Pass |

### Defect log — SS-DEF-01 (found and closed during this UAT)
- **Symptom:** clicking "Try with sample (no key)" threw `Uncaught ReferenceError: runAgent is not defined`; no plan rendered.
- **Root cause:** the deployed bundle was **stale**. The current source wired the button correctly via `addEventListener`, but the served build predated that fix and relied on an inline `onclick="runAgent(true)"`; the bundler's IIFE kept `runAgent` out of global scope, and the no-key error branch also injects an inline-`onclick` fallback button that needs the global.
- **Fix:** exposed `window.runAgent = runAgent` in source (`main.ts`), rebuilt the bundle with esbuild, redeployed both `main.js` and a clean `index.html`.
- **Verification:** re-fetched the **live** served `main.js` and confirmed the global export is present; re-ran the browser walkthrough — ReferenceError gone, full pipeline renders, 0 console errors.
- **Status:** Closed.

**Sign-off:** Accepted.

---

## Acceptance summary

- 4 / 4 applications accepted against live production URLs.
- 1 defect found during UAT, fixed at source (not patched on the artifact only), redeployed, and re-verified live.
- 0 outstanding console errors across all four apps.
