const state = {
  data: null,
  slides: ["last6Weeks", "daily", "mtd", "NOVA", "VF", "MHM", "Retention", "Field Sales"],
  currentSlideIndex: 0,
  rotationTimer: null,
  refreshTimer: null,
  triggerRefreshTimer: null,
  triggerTimer: null,
  soundDelayTimer: null,
  lastShownTriggerId: localStorage.getItem("lastShownTriggerId") || "",
  lastShownSignature: localStorage.getItem("lastShownSignature") || "",
  lastShownAt: Number(localStorage.getItem("lastShownAt") || 0),
  isShowingTrigger: false,
  audioPools: {}
};

const slideRoot = document.getElementById("slideRoot");
const loading = document.getElementById("loading");
const errorBox = document.getElementById("errorBox");
const errorMessage = document.getElementById("errorMessage");

initDashboard();

async function initDashboard() {
  try {
    setupAudioPools();

    await loadData();

    loading.classList.add("hidden");
    slideRoot.classList.remove("hidden");

    renderCurrentSlide();
    startRotation();
    startFullDataRefreshLoop();
    startTriggerRefreshLoop();
    setupAudioUnlock();
  } catch (error) {
    showError(error);
  }
}

async function loadData() {
  const url = window.DASHBOARD_CONFIG.DATA_URL;

  if (!url || url.includes("PASTE_YOUR")) {
    throw new Error("Missing DATA_URL in config.js");
  }

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Data fetch failed: ${response.status} ${response.statusText}`);
  }

  state.data = await response.json();
}

async function loadTriggerData() {
  const baseUrl = window.DASHBOARD_CONFIG.DATA_URL;

  if (!baseUrl || baseUrl.includes("PASTE_YOUR")) {
    throw new Error("Missing DATA_URL in config.js");
  }

  const separator = baseUrl.includes("?") ? "&" : "?";
  const url = `${baseUrl}${separator}mode=trigger`;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Trigger fetch failed: ${response.status} ${response.statusText}`);
  }

  const triggerData = await response.json();

  if (!state.data) {
    state.data = {};
  }

  state.data.config = {
    ...(state.data.config || {}),
    ...(triggerData.config || {})
  };

  state.data.triggers = triggerData.triggers || [];
}

function startRotation() {
  clearInterval(state.rotationTimer);

  const seconds = Number(
    state.data?.config?.rotationSeconds ||
    window.DASHBOARD_CONFIG.DEFAULT_ROTATION_SECONDS ||
    60
  );

  state.rotationTimer = setInterval(() => {
    if (state.isShowingTrigger) return;

    state.currentSlideIndex = (state.currentSlideIndex + 1) % state.slides.length;
    renderCurrentSlide();
  }, seconds * 1000);
}

function startFullDataRefreshLoop() {
  clearInterval(state.refreshTimer);

  const seconds = Number(
    state.data?.config?.refreshSeconds ||
    window.DASHBOARD_CONFIG.DEFAULT_REFRESH_SECONDS ||
    300
  );

  state.refreshTimer = setInterval(async () => {
    try {
      await loadData();

      if (!state.isShowingTrigger) {
        renderCurrentSlide();
      }

      hideError();
    } catch (error) {
      showError(error);
    }
  }, seconds * 1000);
}

function startTriggerRefreshLoop() {
  clearInterval(state.triggerRefreshTimer);

  const seconds = Number(
    state.data?.config?.triggerRefreshSeconds ||
    window.DASHBOARD_CONFIG.DEFAULT_TRIGGER_REFRESH_SECONDS ||
    10
  );

  state.triggerRefreshTimer = setInterval(async () => {
    try {
      await loadTriggerData();
      checkForTrigger();
      hideError();
    } catch (error) {
      showError(error);
    }
  }, seconds * 1000);
}

function checkForTrigger() {
  if (!window.DASHBOARD_CONFIG.ENABLE_TRIGGER_INTERRUPTIONS) return;

  const triggers = state.data?.triggers || [];
  if (!triggers.length) return;

  const activeTrigger = triggers.find(trigger => toBoolean(trigger.Active));
  if (!activeTrigger) return;

  const triggerId = String(activeTrigger["Trigger ID"] || "").trim();
  if (!triggerId) return;

  if (triggerId === state.lastShownTriggerId) return;

  // Safety net: if the Trigger ID happens to be regenerated for the same
  // underlying event (e.g. a timestamp-based ID that changes on every sheet
  // recalculation), a composite signature + cooldown window catches it even
  // though the ID looks "new".
  const signature = buildTriggerSignature(activeTrigger);
  const now = Date.now();
  const cooldownMs = Number(
    state.data?.config?.triggerDedupeCooldownSeconds ||
    window.DASHBOARD_CONFIG.DEFAULT_TRIGGER_DEDUPE_COOLDOWN_SECONDS ||
    120
  ) * 1000;

  const isDuplicateEvent =
    signature &&
    signature === state.lastShownSignature &&
    (now - state.lastShownAt) < cooldownMs;

  state.lastShownTriggerId = triggerId;
  localStorage.setItem("lastShownTriggerId", triggerId);

  if (isDuplicateEvent) return;

  state.lastShownSignature = signature;
  state.lastShownAt = now;
  localStorage.setItem("lastShownSignature", signature);
  localStorage.setItem("lastShownAt", String(now));

  showTriggerSlide(activeTrigger);
}

