const state = {
  data: null,
  slides: ["last6Weeks", "daily", "mtd", "NOVA", "VF", "MHM"],
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
      title: "🔥 Daily Liveticker",
      rows: state.data.daily || []
    });
    return;
  }

  if (slideId === "mtd") {
    slideRoot.innerHTML = renderOverviewSlide({
      title: "🗓️ Overall standing MTD",
      rows: state.data.mtd || []
    });
    return;
  }

  if (["NOVA", "VF", "MHM"].includes(slideId)) {
    slideRoot.innerHTML = renderTeamSlide(slideId, state.data.teams?.[slideId] || []);
    return;
  }

  slideRoot.innerHTML = renderFallbackSlide(slideId);
}

function renderLast6WeeksSlide(rows) {
  const weeklyRows = rows
    .filter(row => String(row["Calendar Week"] || "").startsWith("CW"))
    .sort((a, b) => Number(b["Weeks from Now"]) - Number(a["Weeks from Now"]));

  const allTimeRow = rows.find(row => String(row["Calendar Week"] || "").toLowerCase() === "all time") || {};

  return `
    <main class="slide">
      <section class="last6-header">
        <div class="last6-title">Last 6 Weeks</div>
        <div class="last6-total-title">All time</div>
      </section>

      <section class="last6-rows">
        ${renderLast6MetricRow({
          metric: "IDV",
          cssClass: "idv",
          rows: weeklyRows,
          total: allTimeRow.IDV
        })}

        ${renderLast6MetricRow({
          metric: "TBK",
          cssClass: "tbk",
          rows: weeklyRows,
          total: allTimeRow.TBK
        })}
      </section>
    </main>
  `;
}

