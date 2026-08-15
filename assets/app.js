"use strict";

/* ---------- CSV loading + parsing ---------- */

/** Minimal RFC4180-aware CSV line splitter (handles quoted fields with
 * embedded commas/quotes) -- poller/poll.py writes via Python's csv module,
 * which quotes fields containing special characters, so this needs to
 * handle that even though today's company names happen not to need it. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

/** {allDates: string[], byCompany: Map<company, Map<date, count>>, latest: Map<company, count>} */
function buildDataset(rows) {
  const [header, ...body] = rows;
  const dateIdx = header.indexOf("date");
  const companyIdx = header.indexOf("company");
  const countIdx = header.indexOf("count");

  const dateSet = new Set();
  const byCompany = new Map();

  for (const r of body) {
    const date = r[dateIdx];
    const company = r[companyIdx];
    const count = Number(r[countIdx]);
    if (!date || !company || Number.isNaN(count)) continue;
    dateSet.add(date);
    if (!byCompany.has(company)) byCompany.set(company, new Map());
    byCompany.get(company).set(date, count);
  }

  const allDates = Array.from(dateSet).sort();

  const latest = new Map();
  for (const [company, series] of byCompany) {
    const lastDate = [...series.keys()].sort().at(-1);
    latest.set(company, series.get(lastDate));
  }

  return { allDates, byCompany, latest };
}

/* ---------- design tokens (read the CSS custom properties Chart.js can't
   resolve on its own, since it draws to canvas, not DOM) ---------- */

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

const SLOT_COUNT = 8;
function slotColor(slot) {
  return cssVar(`--series-${slot}`);
}

/* ---------- selection state: fixed color slot per company, assigned at
   check-time and held while checked, released (not reshuffled) on uncheck
   -- "color follows the entity, never its rank": unchecking one company
   must never repaint another still-checked company's line. ---------- */

const companySlot = new Map(); // company -> 1..8, only while checked

function firstFreeSlot() {
  const used = new Set(companySlot.values());
  for (let s = 1; s <= SLOT_COUNT; s++) {
    if (!used.has(s)) return s;
  }
  return null;
}

/* ---------- crosshair plugin: a vertical hairline at the active point's X,
   per the dataviz skill's interaction spec ("the crosshair finds the X"). ---------- */

const crosshairPlugin = {
  id: "crosshair",
  afterDatasetsDraw(chart) {
    const active = chart.getActiveElements();
    if (!active || !active.length) return;
    const { ctx, chartArea } = chart;
    const x = active[0].element.x;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = cssVar("--baseline");
    ctx.stroke();
    ctx.restore();
  },
};

/* ---------- main ---------- */

