import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SOURCE_URL = "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv";
const DATA_DIR = "data";
const DATA_FILE = join(DATA_DIR, "tesouro-atual.json");
const STATUS_FILE = join(DATA_DIR, "tesouro-status.json");

function toIsoDate(value) {
  const match = String(value || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function toNumber(value) {
  const normalized = String(value ?? "").trim().replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function couponType(title) {
  return /juros semestrais/i.test(title) ? "semestral" : "zero";
}

function indexer(title) {
  if (/selic/i.test(title)) return "selic";
  if (/ipca/i.test(title)) return "ipca";
  if (/prefixado/i.test(title)) return "prefixado";
  if (/igpm|igp-m/i.test(title)) return "igpm";
  if (/renda\+/i.test(title)) return "renda_mais";
  if (/educa\+/i.test(title)) return "educa_mais";
  return "outros";
}

function csvRows(text) {
  const [headerLine, ...lines] = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = headerLine.split(";").map((header) => header.trim());
  return lines.map((line) => {
    const values = line.split(";");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    const response = await fetch(SOURCE_URL, {
      redirect: "follow",
      signal: AbortSignal.timeout(120000),
      headers: { "User-Agent": "investbase-tesouro-sync/1.0" }
    });
    if (!response.ok) throw new Error(`Fonte oficial respondeu HTTP ${response.status}`);

    const text = await response.text();
    if (text.length < 1000) throw new Error("CSV oficial vazio ou incompleto");

    const rows = csvRows(text);
    const required = ["Tipo Titulo", "Data Vencimento", "Data Base", "PU Base Manha"];
    if (!rows.length || required.some((field) => !(field in rows[0]))) {
      throw new Error("Cabeçalho do CSV oficial não corresponde ao formato esperado");
    }

    const datedRows = rows.map((row) => ({
      row,
      baseDate: toIsoDate(row["Data Base"])
    })).filter(({ baseDate }) => baseDate);

    const latestBaseDate = datedRows.reduce((latest, { baseDate }) =>
      !latest || baseDate > latest ? baseDate : latest, null
    );
    if (!latestBaseDate) throw new Error("CSV sem data-base válida");

    // Publica somente a fotografia mais recente. Dados históricos não podem atualizar PUs atuais.
    const titlesByKey = new Map();
    for (const { row, baseDate } of datedRows) {
      if (baseDate !== latestBaseDate) continue;

      const title = String(row["Tipo Titulo"] || "").trim();
      const maturityDate = toIsoDate(row["Data Vencimento"]);
      const basePrice = toNumber(row["PU Base Manha"]);
      if (!title || !maturityDate || basePrice === null) continue;

      const candidate = {
        title,
        maturity_date: maturityDate,
        base_date: baseDate,
        indexer: indexer(title),
        coupon_type: couponType(title),
        buy_rate: toNumber(row["Taxa Compra Manha"]),
        sell_rate: toNumber(row["Taxa Venda Manha"]),
        buy_price: toNumber(row["PU Compra Manha"]),
        sell_price: toNumber(row["PU Venda Manha"]),
        base_price: basePrice
      };
      titlesByKey.set(`${title}|${maturityDate}`, candidate);
    }

    const titles = [...titlesByKey.values()].sort((a, b) =>
      a.title.localeCompare(b.title, "pt-BR") || a.maturity_date.localeCompare(b.maturity_date)
    );
    if (!titles.length) throw new Error("Nenhum título da data-base mais recente foi extraído");

    const generatedAt = new Date().toISOString();
    await writeJson(DATA_FILE, {
      status: "success",
      source: { name: "Tesouro Transparente", url: SOURCE_URL },
      generated_at: generatedAt,
      latest_base_date: latestBaseDate,
      title_count: titles.length,
      titles
    });
    await writeJson(STATUS_FILE, {
      status: "success",
      generated_at: generatedAt,
      source_url: SOURCE_URL,
      latest_base_date: latestBaseDate,
      title_count: titles.length,
      message: "Dados oficiais da data-base mais recente normalizados com sucesso."
    });
  } catch (error) {
    let lastKnown = null;
    try { lastKnown = JSON.parse(await readFile(DATA_FILE, "utf8")); } catch {}
    await writeJson(STATUS_FILE, {
      status: "error",
      generated_at: new Date().toISOString(),
      source_url: SOURCE_URL,
      latest_base_date: lastKnown?.latest_base_date ?? null,
      title_count: lastKnown?.title_count ?? 0,
      message: error instanceof Error ? error.message : String(error),
      using_last_valid_data: Boolean(lastKnown?.status === "success")
    });
    console.error(error);
    process.exitCode = 1;
  }
}

await main();
