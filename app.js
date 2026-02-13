import { h, render } from "https://esm.sh/preact@10.19.6";
import { useEffect, useMemo, useState } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

const formatCurrency = (value) =>
  new Intl.NumberFormat("fi-FI", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);

const parsePercent = (value) =>
  Number(String(value).replace("%", "").replace(",", ".")) / 100;

const parseCsv = (text) => {
  const lines = text.trim().split(/\r?\n/);
  const [headerLine, ...rows] = lines;
  const headers = headerLine.split(";");
  return rows.map((row) => {
    const cols = row.split(";");
    const entry = {};
    headers.forEach((header, index) => {
      entry[header] = cols[index];
    });
    return entry;
  });
};

const parseTyelTable = (text, year) => {
  const lines = text.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.includes(`vuodelle ${year}`));
  if (startIndex === -1) return [];

  const rows = [];
  let buffer = "";
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (rawLine.includes("Vahvistetut") && rows.length) break;
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    if (line.includes("Vakuutettavat")) continue;

    const startsWithTab = /^\s+\d/.test(rawLine) || /^\s+\t/.test(rawLine);
    if (startsWithTab && buffer) {
      const combined = `${buffer}${rawLine}`;
      buffer = "";
      const parts = combined.split(/\t+/).map((part) => part.trim()).filter(Boolean);
      rows.push(parts);
      continue;
    }

    if (/\d/.test(line) && line.includes("\t")) {
      if (buffer) {
        const combined = `${buffer}\t${line}`;
        buffer = "";
        const parts = combined.split(/\t+/).map((part) => part.trim()).filter(Boolean);
        rows.push(parts);
      } else {
        const parts = line.split(/\t+/).map((part) => part.trim()).filter(Boolean);
        rows.push(parts);
      }
      continue;
    }

    buffer = line.trim();
  }

  return rows.map((parts) => {
    if (parts.length === 3) {
      return {
        label: parts[0],
        total: parsePercent(parts[1]),
        employeeBase: parsePercent(parts[2]),
        employeeMiddle: null,
      };
    }
    return {
      label: parts[0],
      total: parsePercent(parts[1]),
      employeeBase: parsePercent(parts[2]),
      employeeMiddle: parsePercent(parts[3]),
    };
  });
};

const interpolateRow = (rows, annualGross) => {
  if (!rows.length) return null;
  const values = rows
    .map((row) => ({
      gross: Number(row["Ansiotulo (€/vuosi)"]),
      net: Number(row["Nettotulo (€/v)"]),
      taxes: Number(row["Verot ja maksut (€/v)"]),
      taxRate: row["Vero-prosentti"],
      marginal: row["Marginaali-vero"],
    }))
    .sort((a, b) => a.gross - b.gross);

  if (annualGross <= values[0].gross) return values[0];
  if (annualGross >= values[values.length - 1].gross) return values[values.length - 1];

  for (let i = 0; i < values.length - 1; i += 1) {
    const current = values[i];
    const next = values[i + 1];
    if (annualGross >= current.gross && annualGross <= next.gross) {
      const ratio = (annualGross - current.gross) / (next.gross - current.gross);
      return {
        gross: annualGross,
        net: current.net + ratio * (next.net - current.net),
        taxes: current.taxes + ratio * (next.taxes - current.taxes),
        taxRate: current.taxRate,
        marginal: current.marginal,
      };
    }
  }
  return values[values.length - 1];
};

const PieChart = ({ segments }) => {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
  let offset = 25;
  return html`
    <svg viewBox="0 0 36 36">
      ${segments.map((segment) => {
        const value = (segment.value / total) * 100;
        const dash = `${value} ${100 - value}`;
        const circle = html`<circle
          r="15.9"
          cx="18"
          cy="18"
          fill="transparent"
          stroke=${segment.color}
          stroke-width="6"
          stroke-dasharray=${dash}
          stroke-dashoffset=${offset}
        />`;
        offset -= value;
        return circle;
      })}
    </svg>
  `;
};