function buildTriggerSignature(trigger) {
  const type = String(trigger.Type || "").trim().toUpperCase();
  const metric = String(trigger.Metric || "").trim().toUpperCase();
  const team = String(trigger.Team || "").trim().toUpperCase();
  const value = String(trigger.Value || "").trim().toUpperCase();
  return `${type}|${metric}|${team}|${value}`;
}

function showTriggerSlide(trigger) {
  state.isShowingTrigger = true;
  slideRoot.innerHTML = renderTriggerSlide(trigger);
  fitCelebrationTitle();

  const baseMetric = getBaseMetric(trigger.Metric);

  const soundDelaySeconds = Number(
    state.data?.config?.celebrationSoundDelaySeconds ||
    window.DASHBOARD_CONFIG.DEFAULT_CELEBRATION_SOUND_DELAY_SECONDS ||
    3
  );

  clearTimeout(state.soundDelayTimer);
  state.soundDelayTimer = setTimeout(() => {
    playCelebrationSound(baseMetric);
  }, soundDelaySeconds * 1000);

  clearTimeout(state.triggerTimer);

  const seconds = Number(
    state.data?.config?.triggerDisplaySeconds ||
    window.DASHBOARD_CONFIG.DEFAULT_TRIGGER_DISPLAY_SECONDS ||
    45
  );

  state.triggerTimer = setTimeout(() => {
    state.isShowingTrigger = false;
    renderCurrentSlide();
  }, seconds * 1000);
}

// Shrinks the celebration title's font-size until it fits on a single line,
// so long combos like "NEW RETENTION TBK" never wrap.
function fitCelebrationTitle() {
  requestAnimationFrame(() => {
    const h1 = slideRoot.querySelector(".gif-celebration h1");
    if (!h1) return;

    let size = parseFloat(getComputedStyle(h1).fontSize);
    let guard = 60;

    while (h1.scrollWidth > h1.clientWidth && size > 22 && guard > 0) {
      size -= 2;
      h1.style.fontSize = size + "px";
      guard -= 1;
    }
  });
}

function renderCurrentSlide() {
  const slideId = state.slides[state.currentSlideIndex];

  if (slideId === "last6Weeks") {
    slideRoot.innerHTML = renderLast6WeeksSlide(state.data.last6Weeks || []);
    return;
  }

  if (slideId === "daily") {
    slideRoot.innerHTML = renderOverviewSlide({
      title: "Daily Liveticker",
      rows: state.data.daily || []
    });
    return;
  }

  if (slideId === "mtd") {
    slideRoot.innerHTML = renderOverviewSlide({
      title: "Overall standing MTD",
      rows: state.data.mtd || []
    });
    return;
  }

  if (["NOVA", "VF", "MHM", "Retention"].includes(slideId)) {
    slideRoot.innerHTML = renderTeamSlide(slideId, state.data.teams?.[slideId] || []);
    return;
  }

  if (slideId === "Field Sales") {
    slideRoot.innerHTML = renderFieldSalesSlide(state.data.teams?.["Field Sales"] || []);
    return;
  }

  slideRoot.innerHTML = renderFallbackSlide(slideId);
}

// ---------------------------------------------------------
// RENDER FUNCTIONS ("Sales Scoreboard" design)
// ---------------------------------------------------------

// Funnel stage index for the ladder indicator (1-5, deepest = TBK).
// Retention shares the same 5-rung ladder for visual consistency across
// slides: its two unique metrics slot into the "booking" and "conversion"
// checkpoints of the pipeline, IDV/TBK stay the same as elsewhere.
const FUNNEL_STAGE = {
  "PreSales": 1,
  "SC1 Booked": 2,
  "SC1 Successful": 3,
  "Booked Sales Call": 1,
  "Widerruf Zurückgewonnen": 3,
  "IDV": 4,
  "TBK": 5
};

// Display labels shown on screen, separate from the internal keys used for
// data lookups (sheet tab names, MTD matching, etc.) - only add an entry
// here if the on-screen name should differ from the key itself.
const TEAM_DISPLAY_NAMES = {
  VF: "Vertriebsfluss"
};

