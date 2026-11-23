// Lê o estoque da PP GARAGE 37 (idCompany 12297) no BNDV e grava o CSV que o importar-estoque-bndv.py usa.
//   PW_DIR=<pasta com playwright-core> node scripts/ler-estoque-bndv.mjs saida.csv   (o atualizar-estoque-bndv.sh faz isso)
// Conecta no Chrome do agente (porta 9223, perfil ~/.chrome-bndv, aberto por
// next-cerebro/clientes/pp-automoveis/bndv/abrir-chrome.sh) e usa a mesma API do app do BNDV, com o token da sessão
// que já está logada nele. Nenhuma senha passa por aqui: se a sessão caiu, sai com código 2 e a pessoa entra no BNDV
// naquela janela. (Pelo Deno o playwright não conecta no Chrome 158: por isso é Node.)
import { createRequire } from "node:module";
import fs from "node:fs";

const { chromium } = createRequire(`${process.env.PW_DIR}/`)("playwright-core");
const SAIDA = process.argv[2] || "estoque-bndv.csv";
const EMPRESA = 12297; // PP GARAGE 37 COMERCIO DE VEICULOS LTDA. As outras da conta: AutoNew (870) e PEDRO PAULO AUTOMOVEIS (11933)
const PORTA = process.env.CDP_PORT || "9223";

const nav = await chromium.connectOverCDP(`http://localhost:${PORTA}`, { timeout: 20000 }).catch(() => null);
if (!nav) { console.error(`Chrome do agente fechado na porta ${PORTA}: rode bndv/abrir-chrome.sh`); process.exit(2); }
const ctx = nav.contexts()[0];
const pag = ctx.pages().find((p) => p.url().includes("bndv.com.br")) || await ctx.newPage();
if (!pag.url().includes("app.bndv.com.br/vehicles")) await pag.goto("https://app.bndv.com.br/vehicles", { waitUntil: "domcontentloaded" });
await pag.waitForTimeout(3000);
if (/\/login/.test(pag.url()) || await pag.locator("input[type=password]:visible").count()) {
  console.error("A sessão do BNDV caiu: entre no BNDV na janela do Chrome do agente e rode de novo.");
  process.exit(2);
}

const r = await pag.evaluate(async (empresa) => {
  const token = (localStorage.getItem("access_token") || "").replace(/^"|"$/g, "");
  if (!token) return { sessao: true, itens: [], total: 0 };
  const q = (p) => `query { vehicles_in_stock_web_app(pagination: { page: ${p}, pageSize: 50 } filters: { onlyConsigned: false, idCompany: ${empresa} } orderBy: VEHICLE) { paginationOut { totalRows } items { idVehicle plate yearFabrication yearModel color km price consigned inTraffic vehicleStatus { name } brand { name } model { name } version { name } transmission { name } fuel { name } images { idVehiclePhoto } } } }`;
  const itens = []; let total = 0;
  for (let p = 0; p < 12; p++) {
    const resp = await fetch("https://bndv-vehicle-api.azurewebsites.net/graphql", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ query: q(p) }),
    });
    const j = await resp.json().catch(() => ({}));
    // token vencido ou apagado: o BNDV responde UNAUTHENTICATED (ou 401), que é sessão caída, não erro da API
    const b = j?.data?.vehicles_in_stock_web_app;
    if (!b && (resp.status === 401 || /UNAUTHENTICATED|token is invalid/i.test(JSON.stringify(j?.errors ?? j)))) return { sessao: true, itens: [], total: 0 };
    if (!b) return { erro: `${resp.status} ${JSON.stringify(j).slice(0, 200)}`, itens: [], total: 0 };
    total = b.paginationOut?.totalRows ?? total;
    itens.push(...b.items);
    if (itens.length >= total || !b.items.length) break;
  }
  return { erro: null, itens, total };
}, EMPRESA);

if (r.sessao) { console.error("A sessão do BNDV caiu: o token venceu. Entre no BNDV na janela do Chrome do agente e rode de novo."); process.exit(2); }
if (r.erro) { console.error("A API do BNDV recusou:", r.erro); process.exit(2); }
if (!r.itens.length || r.itens.length !== r.total) { console.error(`Leitura incompleta: ${r.itens.length} de ${r.total}. Nada gravado.`); process.exit(1); }

const esc = (c) => `"${String(c ?? "").replace(/"/g, "")}"`;
const linha = (v) => [v.idVehicle, v.brand?.name, v.model?.name, v.version?.name, `${v.yearFabrication}/${v.yearModel}`, v.km, v.color,
  v.transmission?.name, v.fuel?.name, v.price, v.consigned ? "consignado" : (v.vehicleStatus?.name || ""), v.inTraffic ? "sim" : "nao", v.plate,
  (v.images || []).length].map(esc).join(",");
fs.writeFileSync(SAIDA, ["id,marca,modelo,versao,ano,km,cor,cambio,combustivel,preco,situacao,em_circulacao,placa,fotos", ...r.itens.map(linha)].join("\n") + "\n");
console.log(`PP GARAGE 37 no BNDV: ${r.itens.length} veículos lidos em ${SAIDA}`);

/* laudo cautelar: o BNDV não guarda. Vem da planilha da loja no Drive (coluna OBSERVAÇÕES), se este Chrome estiver
   logado numa conta Google com acesso a ela. Sem acesso, segue sem: o importador usa o laudo do cadastro anterior. */
const PLANILHA = "1mdZuypS1hqQ-Y4J2HjQdShwrrAnBetQdmxeuS2IGa5M", ABA = "934980237";
try {
  const folha = await ctx.newPage();
  await folha.goto(`https://docs.google.com/spreadsheets/d/${PLANILHA}/edit?gid=${ABA}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const laudos = /docs\.google\.com\/spreadsheets/.test(folha.url()) ? await folha.evaluate(async ([id, aba]) => {
    const t = await (await fetch(`/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${aba}&headers=0`)).text();
    if (/^\s*</.test(t)) return null;
    const linhas = []; let row = [], f = "", q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f); linhas.push(row); row = []; f = ""; } else if (c !== "\r") f += c;
    }
    if (f || row.length) { row.push(f); linhas.push(row); }
    const m = {};
    for (const l of linhas) { const c = l.map((x) => x.trim()); if (c[0] && /^\d{1,4}\/\d{1,4}$/.test(c[1] || "") && c[3]) m[c[3].toUpperCase().replace(/-/g, "")] = (c[5] || "").toUpperCase(); }
    return m;
  }, [PLANILHA, ABA]) : null;
  await folha.close();
  if (laudos && Object.keys(laudos).length) {
    fs.writeFileSync(`${SAIDA}.laudos.json`, JSON.stringify(laudos));
    console.log(`Laudos da planilha da loja: ${Object.keys(laudos).length} placas`);
  } else console.log("Planilha da loja sem acesso neste Chrome: laudo só do cadastro anterior.");
} catch (e) { console.log("Planilha da loja não abriu:", String(e).slice(0, 120)); }
process.exit(0);
