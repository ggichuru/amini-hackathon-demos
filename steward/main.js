(() => {
  // parse.ts
  function buildParsePrompt(text) {
    return `Parse the following text and return strict JSON with this schema:
{
  "events": [
    {
      "kind": "plant" | "spray" | "harvest" | "sale",
      "crop": "string?",
      "plot": "string?",
      "issue": "string?",
      "quantity": "number?",
      "unit": "string?",
      "dueHint": "string?"
    }
  ]
}

Text to parse:
${text}

Return only valid JSON, nothing else.`;
  }
  function parseGeminiJSON(raw) {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : raw.trim();
    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed.events || !Array.isArray(parsed.events)) {
        throw new Error("Missing or invalid events array");
      }
      return parsed;
    } catch (error) {
      throw new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // gemini.ts
  async function callGemini(apiKey, model, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      })
    });
    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  // plan.ts
  function planActions(events, ctx) {
    const sortedEvents = [...events].sort((a, b) => {
      const kindOrder = { plant: 1, spray: 2, harvest: 3, sale: 4 };
      if (kindOrder[a.kind] !== kindOrder[b.kind]) {
        return kindOrder[a.kind] - kindOrder[b.kind];
      }
      if (a.dueHint && b.dueHint) {
        return a.dueHint.localeCompare(b.dueHint);
      }
      return 0;
    });
    const actions = [];
    const currentDate = new Date(ctx.today);
    const cropHarvestDates = {};
    for (const event of sortedEvents) {
      let date = ctx.today;
      if (event.dueHint) {
        const dueDate = parseDueHint(event.dueHint, ctx.today);
        if (dueDate) {
          date = dueDate;
        }
      }
      while (ctx.rainDays.includes(date)) {
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);
        date = formatDate(nextDay);
      }
      if (event.kind === "spray") {
        if (event.crop && cropHarvestDates[event.crop]) {
          const harvestDate = new Date(cropHarvestDates[event.crop]);
          const sprayDate = new Date(harvestDate);
          const preHarvestDays = event.preHarvestDays ?? 7;
          sprayDate.setDate(harvestDate.getDate() - preHarvestDays);
          let adjustedSprayDate = formatDate(sprayDate);
          while (ctx.rainDays.includes(adjustedSprayDate)) {
            const prevDay = new Date(adjustedSprayDate);
            prevDay.setDate(prevDay.getDate() - 1);
            adjustedSprayDate = formatDate(prevDay);
          }
          date = adjustedSprayDate;
        }
      } else if (event.kind === "harvest") {
        if (event.crop) {
          cropHarvestDates[event.crop] = date;
        }
      }
      actions.push({
        id: `${event.kind}-${actions.length}`,
        kind: event.kind,
        crop: event.crop,
        plot: event.plot,
        issue: event.issue,
        quantity: event.quantity,
        unit: event.unit,
        date,
        preHarvestDays: event.preHarvestDays,
        reason: event.dueHint ? `Scheduled due to: ${event.dueHint}` : void 0
      });
    }
    adjustDatesForHarvest(actions, ctx);
    return { actions };
  }
  function addDays(dateStr, days) {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return formatDate(date);
  }
  function parseDueHint(dueHint, today) {
    const todayDate = new Date(today);
    if (dueHint.toLowerCase() === "today") {
      return today;
    } else if (dueHint.toLowerCase() === "tomorrow") {
      return addDays(today, 1);
    }
    const weekdays = {
      "mon": 1,
      "monday": 1,
      "tue": 2,
      "tuesday": 2,
      "wed": 3,
      "wednesday": 3,
      "thu": 4,
      "thursday": 4,
      "fri": 5,
      "friday": 5,
      "sat": 6,
      "saturday": 6,
      "sun": 0,
      "sunday": 0
    };
    const lowerHint = dueHint.toLowerCase();
    if (lowerHint in weekdays) {
      const targetDay = weekdays[lowerHint];
      const currentDate = new Date(today);
      let daysUntilTarget = (targetDay - currentDate.getDay() + 7) % 7;
      if (daysUntilTarget === 0) {
        daysUntilTarget = 7;
      }
      return addDays(today, daysUntilTarget);
    }
    const inDaysMatch = dueHint.match(/^in (\d+) days?$/);
    if (inDaysMatch) {
      const days = parseInt(inDaysMatch[1], 10);
      return addDays(today, days);
    }
    if (dueHint.toLowerCase() === "next week") {
      return addDays(today, 7);
    }
    return null;
  }
  function formatDate(date) {
    return date.toISOString().split("T")[0];
  }
  function adjustDatesForHarvest(actions, ctx) {
    const sprayActions = actions.filter((a) => a.kind === "spray");
    const harvestActions = actions.filter((a) => a.kind === "harvest");
    for (const spray of sprayActions) {
      for (const harvest of harvestActions) {
        if (spray.crop === harvest.crop) {
          const sprayDate = new Date(spray.date);
          const harvestDate = new Date(harvest.date);
          if (sprayDate >= harvestDate) {
            sprayDate.setDate(harvestDate.getDate() - 1);
            spray.date = formatDate(sprayDate);
            while (ctx.rainDays.includes(spray.date)) {
              sprayDate.setDate(sprayDate.getDate() - 1);
              spray.date = formatDate(sprayDate);
            }
          }
        }
      }
    }
  }

  // verify.ts
  function verifyPlan(plan, ctx) {
    const violations = [];
    const todayDate = new Date(ctx.today);
    if (ctx.windowStart && ctx.windowEnd) {
      const windowStartDate = new Date(ctx.windowStart);
      const windowEndDate = new Date(ctx.windowEnd);
      for (const action of plan.actions) {
        const actionDate = new Date(action.date);
        if (actionDate < windowStartDate || actionDate > windowEndDate) {
          violations.push({
            actionId: action.id,
            reason: `Action scheduled for ${action.date} is outside the ${ctx.windowStart}...${ctx.windowEnd} window`
          });
        }
      }
    }
    for (const action of plan.actions) {
      const actionDate = new Date(action.date);
      if (actionDate < todayDate) {
        violations.push({
          actionId: action.id,
          reason: `Action scheduled for ${action.date} is in the past`
        });
      }
      if (action.kind === "spray" && action.crop) {
        const preHarvestDays = action.preHarvestDays ?? 7;
        const harvestActions = plan.actions.filter(
          (a) => a.kind === "harvest" && a.crop === action.crop
        );
        for (const harvest of harvestActions) {
          const harvestDate = new Date(harvest.date);
          const sprayDate = new Date(action.date);
          const windowStart = sprayDate;
          const windowEnd = new Date(sprayDate);
          windowEnd.setDate(windowEnd.getDate() + preHarvestDays);
          if (harvestDate >= windowStart && harvestDate <= windowEnd) {
            violations.push({
              actionId: action.id,
              reason: `Spray on ${action.date} is within its ${preHarvestDays}-day pre-harvest interval before harvest on ${harvest.date}`
            });
          }
        }
      }
      if (action.kind === "spray" && ctx.rainDays.includes(action.date)) {
        violations.push({
          actionId: action.id,
          reason: `Spray scheduled on ${action.date} falls on a rain day`
        });
      }
    }
    return violations;
  }

  // ics.ts
  function toICS(plan) {
    let ics = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Shamba Steward//EN\r
`;
    for (const action of plan.actions) {
      ics += `BEGIN:VEVENT\r
`;
      ics += `UID:${action.id}@shamba-steward\r
`;
      ics += `DTSTART:${action.date.replace(/-/g, "")}\r
`;
      ics += `SUMMARY:${getActionSummary(action)}\r
`;
      ics += `END:VEVENT\r
`;
    }
    ics += `END:VCALENDAR\r
`;
    return ics;
  }
  function getActionSummary(action) {
    switch (action.kind) {
      case "plant":
        return `Plant ${action.crop || "crop"} in ${action.plot || "plot"}`;
      case "spray":
        return `Spray ${action.issue || "pesticide"} on ${action.crop || "crop"}`;
      case "harvest":
        return `Harvest ${action.crop || "crop"} (${action.quantity || 0} ${action.unit || "units"})`;
      case "sale":
        return `Sell ${action.quantity || 0} ${action.unit || "units"} of ${action.crop || "crop"}`;
      default:
        return `Action: ${action.kind}`;
    }
  }

  // messages.ts
  function draftMessages(events) {
    const saleEvent = events.find((e) => e.kind === "sale");
    if (saleEvent && saleEvent.crop && saleEvent.quantity) {
      return {
        market: `Sell ${saleEvent.quantity} ${saleEvent.unit || "units"} of ${saleEvent.crop} at the local market`
      };
    }
    return {};
  }

  // main.ts
  var apiKeyInput = document.getElementById("api-key");
  var modelSelect = document.getElementById("model-select");
  var textField = document.getElementById("field-text");
  var runButton = document.getElementById("run-button");
  var agentStepper = document.getElementById("agent-stepper");
  var parseOutput = document.getElementById("parse-output");
  var planOutput = document.getElementById("plan-output");
  var verifyOutput = document.getElementById("verify-output");
  var deliverOutput = document.getElementById("deliver-output");
  var parseContent = document.getElementById("parse-content");
  var planContent = document.getElementById("plan-content");
  var verifyContent = document.getElementById("verify-content");
  var deliverContent = document.getElementById("deliver-content");
  window.addEventListener("DOMContentLoaded", () => {
    const savedApiKey = localStorage.getItem("gemini-api-key");
    if (savedApiKey) {
      apiKeyInput.value = savedApiKey;
    }
  });
  function showStep(step) {
    [parseOutput, planOutput, verifyOutput, deliverOutput].forEach((el) => el.classList.add("hidden"));
    document.querySelectorAll(".step-indicator").forEach((el) => el.classList.remove("active"));
    switch (step) {
      case "parse":
        parseOutput.classList.remove("hidden");
        document.getElementById("step-parse")?.classList.add("active");
        break;
      case "plan":
        planOutput.classList.remove("hidden");
        document.getElementById("step-plan")?.classList.add("active");
        break;
      case "verify":
        verifyOutput.classList.remove("hidden");
        document.getElementById("step-verify")?.classList.add("active");
        break;
      case "deliver":
        deliverOutput.classList.remove("hidden");
        document.getElementById("step-deliver")?.classList.add("active");
        break;
    }
  }
  async function runAgent() {
    try {
      const apiKey = apiKeyInput.value.trim();
      const model = modelSelect.value;
      const text = textField.value.trim();
      if (!apiKey) {
        alert("Please enter your Gemini API key");
        apiKeyInput.focus();
        return;
      }
      if (!text) {
        alert("Please enter field update text");
        textField.focus();
        return;
      }
      localStorage.setItem("gemini-api-key", apiKey);
      parseContent.innerHTML = "";
      planContent.innerHTML = "";
      verifyContent.innerHTML = "";
      deliverContent.innerHTML = "";
      agentStepper.classList.remove("hidden");
      showStep("parse");
      const parsePrompt = buildParsePrompt(text);
      parseContent.innerHTML += "<div><strong>Prompt:</strong> " + parsePrompt + "</div>";
      const rawJson = await callGemini(apiKey, model, parsePrompt);
      parseContent.innerHTML += "<div><strong>Raw JSON from Gemini:</strong> " + rawJson + "</div>";
      const events = parseGeminiJSON(rawJson).events;
      parseContent.innerHTML += "<div><strong>Parsed Events:</strong></div><pre>" + JSON.stringify(events, null, 2) + "</pre>";
      showStep("plan");
      const ctx = {
        today: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
        rainDays: []
        // In a real app, this would come from weather data
      };
      const plan = planActions(events, ctx);
      planContent.innerHTML += "<div><strong>Scheduled Actions:</strong></div><table><thead><tr><th>Date</th><th>Action</th><th>Crop</th><th>Reason</th></tr></thead><tbody>";
      plan.actions.forEach((action) => {
        planContent.innerHTML += `<tr><td>${action.date}</td><td>${action.kind}</td><td>${action.crop || ""}</td><td>${action.reason || ""}</td></tr>`;
      });
      planContent.innerHTML += "</tbody></table>";
      showStep("verify");
      const violations = verifyPlan(plan, { ...ctx, windowStart: "2023-01-01", windowEnd: "2023-12-31" });
      if (violations.length > 0) {
        verifyContent.innerHTML += '<div class="violation-alert"><strong>Violations Found:</strong></div>';
        violations.forEach((violation) => {
          verifyContent.innerHTML += `<div>${violation.reason}</div>`;
        });
      } else {
        verifyContent.innerHTML += '<div class="success-message">\u2713 Plan verified \u2014 no conflicts</div>';
      }
      showStep("deliver");
      const icsContent = toICS(plan);
      const blob = new Blob([icsContent], { type: "text/calendar" });
      const url = URL.createObjectURL(blob);
      const icsLink = document.createElement("a");
      icsLink.href = url;
      icsLink.download = "shamba-plan.ics";
      icsLink.textContent = "Download .ics";
      icsLink.className = "download-btn";
      deliverContent.innerHTML += "<div>" + icsLink.outerHTML + "</div>";
      const messages = draftMessages(events);
      if (messages.market) {
        deliverContent.innerHTML += "<div><strong>Market Message:</strong></div><div>" + messages.market + "</div>";
        const copyBtn = document.createElement("button");
        copyBtn.textContent = "Copy";
        copyBtn.className = "copy-btn";
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(messages.market);
          copyBtn.textContent = "Copied!";
          setTimeout(() => copyBtn.textContent = "Copy", 2e3);
        };
        deliverContent.innerHTML += "<div>" + copyBtn.outerHTML + "</div>";
      } else {
        deliverContent.innerHTML += "<div>No market message to draft</div>";
      }
    } catch (error) {
      const errorMessage = error.message || "Unknown error occurred";
      parseContent.innerHTML = '<div style="color:red;"><strong>Error:</strong> ' + errorMessage + "</div>";
      agentStepper.classList.remove("hidden");
      showStep("parse");
    }
  }
  runButton.addEventListener("click", runAgent);
  textField.value = "North plot maize is tasseling. Aphids on the beans in the east plot. Rain expected Thursday. Need to sell 3 bags of maize.";
})();