function getTeamDisplayName(teamKey) {
  return TEAM_DISPLAY_NAMES[teamKey] || teamKey;
}

const STANDARD_TEAM_METRICS = [
  { label: "PreSales Booking", dayKey: "PreSales (days)", weekKey: "PreSales (weeks)", toneClass: "tone-pre", stageKey: "PreSales" },
  { label: "Successful SC1", dayKey: "SC1 Successful (days)", weekKey: "SC1 Successful (weeks)", toneClass: "tone-successful", stageKey: "SC1 Successful" },
  { label: "IDV", dayKey: "IDV (days)", weekKey: "IDV (weeks)", toneClass: "tone-idv", stageKey: "IDV" },
  { label: "TBK", dayKey: "TBK (days)", weekKey: "TBK (weeks)", toneClass: "tone-tbk", stageKey: "TBK" }
];

const RETENTION_TEAM_METRICS = [
  { label: "Booked Sales Call", dayKey: "Booked Sales Call (days)", weekKey: "Booked Sales Call (weeks)", toneClass: "tone-pre", stageKey: "Booked Sales Call" },
  { label: "Widerruf Zurückgewonnen", dayKey: "Widerruf Zurückgewonnen (days)", weekKey: "Widerruf Zurückgewonnen (weeks)", toneClass: "tone-successful", stageKey: "Widerruf Zurückgewonnen" },
  { label: "IDV", dayKey: "IDV (days)", weekKey: "IDV (weeks)", toneClass: "tone-idv", stageKey: "IDV" },
  { label: "TBK", dayKey: "TBK (days)", weekKey: "TBK (weeks)", toneClass: "tone-tbk", stageKey: "TBK" }
];

// Per-slide config: which metric set to use, and which summary chips to
// show in the header. Each chip pulls its value from one of two sources:
//   "sheet"  - the shared MTD sheet, matched by team name (NOVA/VF/MHM)
//   "inline" - a column that lives directly on the slide's own sheet,
//              e.g. Retention's "IDV (MTD)"
const TEAM_SLIDE_CONFIG = {
  NOVA: {
    metrics: STANDARD_TEAM_METRICS,
    summaryChips: [
      { label: "IDV MTD", toneClass: "tone-idv", source: "sheet", key: "IDV" },
      { label: "TBK MTD", toneClass: "tone-tbk", source: "sheet", key: "TBK" }
    ]
  },
  VF: {
    metrics: STANDARD_TEAM_METRICS,
    summaryChips: [
      { label: "IDV MTD", toneClass: "tone-idv", source: "sheet", key: "IDV" },
      { label: "TBK MTD", toneClass: "tone-tbk", source: "sheet", key: "TBK" }
    ]
  },
  MHM: {
    metrics: STANDARD_TEAM_METRICS,
    summaryChips: [
      { label: "IDV MTD", toneClass: "tone-idv", source: "sheet", key: "IDV" },
      { label: "TBK MTD", toneClass: "tone-tbk", source: "sheet", key: "TBK" }
    ]
  },
  Retention: {
    metrics: RETENTION_TEAM_METRICS,
    summaryChips: [
      { label: "IDV MTD", toneClass: "tone-idv", source: "inline", key: "IDV (MTD)" },
      { label: "TBK MTD", toneClass: "tone-tbk", source: "inline", key: "TBK (MTD)" }
    ]
  }
};

// Bar heights use a curved (not linear) scale: raising the value/max ratio
// to a power > 1 stretches out differences between values that are close
// together (e.g. 245 vs 302 would look almost identical bar height on a
// straight linear scale, since both are already most of the way to max).
const BAR_HEIGHT_CURVE = 1.6;

function scaleBarHeight(value, max) {
  if (!(max > 0) || !(value > 0)) return 0;
  const ratio = Math.min(value / max, 1);
  return Math.max(Math.pow(ratio, BAR_HEIGHT_CURVE) * 100, 6);
}

function renderFunnelLadder(stage) {
  let rungs = "";
  for (let i = 1; i <= 5; i++) {
    rungs += `<div class="rung ${i <= stage ? "lit" : ""}"></div>`;
  }
  return `<div class="funnel-ladder">${rungs}</div>`;
}

function renderBars({ items, valueKey, labelKey, toneClass, latestIndex }) {
  const max = Math.max(...items.map(row => Number(row[valueKey] || 0)), 1);

  return items.map((row, index) => {
    const value = Number(row[valueKey] || 0);
    const height = scaleBarHeight(value, max);
    const isLatest = latestIndex !== undefined ? index === latestIndex : false;

    return `
      <div class="bar-col ${toneClass} ${isLatest ? "latest" : ""}">
        <div class="bar-value">${formatNumber(value)}</div>
        <div class="bar-fill" style="height: ${height}%;"></div>
        <div class="bar-tick">${escapeHtml(row[labelKey] || "")}</div>
      </div>
    `;
  }).join("");
}

