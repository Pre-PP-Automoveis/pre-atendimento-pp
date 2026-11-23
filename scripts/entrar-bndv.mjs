// Refaz o login do BNDV no Chrome do agente, para a rotina das 9h não parar quando a sessão cai.
// As credenciais vêm de BNDV_CNPJ, BNDV_EMAIL e BNDV_SENHA, que a rotina lê do app Chaves do macOS (serviço
// pre-atendimento-pp-bndv), onde o próprio Kauan guardou: nada fica em arquivo nem passa pelo Claude.
// Mesma tela do next-cerebro/clientes/pp-automoveis/bndv/login.mjs (CNPJ, login e senha).
import { createRequire } from "node:module";

const { chromium } = createRequire(`${process.env.PW_DIR}/`)("playwright-core");
const { BNDV_CNPJ: cnpj, BNDV_EMAIL: email, BNDV_SENHA: senha } = process.env;
if (!cnpj || !email || !senha) { console.error("sem credenciais do BNDV no Chaves"); process.exit(1); }

const nav = await chromium.connectOverCDP(`http://localhost:${process.env.CDP_PORT || "9223"}`, { timeout: 20000 });
const ctx = nav.contexts()[0];
const pag = ctx.pages().find((p) => p.url().includes("bndv.com.br")) || await ctx.newPage();
// O BNDV troca de página no meio do login: toda leitura da tela tolera a navegação e tenta de novo.
const seguro = async (fn) => { try { return await fn(); } catch { return null; } };
const temSenhaNaTela = () => seguro(() => pag.locator("input[type=password]:visible").count());
const temToken = () => seguro(() => pag.evaluate(() => !!localStorage.getItem("access_token")));

// Só é chamado quando a sessão caiu: apaga o token velho (vencido) para o BNDV não achar que ainda está logado.
await pag.goto("https://app.bndv.com.br/login", { waitUntil: "domcontentloaded" });
await seguro(() => pag.evaluate(() => localStorage.removeItem("access_token")));
await pag.goto("https://app.bndv.com.br/login", { waitUntil: "domcontentloaded" });
await pag.waitForTimeout(2500);
await pag.locator("input[name=txtCnpj]").fill(cnpj);
await pag.locator("input[name=txtUser]").fill(email);
await pag.locator("input[name=txtPassword]").fill(senha);
const botao = pag.getByRole("button", { name: /Entrar no Sistema/i });
if (await botao.count()) await botao.first().click(); else await pag.locator("input[name=txtPassword]").press("Enter");
for (let i = 0; i < 30; i++) {
  await pag.waitForTimeout(1000);
  if ((await temSenhaNaTela()) === 0 && (await temToken())) { console.log("logado no BNDV"); process.exit(0); }
}
console.error("o login do BNDV não passou (senha trocada?)");
process.exit(1);