async function main() {
  const resp = await fetch("data/history.csv", { cache: "no-store" });
  if (!resp.ok) {
    document.querySelector(".chart-card").textContent =
      "No data yet -- the first scheduled update hasn't run.";
    return;
  }
  const text = await resp.text();
  const rows = parseCsv(text);
  if (rows.length < 2) {
    document.querySelector(".chart-card").textContent =
      "No data yet -- the first scheduled update hasn't run.";
    return;
  }

  const { allDates, byCompany, latest } = buildDataset(rows);
  const companies = Array.from(byCompany.keys()).sort((a, b) => a.localeCompare(b));

  document.getElementById("last-updated").textContent = allDates.at(-1);

  const ctx = document.getElementById("chart").getContext("2d");
  const chart = new Chart(ctx, {
    type: "line",
    data: { labels: allDates, datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          grid: { color: cssVar("--gridline"), drawOnChartArea: true },
          border: { color: cssVar("--baseline") },
          ticks: { color: cssVar("--text-muted"), maxRotation: 0, autoSkip: true },
        },
        y: {
          beginAtZero: true,
          grid: { color: cssVar("--gridline") },
          border: { color: cssVar("--baseline") },
          ticks: { color: cssVar("--text-muted"), precision: 0 },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: "top",
          align: "start",
          labels: {
            color: cssVar("--text-secondary"),
            usePointStyle: true, // line keys, not boxes
            pointStyle: "line",
            boxWidth: 24,
          },
        },
        tooltip: {
          mode: "index",
          intersect: false,
          usePointStyle: true,
          backgroundColor: cssVar("--surface-1"),
          titleColor: cssVar("--text-primary"),
          bodyColor: cssVar("--text-primary"),
          borderColor: cssVar("--border"),
          borderWidth: 1,
          callbacks: {
            // Values lead, labels follow (the reader has the series from
            // the legend/checkbox and wants the number).
            label(item) {
              const value = item.formattedValue;
              const company = item.dataset.label;
              return `${value} — ${company}`;
            },
          },
        },
      },
    },
    plugins: [crosshairPlugin],
  });

  function datasetFor(company, slot) {
    const series = byCompany.get(company);
    const color = slotColor(slot);
    return {
      label: company,
      data: allDates.map((d) => (series.has(d) ? series.get(d) : null)),
      spanGaps: false,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      borderJoinStyle: "round",
      borderCapStyle: "round",
      tension: 0,
      pointRadius: 4, // >= 8px diameter
      pointHoverRadius: 5,
      pointBackgroundColor: color,
      pointBorderColor: cssVar("--surface-1"), // 2px surface ring
      pointBorderWidth: 2,
    };
  }

  function rebuildChart() {
    chart.data.datasets = Array.from(companySlot.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([company, slot]) => datasetFor(company, slot));
    chart.update();
    renderTable();
    updateSelectionNote();
  }

  function updateSelectionNote() {
    const n = companySlot.size;
    const note = document.getElementById("selection-note");
    note.textContent =
      n === 0
        ? "No companies selected."
        : n >= SLOT_COUNT
        ? `${n} of ${SLOT_COUNT} shown — at the limit; deselect one to add another.`
        : `${n} of ${SLOT_COUNT} shown.`;
  }

  function renderTable() {
    const tbody = document.querySelector("#data-table tbody");
    tbody.textContent = "";
    const rowsOut = [];
    for (const [company] of companySlot) {
      const series = byCompany.get(company);
      for (const date of [...series.keys()].sort().reverse()) {
        rowsOut.push([date, company, series.get(date)]);
      }
    }
    rowsOut.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
    for (const [date, company, count] of rowsOut) {
      const tr = document.createElement("tr");
      const tdDate = document.createElement("td");
      tdDate.textContent = date;
      const tdCompany = document.createElement("td");
      tdCompany.textContent = company; // untrusted label -> textContent, never innerHTML
      const tdCount = document.createElement("td");
      tdCount.className = "num";
      tdCount.textContent = String(count);
      tr.append(tdDate, tdCompany, tdCount);
      tbody.appendChild(tr);
    }
  }

  /* ---------- checkbox panel ---------- */

  const listEl = document.getElementById("company-list");
  const checkboxes = new Map(); // company -> {label, input, swatch}

  for (const company of companies) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = company;

    const swatch = document.createElement("span");
    swatch.className = "swatch";

    const name = document.createElement("span");
    name.textContent = company; // untrusted label -> textContent

    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(latest.get(company) ?? "–");

    label.append(input, swatch, name, count);
    listEl.appendChild(label);
    checkboxes.set(company, { label, input, swatch });

    input.addEventListener("change", () => {
      if (input.checked) {
        const slot = firstFreeSlot();
        if (slot === null) {
          input.checked = false;
          return;
        }
        companySlot.set(company, slot);
        swatch.style.background = slotColor(slot);
      } else {
        companySlot.delete(company);
        swatch.style.background = cssVar("--text-muted");
      }
      syncDisabledState();
      rebuildChart();
    });
  }

  function syncDisabledState() {
    const atCap = companySlot.size >= SLOT_COUNT;
    for (const [company, { label, input }] of checkboxes) {
      if (!input.checked) {
        input.disabled = atCap;
        label.classList.toggle("disabled", atCap);
      }
    }
  }

  function selectTop(n) {
    for (const [, { input }] of checkboxes) input.checked = false;
    companySlot.clear();
    const top = [...latest.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([c]) => c);
    for (const company of top) {
      const slot = firstFreeSlot();
      companySlot.set(company, slot);
      const { input, swatch } = checkboxes.get(company);
      input.checked = true;
      swatch.style.background = slotColor(slot);
    }
    syncDisabledState();
    rebuildChart();
  }

  document.getElementById("select-top").addEventListener("click", () => selectTop(SLOT_COUNT));
  document.getElementById("select-none").addEventListener("click", () => {
    for (const [company, { input, swatch }] of checkboxes) {
      input.checked = false;
      input.disabled = false;
      swatch.style.background = cssVar("--text-muted");
      checkboxes.get(company).label.classList.remove("disabled");
    }
    companySlot.clear();
    rebuildChart();
  });

  document.getElementById("search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const [company, { label }] of checkboxes) {
      label.style.display = company.toLowerCase().includes(q) ? "" : "none";
    }
  });

  selectTop(SLOT_COUNT);
}

main().catch((err) => {
  console.error(err);
  document.querySelector(".chart-card").textContent =
    "Couldn't load job count data: " + err.message;
});