// 1. LAST 6 WEEKS

function renderLast6WeeksSlide(rows) {
  const weeklyRows = rows
    .filter(row => {
      const label = String(row["Calendar Week"] || "").trim().toLowerCase();
      return label !== "" && label !== "all time";
    })
    .sort((a, b) => Number(a["Weeks from Now"]) - Number(b["Weeks from Now"]));

  const allTimeRow = rows.find(row => {
    return String(row["Calendar Week"] || "").toLowerCase() === "all time";
  }) || {};

  return `
    <main class="slide last6-slide">
      <header class="slide-head">
        <h1 class="slide-title">Last 6 Weeks</h1>
        <div class="slide-head-meta">All time</div>
      </header>

      <section class="metric-list">
        ${renderLast6Row({ metric: "IDV", label: "IDV", toneClass: "tone-idv", rows: weeklyRows, total: allTimeRow.IDV })}
        ${renderLast6Row({ metric: "TBK", label: "TBK", toneClass: "tone-tbk", rows: weeklyRows, total: allTimeRow.TBK })}
      </section>
    </main>
  `;
}

function renderLast6Row({ metric, label, toneClass, rows, total }) {
  const stage = FUNNEL_STAGE[metric] || 0;

  return `
    <div class="stat-row">
      <div class="row-label ${toneClass}">
        ${renderFunnelLadder(stage)}
        <span>${escapeHtml(label)}</span>
      </div>

      <div class="bars">
        ${renderBars({
          items: rows,
          valueKey: metric,
          labelKey: "Calendar Week",
          toneClass,
          latestIndex: 0
        })}
      </div>

      <div class="row-total ${toneClass}">${formatNumber(total)}</div>
    </div>
  `;
}

// 2. DAILY LIVETICKER + OVERALL MTD

function renderOverviewSlide({ title, rows }) {
  const metrics = [
    { label: "PreSales Booking", key: "PreSales", toneClass: "tone-pre" },
    { label: "Booked SC1", key: "SC1 Booked", toneClass: "tone-pre-alt" },
    { label: "Successful SC1", key: "SC1 Successful", toneClass: "tone-successful" },
    { label: "IDV", key: "IDV", toneClass: "tone-idv" },
    { label: "TBK", key: "TBK", toneClass: "tone-tbk" }
  ];

  const teamsToShow = window.DASHBOARD_CONFIG.TEAMS_TO_SHOW || ["NOVA", "VF", "MHM"];

  const filteredRows = rows
    .filter(row => teamsToShow.includes(String(row["Daily Stats"] || "").toUpperCase()))
    .sort((a, b) => Number(a.Sort || 0) - Number(b.Sort || 0));

  return `
    <main class="slide overview-slide">
      <header class="slide-head">
        <h1 class="slide-title">${escapeHtml(title)}</h1>
      </header>

      <div class="table-head">
        <div></div>
        <div class="table-head-total">Total</div>
        <div class="table-head-teams">
          ${teamsToShow.map(team => `<div>${escapeHtml(getTeamDisplayName(team))}</div>`).join("")}
        </div>
      </div>

      <section class="metric-list">
        ${metrics.map(metric => renderOverviewRow(metric, filteredRows, teamsToShow)).join("")}
      </section>
    </main>
  `;
}

