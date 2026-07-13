const state = {
  data: null,
  slides: ["last6Weeks", "daily", "mtd", "NOVA", "VF", "MHM", "Retention"],
  currentSlideIndex: 0,
  rotationTimer: null,
  refreshTimer: null,
  triggerRefreshTimer: null,
  triggerTimer: null,
  lastShownTriggerId: localStorage.getItem("lastShownTriggerId") || "",
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

  state.lastShownTriggerId = triggerId;
  localStorage.setItem("lastShownTriggerId", triggerId);

  showTriggerSlide(activeTrigger);
}

function showTriggerSlide(trigger) {
  state.isShowingTrigger = true;
  slideRoot.innerHTML = renderTriggerSlide(trigger);

  const metric = String(trigger.Metric || trigger.Type || "").toUpperCase();
  playCelebrationSound(metric);

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

// Per-slide config: which metric set to use, and whether to show the
// MTD chips (Retention isn't tracked in the MTD sheet, so it's hidden there).
const TEAM_SLIDE_CONFIG = {
  NOVA: { metrics: STANDARD_TEAM_METRICS, showMtd: true },
  VF: { metrics: STANDARD_TEAM_METRICS, showMtd: true },
  MHM: { metrics: STANDARD_TEAM_METRICS, showMtd: true },
  Retention: { metrics: RETENTION_TEAM_METRICS, showMtd: false }
};

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
    const height = Math.max((value / max) * 100, value > 0 ? 6 : 0);
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
    .filter(row => String(row["Calendar Week"] || "").startsWith("CW"))
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
          ${teamsToShow.map(team => `<div>${escapeHtml(team)}</div>`).join("")}
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
          const ratio = max > 0 ? value / max : 0;
          const height = value > 0 ? Math.max(ratio * 100, 6) : 0;

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

function renderTeamSlide(teamName, rows) {
  const config = TEAM_SLIDE_CONFIG[teamName] || { metrics: STANDARD_TEAM_METRICS, showMtd: false };
  const metrics = config.metrics;

  const sortedRows = [...rows].sort((a, b) => Number(a.Sort || 0) - Number(b.Sort || 0));
  const dayRows = sortedRows.filter(row => String(row.Day || "").trim() !== "");
  const weekRows = sortedRows
    .filter(row => String(row.CW || "").trim() !== "" && hasAnyWeeklyValue(row, metrics))
    .sort((a, b) => getWeekNumber(b.CW) - getWeekNumber(a.CW));

  const mtdChips = config.showMtd
    ? `
      <div class="mtd-chips">
        <div class="mtd-chip tone-idv">
          <span class="chip-label">IDV MTD</span>
          <span class="chip-value">${formatNumber(getTeamMtdValue(teamName, "IDV"))}</span>
        </div>
        <div class="mtd-chip tone-tbk">
          <span class="chip-label">TBK MTD</span>
          <span class="chip-value">${formatNumber(getTeamMtdValue(teamName, "TBK"))}</span>
        </div>
      </div>
    `
    : "";

  return `
    <main class="slide team-slide">
      <header class="slide-head">
        <h1 class="slide-title">${escapeHtml(teamName)}</h1>
        ${mtdChips}
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

// 4. CELEBRATION SLIDE (unchanged)

function renderTriggerSlide(trigger) {
  const metric = String(trigger.Metric || trigger.Type || "").toUpperCase();
  const value = trigger.Value;

  const celebrations = window.DASHBOARD_CONFIG.CELEBRATIONS || {};
  const celebration = celebrations[metric] || celebrations.IDV || {};

  const title = celebration.title || `🎉 NEW ${metric} 🎉`;
  const gif = celebration.gif || "";
  const message = value !== "" && value !== null && value !== undefined ? String(value) : "";

  const backgroundStyle = gif
    ? `style="background-image: linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.25)), url('${escapeAttribute(gif)}');"`
    : "";

  return `
    <main class="gif-celebration" ${backgroundStyle}>
      <section class="gif-celebration-card">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
      </section>
    </main>
  `;
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

function hasAnyWeeklyValue(row, metrics) {
  return metrics.some(metric => {
    const value = row[metric.weekKey];
    return value !== "" && value !== null && value !== undefined;
  });
}

function getWeekNumber(value) {
  const match = String(value || "").match(/\d+/);
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