function renderLast6MetricRow({ metric, cssClass, rows, total }) {
  const max = Math.max(...rows.map(row => Number(row[metric] || 0)), 1);

  return `
    <div class="last6-row ${cssClass}">
      <div class="last6-metric">${escapeHtml(metric)}</div>

      <div class="last6-chart-card">
        <div class="last6-chart">
          ${rows.map(row => {
            const value = Number(row[metric] || 0);
            const height = Math.max((value / max) * 100, value > 0 ? 8 : 2);

            return `
              <div class="last6-bar-wrap">
                <div class="last6-value ${cssClass}-color">${formatNumber(value)}</div>
                <div class="bar last6-bar" style="height: ${height}%;"></div>
                <div class="last6-label">${escapeHtml(row["Calendar Week"])}</div>
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <div class="last6-total-card">
        <div class="last6-total ${cssClass}-color">${formatNumber(total)}</div>
      </div>
    </div>
  `;
}

function renderOverviewSlide({ title, rows }) {
  const metrics = [
    { label: "PreSales Booking", key: "PreSales", cssClass: "pre" },
    { label: "Booked SC1", key: "SC1 Booked", cssClass: "pre" },
    { label: "Successful SC1", key: "SC1 Successful", cssClass: "successful" },
    { label: "IDV", key: "IDV", cssClass: "idv" },
    { label: "TBK", key: "TBK", cssClass: "tbk" }
  ];

  const teamsToShow = window.DASHBOARD_CONFIG.TEAMS_TO_SHOW || ["NOVA", "VF", "MHM"];

  const filteredRows = rows
    .filter(row => teamsToShow.includes(String(row["Daily Stats"] || "").toUpperCase()))
    .sort((a, b) => Number(a.Sort || 0) - Number(b.Sort || 0));

  return `
    <main class="slide">
      <section class="overview-title">
        <span>${escapeHtml(title)}</span>
      </section>

      <section class="overview-table">
        <div></div>
        <div class="header-cell header-total">TOTAL</div>
        ${teamsToShow.map(team => `<div class="header-cell team-header">${escapeHtml(team)}</div>`).join("")}

        ${metrics.map(metric => renderOverviewMetricRow(metric, filteredRows, teamsToShow)).join("")}
      </section>
    </main>
  `;
}

function renderOverviewMetricRow(metric, rows, teamsToShow) {
  const values = teamsToShow.map(team => {
    const row = rows.find(item => String(item["Daily Stats"] || "").toUpperCase() === team);
    return Number(row?.[metric.key] || 0);
  });

  const total = values.reduce((sum, value) => sum + value, 0);
  const max = Math.max(...values, 1);

  return `
    <div class="overview-row-label ${metric.cssClass}">${escapeHtml(metric.label)}</div>
    <div class="total-value ${metric.cssClass}-color">${formatNumber(total)}</div>

    ${values.map(value => {
      const height = Math.max((value / max) * 70, value > 0 ? 10 : 0);

      return `
        <div class="overview-chart-cell ${metric.cssClass}">
          <div class="overview-bar-wrap">
            <div class="overview-bar-value bar-value">${formatNumber(value)}</div>
            ${value > 0 ? `<div class="bar overview-bar" style="height: ${height}px;"></div>` : ""}
          </div>
        </div>
      `;
    }).join("")}
  `;
}

function renderTeamSlide(teamName, rows) {
  const metrics = [
    {
      label: "PreSales Booking",
      dayKey: "PreSales (days)",
      weekKey: "PreSales (weeks)",
      cssClass: "pre"
    },
    {
      label: "Successful SC1",
      dayKey: "SC1 Successful (days)",
      weekKey: "SC1 Successful (weeks)",
      cssClass: "successful"
    },
    {
      label: "IDV",
      dayKey: "IDV (days)",
      weekKey: "IDV (weeks)",
      cssClass: "idv"
    },
    {
      label: "TBK",
      dayKey: "TBK (days)",
      weekKey: "TBK (weeks)",
      cssClass: "tbk"
    }
  ];

  const sortedRows = [...rows].sort((a, b) => Number(b.Sort || 0) - Number(a.Sort || 0));

  const dayRows = sortedRows.filter(row => String(row.Day || "").trim() !== "");
  const weekRows = sortedRows
    .filter(row => String(row.CW || "").trim() !== "" && hasAnyWeeklyValue(row, metrics))
    .sort((a, b) => getWeekNumber(a.CW) - getWeekNumber(b.CW));

  const mtdIdv = getTeamMtdValue(teamName, "IDV");
  const mtdTbk = getTeamMtdValue(teamName, "TBK");

  return `
    <main class="slide">
      <section class="team-top">
        <div class="team-title">${escapeHtml(teamName)}</div>

        <div class="summary-card">
          <div class="summary-title">MTD Summary</div>

          <div class="summary-values">
            <div class="summary-item">
              <div class="summary-label idv-color">IDV</div>
              <div class="summary-number idv-color">${formatNumber(mtdIdv)}</div>
            </div>

            <div class="summary-item">
              <div class="summary-label tbk-color">TBK</div>
              <div class="summary-number tbk-color">${formatNumber(mtdTbk)}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="team-content">
        <div>
          <div class="label-spacer"></div>

          <div class="metric-labels">
            ${metrics.map(metric => `<div class="metric-label">${escapeHtml(metric.label)}</div>`).join("")}
          </div>
        </div>

        <div class="chart-column">
          <div class="section-title">Last 10 days</div>

          <div class="chart-stack">
            ${metrics.map(metric => renderTeamChartCard({
              cssClass: metric.cssClass,
              rows: dayRows,
              valueKey: metric.dayKey,
              labelKey: "Day",
              weekly: false
            })).join("")}
          </div>
        </div>

        <div class="chart-column">
          <div class="section-title">Last 5 weeks</div>

          <div class="chart-stack">
            ${metrics.map(metric => renderTeamChartCard({
              cssClass: metric.cssClass,
              rows: weekRows,
              valueKey: metric.weekKey,
              labelKey: "CW",
              weekly: true
            })).join("")}
          </div>
        </div>
      </section>
    </main>
  `;
}

function renderTeamChartCard({ cssClass, rows, valueKey, labelKey, weekly }) {
  const validRows = rows.filter(row => {
    const value = row[valueKey];
    return value !== "" && value !== null && value !== undefined;
  });

  const max = Math.max(...validRows.map(row => Number(row[valueKey] || 0)), 1);

  return `
    <div class="chart-card ${weekly ? "weekly-card" : ""} ${cssClass}">
      <div class="mini-chart ${weekly ? "weekly-chart" : ""}">
        ${validRows.map((row, index) => {
          const value = Number(row[valueKey] || 0);
          const height = Math.max((value / max) * 100, value > 0 ? 7 : 2);
          const isLatest = weekly && index === validRows.length - 1;
          const isMax = weekly && value === max;

          return `
            <div class="bar-wrap ${isLatest ? "latest" : ""} ${isMax ? "max" : ""}">
              ${isLatest ? `<div class="latest-pill">latest</div>` : ""}
              <div class="bar-value">${formatNumber(value)}</div>
              <div class="bar team-bar" style="height: ${height}%;"></div>
              <div class="bar-label">${escapeHtml(row[labelKey] || "")}</div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

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
      <section class="overview-title">
        <span>Slide not configured: ${escapeHtml(slideId)}</span>
      </section>
    </main>
  `;
}

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

  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 0
  })
    .format(number)
    .replace(/\./g, " ");
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
