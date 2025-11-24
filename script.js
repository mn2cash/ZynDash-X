(() => {
  "use strict";

  // ----- Helpers ----------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const fmtCurrency = (v) =>
    v !== undefined && v !== null && !Number.isNaN(Number(v))
      ? `$${Number(v).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "$-";
  const fmtNumber = (v) =>
    v !== undefined && v !== null && !Number.isNaN(Number(v))
      ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })
      : "-";
  const fmtChange = (v) => {
    if (v === undefined || v === null || Number.isNaN(Number(v))) return "0.00%";
    const num = Number(v);
    return `${num > 0 ? "+" : ""}${num.toFixed(2)}%`;
  };

  // Flash error toast helper
  function flashError(msg) {
    const box = document.createElement("div");
    box.className = "flash-error";
    box.textContent = msg;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3000);
  }

  // Card flash helpers
  function animateCard(card) {
    if (!card) return;
    card.classList.remove("card-flash");
    void card.offsetWidth; // force reflow
    card.classList.add("card-flash");
  }

  function flashCardError(card) {
    if (!card) return;
    card.classList.remove("card-error");
    void card.offsetWidth;
    card.classList.add("card-error");
  }

  // Inject dynamic styles for flashes/spinner
  const dynamicStyle = document.createElement("style");
  dynamicStyle.textContent = `
    .card-flash { animation: cardFlash 0.9s ease; }
    @keyframes cardFlash { 0% { box-shadow: 0 0 0 0 rgba(92,244,255,0.6);} 70% { box-shadow: 0 0 0 16px rgba(92,244,255,0);} 100% { box-shadow: none; } }
    .card-error { animation: cardError 1s ease; }
    @keyframes cardError { 0% { box-shadow: 0 0 0 0 rgba(255,92,92,0.7);} 60% { box-shadow: 0 0 0 18px rgba(255,92,92,0);} 100% { box-shadow: none; } }
    .ai-loading-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); backdrop-filter: blur(10px); display: grid; place-items: center; z-index: 120; }
    .ai-loading-box { padding: 18px 24px; border-radius: 18px; background: rgba(12,16,26,0.8); border: 1px solid rgba(92,244,255,0.25); box-shadow: 0 20px 70px rgba(0,0,0,0.5); text-align: center; color: #ecf1ff; font-weight: 600; letter-spacing: 0.4px; }
    .ai-spinner { width: 82px; height: 82px; border-radius: 50%; border: 6px solid rgba(92,244,255,0.12); border-top-color: rgba(92,244,255,0.9); border-right-color: rgba(160,123,255,0.85); animation: spin 1s linear infinite; margin: 0 auto 14px; }
  `;
  document.head.appendChild(dynamicStyle);

  // ----- State ------------------------------------------------------------
  const API = {
    prices: "https://min-api.cryptocompare.com/data/pricemulti?fsyms=BTC,ETH&tsyms=USD",
    historyBtc: "https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=24",
    historyEth: "https://min-api.cryptocompare.com/data/v2/histohour?fsym=ETH&tsym=USD&limit=24",
    ws: null,
    weather:
      "https://api.open-meteo.com/v1/forecast?latitude=54.28&longitude=-0.40&current_weather=true&hourly=relativehumidity_2m&daily=temperature_2m_max,temperature_2m_min,wind_speed_10m_max&forecast_days=5&timezone=auto",
    fx: "https://api.frankfurter.app/latest?from=USD&to=EUR,GBP",
  };

  const state = {
    theme: localStorage.getItem("theme") || "dark",
    autoRefreshMs: Number(localStorage.getItem("refreshMs")) || 20000,
    autoRefreshTimer: null,
    websocket: null,
    charts: {},
    lastPrices: { btc: null, eth: null },
    notificationsEnabled: true,
    animationsEnabled: true,
    aiHistory: [],
    aiEngine: null,
    aiLoading: false,
  };

  // ----- Fetch helpers ----------------------------------------------------
  const backoff = { delay: 1000, max: 8000 };
  const fallback = {
    altBinance: true,
    btc: { id: "bitcoin", name: "Bitcoin", symbol: "BTC", priceUsd: "68000", changePercent24Hr: "1.2", marketCapUsd: "1340000000000" },
    eth: { id: "ethereum", name: "Ethereum", symbol: "ETH", priceUsd: "3600", changePercent24Hr: "0.8", marketCapUsd: "440000000000" },
    markets: () => [
      { id: "bitcoin", name: "Bitcoin", symbol: "BTC", priceUsd: "68000", changePercent24Hr: "1.2", marketCapUsd: "1340000000000" },
      { id: "ethereum", name: "Ethereum", symbol: "ETH", priceUsd: "3600", changePercent24Hr: "0.8", marketCapUsd: "440000000000" },
    ],
    history: (base = 68000) => {
      const now = Date.now();
      const labels = [];
      const values = [];
      for (let i = 23; i >= 0; i--) {
        const t = new Date(now - i * 3600_000);
        labels.push(t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        const jitter = (Math.sin(i / 3) + Math.random() * 0.5) * 120;
        values.push(Math.max(1, base + jitter));
      }
      return { labels, values };
    },
    weather: {
      temperature: 12,
      windspeed: 4,
      humidity: 68,
      weathercode: 0,
      forecast: {
        labels: ["D1", "D2", "D3", "D4", "D5"],
        max: [13, 14, 15, 14, 13],
        min: [8, 9, 9, 8, 7],
      },
    },
    fx: { eur: 0.92, gbp: 0.79 },
  };
  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  // ----- Charts -----------------------------------------------------------
  function chartColors(theme) {
    const isLight = theme === "light";
    return {
      text: isLight ? "#0b1020" : "#ecf1ff",
      grid: isLight ? "rgba(11,16,32,0.08)" : "rgba(236,241,255,0.08)",
      cyan: "#5cf4ff",
      purple: "#a07bff",
      green: "#6cf4c5",
      panel: isLight ? "rgba(11,16,32,0.06)" : "rgba(255,255,255,0.06)",
    };
  }

  function buildChart(ctx, type, options) {
    if (!ctx) return null;
    return new Chart(ctx, {
      type,
      data: options.data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: options.legend ?? false, labels: { color: chartColors(state.theme).text } },
          tooltip: { mode: "index", intersect: false },
        },
        scales: options.scales || {
          x: { ticks: { color: chartColors(state.theme).text }, grid: { color: chartColors(state.theme).grid } },
          y: { ticks: { color: chartColors(state.theme).text }, grid: { color: chartColors(state.theme).grid } },
        },
      },
    });
  }

  function initCharts() {
    const colors = chartColors(state.theme);
    state.charts.btc = buildChart($("#btcChart"), "line", {
      data: {
        labels: [],
        datasets: [
          {
            label: "BTC",
            data: [],
            tension: 0.35,
            borderWidth: 3,
            borderColor: colors.cyan,
            backgroundColor: "rgba(92,244,255,0.18)",
            fill: true,
          },
        ],
      },
    });

    state.charts.weather = buildChart($("#weatherChart"), "bar", {
      data: {
        labels: ["Temp", "Wind", "Humidity"],
        datasets: [
          {
            label: "Readings",
            data: [0, 0, 0],
            backgroundColor: [colors.cyan, colors.purple, colors.green],
            borderRadius: 8,
          },
        ],
      },
      legend: true,
    });

    state.charts.currency = buildChart($("#currencyChart"), "doughnut", {
      data: {
        labels: ["EUR", "GBP"],
        datasets: [
          {
            data: [0, 0],
            backgroundColor: [colors.cyan, colors.purple],
            borderWidth: 1,
            borderColor: "transparent",
          },
        ],
      },
      legend: true,
    });

    state.charts.btcMini = buildChart($("#btcMini"), "line", {
      data: { labels: [], datasets: [{ data: [], borderColor: colors.cyan, tension: 0.4, fill: false }] },
    });

    state.charts.ethMini = buildChart($("#ethMini"), "line", {
      data: { labels: [], datasets: [{ data: [], borderColor: colors.purple, tension: 0.4, fill: false }] },
    });

    state.charts.forecast = buildChart($("#forecastChart"), "line", {
      data: {
        labels: [],
        datasets: [
          { label: "High", data: [], borderColor: colors.cyan, tension: 0.35, fill: false },
          { label: "Low", data: [], borderColor: colors.purple, tension: 0.35, fill: false },
        ],
      },
      legend: true,
    });

    state.charts.fxRadar = buildChart($("#fxRadarChart"), "bar", {
      data: {
        labels: ["EUR", "GBP"],
        datasets: [{ data: [0, 0], backgroundColor: [colors.cyan, colors.purple], borderRadius: 8 }],
      },
      legend: false,
    });
  }

  function syncChartTheme() {
    const colors = chartColors(state.theme);
    Object.values(state.charts).forEach((chart) => {
      if (!chart) return;
      if (chart.options.scales) {
        if (chart.options.scales.x?.ticks) chart.options.scales.x.ticks.color = colors.text;
        if (chart.options.scales.y?.ticks) chart.options.scales.y.ticks.color = colors.text;
        if (chart.options.scales.x?.grid) chart.options.scales.x.grid.color = colors.grid;
        if (chart.options.scales.y?.grid) chart.options.scales.y.grid.color = colors.grid;
      }
      if (chart.options.plugins?.legend?.labels) {
        chart.options.plugins.legend.labels.color = colors.text;
      }
      chart.update("none");
    });
  }

  // ----- Crypto (CryptoCompare) -------------------------------------------------
  async function fetchHistory(assetId) {
    const url = assetId === "ethereum" ? API.historyEth : API.historyBtc;
    const historyRes = await fetchJson(url);
    const points = historyRes?.Data?.Data || [];
    if (!points.length) {
      flashError("Crypto history unavailable.");
      return fallback.history(assetId === "bitcoin" ? 68000 : 3600);
    }
    const labels = points.map((p) =>
      new Date(p.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
    const values = points.map((p) => Number(p.close));
    return { labels, values };
  }

  // Crypto prices via CryptoCompare
  async function fetchCrypto() {
    const btcPriceEl = document.querySelector("#btcPrice");
    const ethPriceEl = document.querySelector("#ethPrice");
    const cardBTC = document.querySelector('.crypto-card[data-filter*="bitcoin"]');
    const cardETH = document.querySelector('.crypto-card[data-filter*="ethereum"]');
    try {
      const data = await fetchJson(API.prices);
      const btc = data?.BTC?.USD;
      const eth = data?.ETH?.USD;

      if (btcPriceEl && typeof btc === "number") btcPriceEl.textContent = `$${btc.toLocaleString()}`;
      if (ethPriceEl && typeof eth === "number") ethPriceEl.textContent = `$${eth.toLocaleString()}`;
      const updated = document.querySelector("#lastUpdated");
      if (updated) updated.textContent = new Date().toLocaleTimeString();

      if (cardBTC) animateCard(cardBTC);
      if (cardETH) animateCard(cardETH);
    } catch (err) {
      console.error("Crypto error:", err);
      flashError("Crypto prices unavailable");
      if (btcPriceEl) btcPriceEl.textContent = fmtCurrency(Number(fallback.btc.priceUsd));
      if (ethPriceEl) ethPriceEl.textContent = fmtCurrency(Number(fallback.eth.priceUsd));
      const updated = document.querySelector("#lastUpdated");
      if (updated) updated.textContent = new Date().toLocaleTimeString();

      if (cardBTC) flashCardError(cardBTC);
      if (cardETH) flashCardError(cardETH);
    }
  }

  async function fetchMarkets() {
    const table = $("#marketsTable");
    if (!table) return;
    try {
      const prices = await fetchJson(API.prices);
      const btcPrice = prices?.BTC?.USD;
      const ethPrice = prices?.ETH?.USD;

      const [btcHist, ethHist] = await Promise.all([fetchHistory("bitcoin"), fetchHistory("ethereum")]);

      const btcChange = btcHist.values.length > 1 ? ((btcHist.values.at(-1) - btcHist.values[0]) / btcHist.values[0]) * 100 : 0;
      const ethChange = ethHist.values.length > 1 ? ((ethHist.values.at(-1) - ethHist.values[0]) / ethHist.values[0]) * 100 : 0;

      const assets = [
        {
          id: "bitcoin",
          name: "Bitcoin",
          symbol: "BTC",
          priceUsd: typeof btcPrice === "number" ? btcPrice : Number(fallback.btc.priceUsd),
          changePercent24Hr: btcChange,
          history: btcHist,
          marketCapUsd: fallback.btc.marketCapUsd,
        },
        {
          id: "ethereum",
          name: "Ethereum",
          symbol: "ETH",
          priceUsd: typeof ethPrice === "number" ? ethPrice : Number(fallback.eth.priceUsd),
          changePercent24Hr: ethChange,
          history: ethHist,
          marketCapUsd: fallback.eth.marketCapUsd,
        },
      ];

      const rows = assets.map((asset) => {
        const hist = asset.history;
        const high = Math.max(...hist.values);
        const low = Math.min(...hist.values);
        return `
          <tr>
            <td>${asset.name} (${asset.symbol})</td>
            <td>${fmtCurrency(asset.priceUsd)}</td>
            <td style="color:${Number(asset.changePercent24Hr) >= 0 ? "#6cf4c5" : "#ff7b9c"}">${fmtChange(
          asset.changePercent24Hr
        )}</td>
            <td>${fmtCurrency(high)}</td>
            <td>${fmtCurrency(low)}</td>
            <td>${fmtNumber(asset.marketCapUsd)}</td>
          </tr>
        `;
      });
      table.innerHTML = rows.join("");
      if (state.charts.btc) {
        state.charts.btc.data.labels = btcHist.labels;
        state.charts.btc.data.datasets[0].data = btcHist.values;
        state.charts.btc.update("none");
      }
      if (state.charts.btcMini) {
        state.charts.btcMini.data.labels = btcHist.labels;
        state.charts.btcMini.data.datasets[0].data = btcHist.values;
        state.charts.btcMini.update("none");
      }
      if (state.charts.ethMini) {
        state.charts.ethMini.data.labels = ethHist.labels;
        state.charts.ethMini.data.datasets[0].data = ethHist.values;
        state.charts.ethMini.update("none");
      }
    } catch (err) {
      console.error("Markets error:", err);
      flashError("Crypto data failed to load.");
      table.innerHTML = `<tr><td colspan="6" class="muted">Live data unavailable</td></tr>`;
      const fallbackBtc = fallback.history(68000);
      const fallbackEth = fallback.history(3600);
      if (state.charts.btc) {
        state.charts.btc.data.labels = fallbackBtc.labels;
        state.charts.btc.data.datasets[0].data = fallbackBtc.values;
        state.charts.btc.update("none");
      }
      if (state.charts.btcMini) {
        state.charts.btcMini.data.labels = fallbackBtc.labels;
        state.charts.btcMini.data.datasets[0].data = fallbackBtc.values;
        state.charts.btcMini.update("none");
      }
      if (state.charts.ethMini) {
        state.charts.ethMini.data.labels = fallbackEth.labels;
        state.charts.ethMini.data.datasets[0].data = fallbackEth.values;
        state.charts.ethMini.update("none");
      }
    }
  }

  function startWebSocket() {
    // WebSocket feed disabled for CryptoCompare fallback
  }

  function pushChartPoint(chart, value) {
    if (!chart) return;
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    chart.data.labels.push(now);
    chart.data.datasets[0].data.push(value);
    if (chart.data.labels.length > 30) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
    }
    chart.update("none");
  }

  // ----- Weather ----------------------------------------------------------
  async function fetchWeather() {
    try {
      const res = await fetchJson(API.weather);
      const current = res?.current_weather;
      const humidity = res?.hourly?.relativehumidity_2m?.[0];
      const daily = res?.daily;

      const temp = current?.temperature ?? fallback.weather.temperature;
      const wind = current?.windspeed ?? fallback.weather.windspeed;
      const code = current?.weathercode ?? fallback.weather.weathercode;
      const hum = humidity ?? fallback.weather.humidity;

      $("#tempValue").textContent = temp;
      $("#windValue").textContent = wind;
      $("#weatherCode").textContent = code;
      $("#tempDetail").textContent = temp;
      $("#windDetail").textContent = wind;
      $("#humidityDetail").textContent = hum;
      $("#weatherCodeDetail").textContent = code;

      if (state.charts.weather) {
        state.charts.weather.data.datasets[0].data = [
          Number(temp) || 0,
          Number(wind) || 0,
          Number(hum) || 0,
        ];
        state.charts.weather.update("none");
      }

      if (state.charts.forecast) {
        const labels = (daily?.time || fallback.weather.forecast.labels).map((d) => d.slice ? d.slice(5) : d);
        state.charts.forecast.data.labels = labels;
        state.charts.forecast.data.datasets[0].data = daily?.temperature_2m_max || fallback.weather.forecast.max;
        state.charts.forecast.data.datasets[1].data = daily?.temperature_2m_min || fallback.weather.forecast.min;
        state.charts.forecast.update("none");
      }
    } catch (err) {
      console.error("Weather error:", err);
      const temp = fallback.weather.temperature;
      const wind = fallback.weather.windspeed;
      const hum = fallback.weather.humidity;
      const code = fallback.weather.weathercode;
      $("#tempValue").textContent = temp;
      $("#windValue").textContent = wind;
      $("#weatherCode").textContent = code;
      $("#tempDetail").textContent = temp;
      $("#windDetail").textContent = wind;
      $("#humidityDetail").textContent = hum;
      $("#weatherCodeDetail").textContent = code;
      if (state.charts.weather) {
        state.charts.weather.data.datasets[0].data = [temp, wind, hum];
        state.charts.weather.update("none");
      }
      if (state.charts.forecast) {
        state.charts.forecast.data.labels = fallback.weather.forecast.labels;
        state.charts.forecast.data.datasets[0].data = fallback.weather.forecast.max;
        state.charts.forecast.data.datasets[1].data = fallback.weather.forecast.min;
        state.charts.forecast.update("none");
      }
    }
  }

  // ----- FX ---------------------------------------------------------------
  async function fetchFX() {
    try {
      const res = await fetchJson(API.fx);
      const eur = res?.rates?.EUR;
      const gbp = res?.rates?.GBP;
      $("#eurRate").textContent = eur ? eur.toFixed(3) : "-";
      $("#gbpRate").textContent = gbp ? gbp.toFixed(3) : "-";
      if (state.charts.currency) {
        state.charts.currency.data.datasets[0].data = [eur || 0, gbp || 0];
        state.charts.currency.update("none");
      }
      if (state.charts.fxRadar) {
        state.charts.fxRadar.data.datasets[0].data = [eur || 0, gbp || 0];
        state.charts.fxRadar.update("none");
      }
    } catch (err) {
      console.error("FX error:", err);
      const eur = fallback.fx.eur;
      const gbp = fallback.fx.gbp;
      $("#eurRate").textContent = eur.toFixed(3);
      $("#gbpRate").textContent = gbp.toFixed(3);
      if (state.charts.currency) {
        state.charts.currency.data.datasets[0].data = [eur, gbp];
        state.charts.currency.update("none");
      }
      if (state.charts.fxRadar) {
        state.charts.fxRadar.data.datasets[0].data = [eur, gbp];
        state.charts.fxRadar.update("none");
      }
    }
  }

  // ----- Ticker & Feed ----------------------------------------------------
  function pushTicker(text) {
    const track = $("#tickerTrack");
    if (!track) return;
    const item = document.createElement("span");
    item.className = "ticker-item";
    item.textContent = text;
    track.appendChild(item);
    if (track.children.length > 20) track.removeChild(track.firstChild);
  }

  function addFeedEntry(text) {
    const list = $("#feedList");
    if (!list) return;
    const li = document.createElement("li");
    const ts = new Date().toLocaleTimeString();
    li.innerHTML = `<span>${text}</span><span class="badge">${ts}</span>`;
    list.prepend(li);
    if (list.children.length > 40) list.removeChild(list.lastChild);
  }

  // ----- Theme ------------------------------------------------------------
  function applyTheme(theme) {
    state.theme = theme;
    document.body.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
    syncChartTheme();
  }

  function toggleTheme() {
    const next = state.theme === "dark" ? "light" : "dark";
    applyTheme(next);
  }

  // ----- Router -----------------------------------------------------------
  function applyRoute(route) {
    const target = route || "overview";
    $$(".section").forEach((sec) => {
      sec.classList.toggle("active", sec.dataset.section === target);
    });
    $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.route === target));
    $$(".mobile-link").forEach((link) => link.classList.toggle("active", link.dataset.mobileRoute === target));
    $("#pageTitle").textContent =
      target === "markets"
        ? "Markets"
        : target === "weather"
        ? "Weather"
        : target === "realtime"
        ? "Realtime"
        : target === "settings"
        ? "Settings"
        : target === "ai"
        ? "ZynAI Assistant"
        : "Real-Time Analytics";

    if (target === "ai") {
      openAI();
    } else {
      closeAI(false);
    }
  }

  function initRouting() {
    const navLinks = [...$$(".nav-link"), ...$$(".mobile-link")];
    navLinks.forEach((link) =>
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const route = link.dataset.route || link.dataset.mobileRoute;
        window.location.hash = route ? `#${route}` : "#overview";
        applyRoute(route);
      })
    );
    window.addEventListener("hashchange", () => {
      const route = window.location.hash.replace("#", "") || "overview";
      applyRoute(route);
    });
    const startRoute = window.location.hash.replace("#", "") || "overview";
    applyRoute(startRoute);
  }

  // ----- UI bindings ------------------------------------------------------
  function bindUI() {
    $("#themeToggle")?.addEventListener("click", toggleTheme);

    $("#refreshBtn")?.addEventListener("click", async () => {
      const btn = $("#refreshBtn");
      btn?.classList.add("spinning");
      await hydrate();
      setTimeout(() => btn?.classList.remove("spinning"), 600);
    });

    $("#marketsRefresh")?.addEventListener("click", fetchMarkets);
    $("#openFxModal")?.addEventListener("click", () => toggleModal("#fxModal", true));
    $("#fxRadarBtn")?.addEventListener("click", () => toggleModal("#fxModal", true));
    $$("#fxModal [data-close-modal]").forEach((btn) =>
      btn.addEventListener("click", () => toggleModal("#fxModal", false))
    );

    $("#openSettingsModal")?.addEventListener("click", () => toggleModal("#settingsModal", true));
    $("#settingsOpen")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.hash = "#settings";
      applyRoute("settings");
      toggleModal("#settingsModal", true);
    });
    $("#resetFromPanel")?.addEventListener("click", resetSettings);
    $("#saveSettings")?.addEventListener("click", saveSettings);
    $("#resetSettings")?.addEventListener("click", resetSettings);
    $$("#settingsModal [data-close-modal]").forEach((btn) =>
      btn.addEventListener("click", () => toggleModal("#settingsModal", false))
    );

    $("#autoRefresh")?.addEventListener("click", toggleAutoRefresh);
    $("#bitAutoRefresh")?.addEventListener("click", toggleAutoRefresh);

    $("#liveToggle")?.addEventListener("click", (e) => {
      const on = e.currentTarget.getAttribute("aria-pressed") !== "false";
      e.currentTarget.setAttribute("aria-pressed", (!on).toString());
      e.currentTarget.textContent = `Live Feed: ${on ? "OFF" : "ON"}`;
      document.querySelector(".ticker")?.classList.toggle("paused", on);
    });

    $("#autoRefresh")?.addEventListener("click", (e) => {
      e.currentTarget.classList.toggle("active");
    });

    $("#pulsePower")?.addEventListener("click", (e) => {
      const on = e.currentTarget.getAttribute("aria-pressed") !== "false";
      e.currentTarget.setAttribute("aria-pressed", (!on).toString());
      e.currentTarget.textContent = `Power: ${on ? "OFF" : "ON"}`;
      document.querySelector(".ticker")?.classList.toggle("paused", on);
    });

    $("#clearFeed")?.addEventListener("click", () => ($("#feedList").innerHTML = ""));

    $("#bitGlow")?.addEventListener("click", (e) => {
      e.currentTarget.classList.toggle("active");
      document.body.classList.toggle("glow-off", !document.body.classList.contains("glow-off"));
    });

    $("#bitNotifications")?.addEventListener("click", (e) => {
      e.currentTarget.classList.toggle("active");
      state.notificationsEnabled = e.currentTarget.classList.contains("active");
    });

    $("#bitCompact")?.addEventListener("click", (e) => {
      e.currentTarget.classList.toggle("active");
      document.body.classList.toggle("compact-mode", e.currentTarget.classList.contains("active"));
    });

    $("#searchInput")?.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      $$(".filterable").forEach((el) => {
        const txt = el.dataset.filter?.toLowerCase() || "";
        el.style.display = txt.includes(q) ? "" : "none";
      });
    });

    // Ripple effect
    $$(".ripple").forEach((el) =>
      el.addEventListener("pointerdown", (e) => {
        const rect = el.getBoundingClientRect();
        el.style.setProperty("--ripple-x", `${e.clientX - rect.left}px`);
        el.style.setProperty("--ripple-y", `${e.clientY - rect.top}px`);
        el.style.setProperty("--ripple-size", `${Math.max(rect.width, rect.height)}px`);
      })
    );

    // AI triggers
    $("#aiOpen")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.hash = "#ai";
      applyRoute("ai");
    });
    $("#aiClose")?.addEventListener("click", () => closeAI(true));
    $("#aiMinimize")?.addEventListener("click", () => closeAI(true));
    $("#aiOverlay")?.addEventListener("click", () => closeAI(true));
    initAIForm();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAI(true);
    });
  }

  // ----- Modals -----------------------------------------------------------
  function toggleModal(sel, show) {
    const modal = $(sel);
    if (!modal) return;
    modal.classList.toggle("show", show);
    modal.setAttribute("aria-hidden", (!show).toString());
  }

  // ----- Settings ---------------------------------------------------------
  function saveSettings() {
    const animationsToggle = $("#animationsToggle")?.checked;
    const defaultTheme = $("#defaultThemeSelect")?.value || "dark";
    const interval = Number($("#refreshIntervalInput")?.value) || 20;
    state.animationsEnabled = animationsToggle;
    document.body.classList.toggle("animations-off", !animationsToggle);
    state.autoRefreshMs = interval * 1000;
    localStorage.setItem("refreshMs", state.autoRefreshMs.toString());
    applyTheme(defaultTheme);
    toggleModal("#settingsModal", false);
  }

  function resetSettings() {
    document.body.classList.remove("animations-off", "compact-mode", "glow-off");
    state.animationsEnabled = true;
    state.notificationsEnabled = true;
    state.autoRefreshMs = 20000;
    localStorage.removeItem("refreshMs");
    applyTheme("dark");
    $("#animationsToggle").checked = true;
    $("#defaultThemeSelect").value = "dark";
    $("#refreshIntervalInput").value = 20;
    toggleModal("#settingsModal", false);
  }

  // ----- Auto refresh -----------------------------------------------------
  function startAutoRefresh() {
    clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = setInterval(hydrate, state.autoRefreshMs);
  }

  function stopAutoRefresh() {
    clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }

  function toggleAutoRefresh() {
    const active = !!state.autoRefreshTimer;
    if (active) {
      stopAutoRefresh();
      $("#autoRefresh")?.classList.remove("active");
      $("#bitAutoRefresh")?.classList.remove("active");
    } else {
      startAutoRefresh();
      $("#autoRefresh")?.classList.add("active");
      $("#bitAutoRefresh")?.classList.add("active");
    }
  }

  // Independent 60s crypto refresh loops
  setInterval(fetchCrypto, 60000);
  setInterval(fetchMarkets, 60000);

  // ----- Notifications ----------------------------------------------------
  function notify(text) {
    if (!state.notificationsEnabled) return;
    const tray = $("#notificationTray");
    if (!tray) return;
    const note = document.createElement("div");
    note.className = "notification info";
    note.textContent = text;
    tray.appendChild(note);
    setTimeout(() => note.remove(), 3200);
  }

  // ----- AI / LM Studio ------------------------------------------------------
  const aiPanel = $("#aiPanel");
  const aiOverlay = $("#aiOverlay");
  const aiMessages = $("#aiMessages");
  const aiTyping = $("#aiTyping");
  const aiTextarea = $("#aiTextarea");
  const aiForm = $("#aiForm");
  const aiActions = $(".ai-actions");

  // Inject clear chat button if missing
  if (aiActions && !$("#aiClear")) {
    const clearBtn = document.createElement("button");
    clearBtn.id = "aiClear";
    clearBtn.className = "ghost-btn small-btn ripple";
    clearBtn.textContent = "Clear";
    clearBtn.setAttribute("aria-label", "Clear chat");
    aiActions.prepend(clearBtn);
    clearBtn.addEventListener("click", clearChat);
  }

  function showAILoadingSpinner() {
    if (document.querySelector(".ai-loading-overlay")) return;
    const overlay = document.createElement("div");
    overlay.className = "ai-loading-overlay";
    overlay.innerHTML = `<div class="ai-loading-box"><div class="ai-spinner"></div><div>Loading ZynAI Engine...</div></div>`;
    document.body.appendChild(overlay);
  }

  function hideAILoadingSpinner() {
    document.querySelector(".ai-loading-overlay")?.remove();
  }

  function showAIErrorMessage(msg) {
    addAIMessage("ZynAI", msg, "bot");
  }

  async function askLMStudio(prompt, history) {
    try {
      const res = await fetch("http://localhost:1234/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "local-model",
          messages: history.concat([{ role: "user", content: prompt }]),
        }),
      });

      if (!res.ok) throw new Error("LM Studio offline");

      const json = await res.json();
      return json.choices[0].message.content;
    } catch (err) {
      throw new Error("LM_STUDIO_OFFLINE");
    }
  }

  // Simple fallback engine so ZynAI always works even if LM Studio is offline
  const createFallbackEngine = () => ({
    chat: {
      completions: {
        create: async ({ messages }) => {
          const last = messages[messages.length - 1]?.content || "";
          return {
            choices: [
              {
                message: {
                  content:
                    'ZynAI demo engine active.\\n\\nYou said: "' +
                    last +
                    '".\\n\\nStart LM Studio to enable the full AI model.',
                },
              },
            ],
          };
        },
      },
    },
  });

  const loadAIEngine = async () => {
    if (state.aiEngine) return;

    try {
      const test = await fetch("http://localhost:1234/v1/models");
      if (!test.ok) throw new Error("LM Studio offline");

      state.aiEngine = { type: "lmstudio" };

      const hello = "ZynAI online (LM Studio). Ask me anything!";
      appendAIMessage("bot", hello);
      state.aiHistory.push({ role: "assistant", content: hello });
    } catch (err) {
      console.warn("LM Studio offline → Using demo engine");

      state.aiEngine = createFallbackEngine();

      const helloDemo =
        "ZynAI demo engine active. The full AI server is not running.";
      appendAIMessage("bot", helloDemo);
      state.aiHistory.push({ role: "assistant", content: helloDemo });
    }
  };

  function addAIMessage(role, text, type) {
    if (!aiMessages) return;
    const msg = document.createElement("div");
    msg.className = `ai-msg ${type}`;
    msg.innerHTML = `<div class="role">${role}</div><div class="text">${text}</div>`;
    aiMessages.appendChild(msg);
    aiMessages.scrollTop = aiMessages.scrollHeight;
  }

  function appendAIMessage(type, text) {
    const role = type === "bot" ? "ZynAI" : "You";
    addAIMessage(role, text, type);
  }

  function setTyping(show) {
    aiTyping?.classList.toggle("show", show);
  }


  async function aiRespond(prompt) {
    const msg = prompt.trim();
    if (!msg) return;

    addAIMessage("You", msg, "user");
    state.aiHistory.push({ role: "user", content: msg });

    if (!state.aiEngine) {
      await loadAIEngine();
    }

    if (aiTyping) {
      aiTyping.style.display = "block";
      aiTyping.classList.add("show");
    }

    try {
      let reply;
      if (state.aiEngine && state.aiEngine.type === "lmstudio") {
        reply = await askLMStudio(msg, state.aiHistory);
      } else {
        const out = await state.aiEngine.chat.completions.create({
          messages: state.aiHistory,
        });
        reply = out.choices[0].message.content;
      }

      if (aiTyping) {
        aiTyping.style.display = "none";
        aiTyping.classList.remove("show");
      }
      addAIMessage("ZynAI", reply, "bot");
      state.aiHistory.push({ role: "assistant", content: reply });
    } catch (err) {
      if (aiTyping) {
        aiTyping.style.display = "none";
        aiTyping.classList.remove("show");
      }
      addAIMessage("ZynAI", "⚠ ZynAI error. Try again.", "bot");
    }
  }


  function clearChat() {
    state.aiHistory = [];
    aiMessages.innerHTML = "";
  }

  function initAIForm() {
    if (!aiForm) return;
    aiForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const val = aiTextarea.value.trim();
      if (!val) return;
      aiTextarea.value = "";
      aiTextarea.focus();
      aiRespond(val);
    });
    aiTextarea?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        aiForm?.dispatchEvent(new Event("submit"));
      }
    });
  }

  function openAI() {
    aiOverlay?.classList.add("show");
    aiPanel?.classList.add("show");
    aiPanel?.setAttribute("aria-hidden", "false");
    aiTextarea?.focus();
    loadAIEngine();
  }

  function closeAI(setRoute) {
    aiOverlay?.classList.remove("show");
    aiPanel?.classList.remove("show");
    aiPanel?.setAttribute("aria-hidden", "true");
    if (setRoute) {
      window.location.hash = "#overview";
      applyRoute("overview");
    }
  }

  // ----- Hydration --------------------------------------------------------
  async function hydrate() {
    try {
      await Promise.all([fetchCrypto(), fetchMarkets(), fetchWeather(), fetchFX()]);
      addFeedEntry("Data synced");
      pushTicker(`Updated ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      console.error("Data update error:", err);
    }
  }

  // ----- Init -------------------------------------------------------------
  function initTheme() {
    applyTheme(state.theme);
    $("#defaultThemeSelect").value = state.theme;
  }

  function init() {
    initTheme();
    initCharts();
    bindUI();
    initRouting();
    fetchCrypto();
    hydrate();
    startWebSocket();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