function renderOverviewRow(metric, rows, teamsToShow) {
  const values = teamsToShow.map(team => {
    const row = rows.find(item => String(item["Daily Stats"] || "").toUpperCase() === team);
    return Number(row?.[metric.key] || 0);
  });

  const total = values.reduce((sum, value) => sum + value, 0);
  const max = Math.max(...values, 1);
  const stage = FUNNEL_STAGE[metric.key] || 0;

  return `
    <div class="stat-row">
      <div class="row-label ${metric.toneClass}">
        ${renderFunnelLadder(stage)}
        <span>${escapeHtml(metric.label)}</span>
      </div>

      <div class="row-total ${metric.toneClass}">${formatNumber(total)}</div>

      <div class="team-bars">
        ${values.map(value => {
          const height = scaleBarHeight(value, max);

          return `
            <div class="team-cell ${metric.toneClass}">
              <div class="bar-value">${formatNumber(value)}</div>
              <div class="bar-fill" style="height: ${height}%;"></div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

// 3. AGENCY DETAIL SLIDES

function renderTeamSummary(config, rows, teamName) {
  const resolveValue = (chip) => chip.source === "inline"
    ? getInlineValue(rows, chip.key)
    : getTeamMtdValue(teamName, chip.key);

  if (config.summaryGroups) {
    const groups = config.summaryGroups.map(group => {
      const items = group.chips.map(chip => `
        <div class="summary-group-item ${chip.toneClass}">
          <span class="item-label">${escapeHtml(chip.label)}</span>
          <span class="item-value">${formatNumber(resolveValue(chip))}</span>
        </div>
      `).join("");

      return `
        <div class="summary-group">
          <div class="summary-group-label">${escapeHtml(group.label)}</div>
          <div class="summary-group-values">${items}</div>
        </div>
      `;
    }).join("");

    return `<div class="summary-groups">${groups}</div>`;
  }

  const chips = (config.summaryChips || []).map(chip => `
    <div class="mtd-chip ${chip.toneClass}">
      <span class="chip-label">${escapeHtml(chip.label)}</span>
      <span class="chip-value">${formatNumber(resolveValue(chip))}</span>
    </div>
  `).join("");

  return chips ? `<div class="mtd-chips">${chips}</div>` : "";
}

function renderTeamSlide(teamName, rows) {
  const config = TEAM_SLIDE_CONFIG[teamName] || { metrics: STANDARD_TEAM_METRICS, summaryChips: [] };
  const metrics = config.metrics;

  const sortedRows = [...rows].sort((a, b) => Number(a.Sort || 0) - Number(b.Sort || 0));
  const dayRows = sortedRows.filter(row => String(row.Day || "").trim() !== "");
  const weekRows = sortedRows
    .filter(row => String(row.CW || "").trim() !== "" && hasAnyWeeklyValue(row, metrics))
    .sort((a, b) => getWeekNumber(b.CW) - getWeekNumber(a.CW));

  const summaryMarkup = renderTeamSummary(config, rows, teamName);

  return `
    <main class="slide team-slide">
      <header class="slide-head">
        <h1 class="slide-title">${escapeHtml(getTeamDisplayName(teamName))}</h1>
        ${summaryMarkup}
      </header>

      <div class="team-col-heads">
        <div></div>
        <div class="col-head">Last 10 days</div>
        <div class="col-head">Last 5 weeks</div>
      </div>

      <section class="metric-list">
        ${metrics.map(metric => renderTeamRow(metric, dayRows, weekRows)).join("")}
      </section>
    </main>
  `;
}

function renderTeamRow(metric, dayRows, weekRows) {
  const stage = FUNNEL_STAGE[metric.stageKey] || 0;

  const validDayRows = dayRows.filter(row => {
    const value = row[metric.dayKey];
    return value !== "" && value !== null && value !== undefined;
  });

  const validWeekRows = weekRows.filter(row => {
    const value = row[metric.weekKey];
    return value !== "" && value !== null && value !== undefined;
  });

  return `
    <div class="stat-row">
      <div class="row-label ${metric.toneClass}">
        ${renderFunnelLadder(stage)}
        <span>${escapeHtml(metric.label)}</span>
      </div>

      <div class="bars">
        ${renderBars({
          items: validDayRows,
          valueKey: metric.dayKey,
          labelKey: "Day",
          toneClass: metric.toneClass,
          latestIndex: 0
        })}
      </div>

      <div class="bars weekly">
        ${renderBars({
          items: validWeekRows,
          valueKey: metric.weekKey,
          labelKey: "CW",
          toneClass: metric.toneClass,
          latestIndex: 0
        })}
      </div>
    </div>
  `;
}

// 3b. FIELD SALES - stacked PV/Kombi bars (IDV and TBK only)

function renderFieldSalesSlide(rows) {
  const sortedRows = [...rows].sort((a, b) => Number(a.Sort || 0) - Number(b.Sort || 0));
  const dayRows = sortedRows.filter(row => String(row.Day || "").trim() !== "");
  const weekRows = sortedRows
    .filter(row => String(row.CW || "").trim() !== "" && hasAnyFieldSalesWeeklyValue(row))
    .sort((a, b) => getWeekNumber(b.CW) - getWeekNumber(a.CW));

  const mtdGroup = renderFieldSalesSummaryGroup("MTD", {
    idvPv: getInlineValue(rows, "IDV PV (MTD)"),
    idvKombi: getInlineValue(rows, "IDV Kombi (MTD)"),
    tbkPv: getInlineValue(rows, "TBK PV (MTD)"),
    tbkKombi: getInlineValue(rows, "TBK Kombi (MTD)")
  });

  const allTimeGroup = renderFieldSalesSummaryGroup("All Time", {
    idvPv: getInlineValue(rows, "IDV PV (All Time)"),
    idvKombi: getInlineValue(rows, "IDV Kombi (All Time)"),
    tbkPv: getInlineValue(rows, "TBK PV (All Time)"),
    tbkKombi: getInlineValue(rows, "TBK Kombi (All Time)")
  });

  return `
    <main class="slide team-slide field-sales-slide">
      <header class="slide-head">
        <h1 class="slide-title">Field Sales</h1>
        <div class="summary-groups">${mtdGroup}${allTimeGroup}</div>
      </header>

      <div class="chart-legend">
        <div class="legend-item"><span class="legend-swatch idv-pv"></span>IDV PV</div>
        <div class="legend-item"><span class="legend-swatch idv-kombi"></span>IDV Kombi</div>
        <div class="legend-item"><span class="legend-swatch tbk-pv"></span>TBK PV</div>
        <div class="legend-item"><span class="legend-swatch tbk-kombi"></span>TBK Kombi</div>
      </div>

      <div class="team-col-heads">
        <div></div>
        <div class="col-head">Last 10 days</div>
        <div class="col-head">Last 5 weeks</div>
      </div>

      <section class="metric-list">
        ${renderFieldSalesRow("IDV", "tone-idv", dayRows, weekRows, "IDV PV (days)", "IDV Kombi (days)", "IDV PV (weeks)", "IDV Kombi (weeks)")}
        ${renderFieldSalesRow("TBK", "tone-tbk", dayRows, weekRows, "TBK PV (days)", "TBK Kombi (days)", "TBK PV (weeks)", "TBK Kombi (weeks)")}
      </section>
    </main>
  `;
}

function renderFieldSalesSummaryGroup(label, values) {
  const idvTotal = values.idvPv + values.idvKombi;
  const tbkTotal = values.tbkPv + values.tbkKombi;

  return `
    <div class="summary-group">
      <div class="summary-group-label">${escapeHtml(label)}</div>
      <div class="summary-metric-row idv-row">
        <div class="summary-metric-top">
          <span class="summary-metric-name">IDV</span>
          <span class="summary-metric-total">${formatNumber(idvTotal)}</span>
        </div>
        <div class="summary-metric-breakdown">
          <span class="pv-value">${formatNumber(values.idvPv)}</span>
          <span class="breakdown-sep">+</span>
          <span class="kombi-value">${formatNumber(values.idvKombi)}</span>
        </div>
      </div>
      <div class="summary-metric-row tbk-row">
        <div class="summary-metric-top">
          <span class="summary-metric-name">TBK</span>
          <span class="summary-metric-total">${formatNumber(tbkTotal)}</span>
        </div>
        <div class="summary-metric-breakdown">
          <span class="pv-value">${formatNumber(values.tbkPv)}</span>
          <span class="breakdown-sep">+</span>
          <span class="kombi-value">${formatNumber(values.tbkKombi)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderFieldSalesRow(label, toneClass, dayRows, weekRows, pvDayKey, kombiDayKey, pvWeekKey, kombiWeekKey) {
  const stage = FUNNEL_STAGE[label] || 0;

  const validDayRows = dayRows.filter(row => hasEither(row, pvDayKey, kombiDayKey));
  const validWeekRows = weekRows.filter(row => hasEither(row, pvWeekKey, kombiWeekKey));

  return `
    <div class="stat-row">
      <div class="row-label ${toneClass}">
        ${renderFunnelLadder(stage)}
        <span>${escapeHtml(label)}</span>
      </div>

      <div class="bars">
        ${renderFieldSalesStackedBars(validDayRows, pvDayKey, kombiDayKey, "Day", toneClass)}
      </div>

      <div class="bars weekly">
        ${renderFieldSalesStackedBars(validWeekRows, pvWeekKey, kombiWeekKey, "CW", toneClass)}
      </div>
    </div>
  `;
}

function renderFieldSalesStackedBars(rows, pvKey, kombiKey, labelKey, toneClass) {
  const items = rows.map(row => ({
    pv: Number(row[pvKey] || 0),
    kombi: Number(row[kombiKey] || 0),
    label: row[labelKey]
  }));

  const totals = items.map(i => i.pv + i.kombi);
  const max = Math.max(...totals, 1);

  return items.map((item, index) => {
    const total = item.pv + item.kombi;
    const totalPct = scaleBarHeight(total, max);
    const pvShare = total > 0 ? item.pv / total : 0;
    const kombiShare = total > 0 ? item.kombi / total : 0;
    const isLatest = index === 0;

    const kombiLabel = item.kombi > 0 ? `<span class="segment-label">${formatNumber(item.kombi)}</span>` : "";
    const pvLabel = item.pv > 0 ? `<span class="segment-label">${formatNumber(item.pv)}</span>` : "";

    return `
      <div class="bar-col ${toneClass} ${isLatest ? "latest" : ""}">
        <div class="bar-value">${formatNumber(total)}</div>
        <div class="bar-stack" style="height: ${totalPct}%;">
          <div class="bar-segment kombi" style="height: ${(kombiShare * 100).toFixed(1)}%;">${kombiLabel}</div>
          <div class="bar-segment pv" style="height: ${(pvShare * 100).toFixed(1)}%;">${pvLabel}</div>
        </div>
        <div class="bar-tick">${escapeHtml(item.label || "")}</div>
      </div>
    `;
  }).join("");
}

function hasEither(row, keyA, keyB) {
  const a = row[keyA];
  const b = row[keyB];
  const hasA = a !== "" && a !== null && a !== undefined;
  const hasB = b !== "" && b !== null && b !== undefined;
  return hasA || hasB;
}

function hasAnyFieldSalesWeeklyValue(row) {
  return hasEither(row, "IDV PV (weeks)", "IDV Kombi (weeks)") || hasEither(row, "TBK PV (weeks)", "TBK Kombi (weeks)");
}

// 4. CELEBRATION SLIDE (unchanged)

// Extracts the plain IDV/TBK metric (handles stray whitespace/case only -
// Metric is always a plain value; PV/Kombi comes from the Type field).
function getBaseMetric(metricRaw) {
  const upper = String(metricRaw || "").trim().toUpperCase();
  if (upper.indexOf("TBK") !== -1) return "TBK";
  if (upper.indexOf("IDV") !== -1) return "IDV";
  return upper;
}

function renderTriggerSlide(trigger) {
  const metric = getBaseMetric(trigger.Metric);
  const type = String(trigger.Type || "").trim().toUpperCase();
  const team = String(trigger.Team || "").trim().toUpperCase();
  const value = trigger.Value;

  const celebrations = window.DASHBOARD_CONFIG.CELEBRATIONS || {};
  const celebration = celebrations[metric] || celebrations.IDV || {};
  const emoji = celebration.emoji || "🎉";

  const isFieldSales = team === "FIELD SALES";
  const isFieldSalesKombi = isFieldSales && type === "KOMBI";
  const isFieldSalesPv = isFieldSales && type === "PV";

  let titleMiddle;
  let themeClass = "";

  if (isFieldSalesPv || isFieldSalesKombi) {
    // Field Sales PV/Kombi: fixed title, distinct background per sub-type,
    // but the effect (confetti for IDV, money for TBK) stays the default.
    const subType = isFieldSalesKombi ? "KOMBI" : "PV";
    titleMiddle = `FIELD SALES ${subType} ${metric}`;
    themeClass = isFieldSalesKombi ? "fieldsales-kombi-theme" : "fieldsales-pv-theme";
  } else if (type === "PV" || type === "RETENTION") {
    titleMiddle = `${type} ${metric}`;
    themeClass = type === "PV" ? "pv-theme" : "retention-theme";
  } else {
    const teamLabel = team ? getTeamDisplayName(team) : "";
    titleMiddle = teamLabel ? `${teamLabel} ${metric}` : metric;
  }

  const title = `${emoji} NEW ${titleMiddle} ${emoji}`;

  // Effect only changes for the non-Field-Sales PV/Retention TBK cases
  // (sun/buoy); Field Sales always keeps the standard confetti/money.
  let effect = celebration.effect || "confetti";
  if (!isFieldSales && type === "PV" && metric === "TBK") effect = "sun";
  if (!isFieldSales && type === "RETENTION" && metric === "TBK") effect = "buoy";

  const message = value !== "" && value !== null && value !== undefined ? String(value) : "";

  return `
    <main class="gif-celebration ${themeClass}">
      <div class="particle-field">${renderParticleField(effect)}</div>
      <section class="gif-celebration-card">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
      </section>
    </main>
  `;
}

function renderParticleField(effect) {
  if (effect === "money") {
    return renderMoneyParticles(36);
  }
  if (effect === "sun") {
    return renderEmojiParticles("☀️", 26);
  }
  if (effect === "buoy") {
    return renderEmojiParticles("🛟", 26);
  }
  return renderConfettiParticles(30);
}

function renderEmojiParticles(emoji, count) {
  let out = "";

  for (let i = 0; i < count; i++) {
    const left = (Math.random() * 100).toFixed(1);
    const delay = (Math.random() * 2.6).toFixed(2);
    const duration = (3.4 + Math.random() * 2.2).toFixed(2);
    const size = (24 + Math.random() * 20).toFixed(0);
    const rotate = (Math.random() * 20 - 10).toFixed(1);

    out += `
      <span
        class="emoji-piece"
        style="left: ${left}%; font-size: ${size}px; animation-delay: ${delay}s; animation-duration: ${duration}s; --start-rotate: ${rotate}deg;"
      >${emoji}</span>
    `;
  }

  return out;
}

function renderConfettiParticles(count) {
  const shapes = ["circle", "rect"];
  const tones = ["tone-a", "tone-b", "tone-c", "tone-d"];
  let out = "";

  for (let i = 0; i < count; i++) {
    const left = (Math.random() * 100).toFixed(1);
    const delay = (Math.random() * 2.6).toFixed(2);
    const duration = (3.2 + Math.random() * 2.2).toFixed(2);
    const size = (8 + Math.random() * 10).toFixed(0);
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    const tone = tones[Math.floor(Math.random() * tones.length)];

    out += `
      <span
        class="confetti-piece ${shape} ${tone}"
        style="left: ${left}%; width: ${size}px; height: ${size}px; animation-delay: ${delay}s; animation-duration: ${duration}s;"
      ></span>
    `;
  }

  return out;
}

function renderMoneyParticles(count) {
  let out = "";

  for (let i = 0; i < count; i++) {
    const left = (Math.random() * 100).toFixed(1);
    const delay = (Math.random() * 2.8).toFixed(2);
    const duration = (3.6 + Math.random() * 2.2).toFixed(2);
    const rotate = (Math.random() * 16 - 8).toFixed(1);

    out += `
      <span
        class="money-bill"
        style="left: ${left}%; animation-delay: ${delay}s; animation-duration: ${duration}s; --start-rotate: ${rotate}deg;"
      >€</span>
    `;
  }

  return out;
}

function renderFallbackSlide(slideId) {
  return `
    <main class="slide">
      <header class="slide-head">
        <h1 class="slide-title">${escapeHtml(slideId)}</h1>
      </header>
    </main>
  `;
}

// ---------------------------------------------------------
// audio / triggers
// ---------------------------------------------------------

function setupAudioPools() {
  const celebrations = window.DASHBOARD_CONFIG.CELEBRATIONS || {};

  Object.keys(celebrations).forEach(key => {
    const sound = celebrations[key]?.sound;
    if (!sound) return;

    state.audioPools[key] = makeAudioPool(sound, 3);
  });
}

function makeAudioPool(src, size = 3) {
  const pool = [];

  for (let i = 0; i < size; i++) {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.load();
    pool.push(audio);
  }

  return {
    src,
    pool,
    index: 0
  };
}

function playCelebrationSound(metric) {
  const pool = state.audioPools[metric];
  if (!pool || !pool.pool.length) return;

  const audio = pool.pool[pool.index];
  pool.index = (pool.index + 1) % pool.pool.length;

  try {
    audio.pause();
    audio.currentTime = 0;

    const playPromise = audio.play();

    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(error => {
        console.log("Audio play blocked or failed:", error);
      });
    }
  } catch (error) {
    console.log("Audio error:", error);
  }
}

function setupAudioUnlock() {
  function unlockAudio() {
    Object.values(state.audioPools).forEach(pool => {
      pool.pool.forEach(audio => {
        const previousVolume = audio.volume;

        audio.volume = 0;

        const playPromise = audio.play();

        if (playPromise && typeof playPromise.then === "function") {
          playPromise
            .then(() => {
              audio.pause();
              audio.currentTime = 0;
              audio.volume = previousVolume;
            })
            .catch(() => {
              audio.volume = previousVolume;
            });
        } else {
          audio.volume = previousVolume;
        }
      });
    });

    window.removeEventListener("keydown", unlockAudio);
    window.removeEventListener("pointerdown", unlockAudio);
  }

  window.addEventListener("keydown", unlockAudio, { once: true });
  window.addEventListener("pointerdown", unlockAudio, { once: true });
}

// ---------------------------------------------------------
// helpers
// ---------------------------------------------------------

function getTeamMtdValue(teamName, metric) {
  const row = (state.data?.mtd || []).find(item => {
    return String(item["Daily Stats"] || "").toUpperCase() === String(teamName).toUpperCase();
  });

  return Number(row?.[metric] || 0);
}

function getInlineValue(rows, key) {
  const row = rows.find(item => item[key] !== "" && item[key] !== null && item[key] !== undefined);
  return Number(row?.[key] || 0);
}

function hasAnyWeeklyValue(row, metrics) {
  return metrics.some(metric => {
    const value = row[metric.weekKey];
    return value !== "" && value !== null && value !== undefined;
  });
}

function getWeekNumber(value) {
  const text = String(value || "").trim().toLowerCase();

  if (text === "this week") return Infinity;

  const match = text.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function formatNumber(value) {
  const number = Number(value || 0);
  return String(Math.round(number));
}

function toBoolean(value) {
  if (value === true) return true;

  const text = String(value || "").toLowerCase().trim();

  return text === "true" || text === "yes" || text === "ja" || text === "1";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, "&quot;");
}

function showError(error) {
  console.error(error);

  errorBox.classList.remove("hidden");
  errorMessage.textContent = error.message || String(error);
}

function hideError() {
  errorBox.classList.add("hidden");
  errorMessage.textContent = "";
}