const LineChart = ({ points, highlight }) => {
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padding = 8;

  const toX = (value) =>
    padding + ((value - minX) / (maxX - minX)) * (100 - padding * 2);
  const toY = (value) =>
    100 - padding - ((value - minY) / (maxY - minY)) * (100 - padding * 2);

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${toX(point.x)} ${toY(point.y)}`)
    .join(" ");

  return html`
    <svg viewBox="0 0 100 100" class="line-chart">
      <path d=${path} fill="none" stroke="#2563eb" stroke-width="2" />
      ${highlight &&
      html`<circle
        cx=${toX(highlight.x)}
        cy=${toY(highlight.y)}
        r="2.5"
        fill="#ef4444"
      />`}
      <line x1=${padding} y1=${100 - padding} x2=${100 - padding} y2=${100 - padding} stroke="#cbd5f5" />
      <line x1=${padding} y1=${padding} x2=${padding} y2=${100 - padding} stroke="#cbd5f5" />
    </svg>
  `;
};

const App = () => {
  const [salary, setSalary] = useState(3500);
  const [year, setYear] = useState(2026);
  const [ageGroup, setAgeGroup] = useState("base");
  const [scheme, setScheme] = useState("Yksityisten alojen palkansaajat/TyEL");
  const [taxRows, setTaxRows] = useState([]);
  const [tyelRows, setTyelRows] = useState([]);

  useEffect(() => {
    Promise.all([
      fetch("./asd.csv").then((response) => response.text()),
      fetch("./tyel.txt").then((response) => response.text()),
    ]).then(([csvText, tyelText]) => {
      setTaxRows(parseCsv(csvText));
      setTyelRows(parseTyelTable(tyelText, year));
    });
  }, [year]);

  const annualGross = salary * 12;

  const tyelOptions = useMemo(() => {
    if (!tyelRows.length) return [];
    return tyelRows.map((row) => row.label);
  }, [tyelRows]);

  useEffect(() => {
    if (tyelOptions.length && !tyelOptions.includes(scheme)) {
      setScheme(tyelOptions[0]);
    }
  }, [tyelOptions, scheme]);

  const selectedTyel = tyelRows.find((row) => row.label === scheme);
  const employeeRate = selectedTyel
    ? year === 2025
      ? ageGroup === "middle"
        ? selectedTyel.employeeMiddle ?? selectedTyel.employeeBase
        : selectedTyel.employeeBase
      : selectedTyel.employeeBase
    : 0;

  const totalRate = selectedTyel ? selectedTyel.total : 0;
  const employerRate = Math.max(totalRate - employeeRate, 0);

  const employeeContribution = annualGross * employeeRate;
  const employerContribution = annualGross * employerRate;
  const employerTotalCost = annualGross + employerContribution;

  const taxRow = interpolateRow(taxRows, annualGross);
  const employeeNet = taxRow ? taxRow.net : 0;
  const employeeTaxes = taxRow ? taxRow.taxes : 0;

  const employerSegments = [
    { label: "Bruttopalkka", value: annualGross, color: "#2563eb" },
    { label: "Työnantajan eläkemaksu", value: employerContribution, color: "#22c55e" },
  ];

  const employeeSegments = [
    { label: "Nettotulo", value: employeeNet, color: "#38bdf8" },
    { label: "Verot ja maksut", value: employeeTaxes, color: "#f97316" },
  ];

  const governmentSegments = [
    { label: "Työntekijä", value: employeeNet, color: "#38bdf8" },
    { label: "Verot", value: employeeTaxes, color: "#f97316" },
    { label: "TyEL (työntekijä)", value: employeeContribution, color: "#a855f7" },
    { label: "TyEL (työnantaja)", value: employerContribution, color: "#7c3aed" },
  ];

  const chartPoints = taxRows.map((row) => ({
    x: Number(row["Ansiotulo (€/vuosi)"]),
    y: Number(row["Nettotulo (€/v)"]),
  }));

  return html`
    <header>
      <h1>Julkisen ja työntekijän osuudet palkasta</h1>
      <p>Havainnollista, kuinka palkka jakautuu työntekijälle, veroihin ja TyEL-maksuihin TyEL- ja verodatan perusteella.</p>
    </header>

    <section class="grid">
      <div class="card chart">
        <h2>Julkinen vs. työntekijä</h2>
        <${PieChart} segments=${governmentSegments} />
        <div class="legend">
          ${governmentSegments.map(
            (segment) => html`<div class="legend-item">
              <span><span class="legend-color" style=${{ background: segment.color }}></span>${segment.label}</span>
              <strong>${formatCurrency(segment.value)}</strong>
            </div>`
          )}
        </div>
        <div class="badge">TyEL jaoteltu työntekijän ja työnantajan osuuksiin</div>
      </div>

      <div class="card">
        <h2>Syötteet</h2>
        <div class="control">
          <label for="salary">Kuukausipalkka (€/kk)</label>
          <input
            id="salary"
            type="number"
            min="0"
            value=${salary}
            onInput=${(event) => setSalary(Number(event.target.value || 0))}
          />
        </div>
        <div class="control">
          <label for="year">Vuosi</label>
          <select id="year" value=${year} onChange=${(event) => setYear(Number(event.target.value))}>
            <option value="2026">2026</option>
            <option value="2025">2025</option>
          </select>
        </div>
        <div class="control">
          <label for="scheme">Vakuutettavat / eläkelaki</label>
          <select id="scheme" value=${scheme} onChange=${(event) => setScheme(event.target.value)}>
            ${tyelOptions.map(
              (option) => html`<option value=${option}>${option}</option>`
            )}
          </select>
        </div>
        ${year === 2025 &&
        html`<div class="control">
          <label for="age">Ikäryhmä</label>
          <select id="age" value=${ageGroup} onChange=${(event) => setAgeGroup(event.target.value)}>
            <option value="base">alle 53 v. ja väh. 63 v.</option>
            <option value="middle">53–62 v.</option>
          </select>
        </div>`}
      </div>
    </section>

    <footer>
      Lähteet: tyel.txt (eläkemaksut) ja asd.csv (vero- ja nettotuloarviot). Tulokset ovat arvioita.
    </footer>
  `;
};

render(html`<${App} />`, document.getElementById("app"));
