import { assertEquals } from "jsr:@std/assert@1";
import { foneLegivel, proximoVendedor, venceuPrazo } from "./rodizio.ts";

const equipe = [
  { id: "paulo", ativo: true, ordem: 1, ultimo_lead_em: "2026-09-26T10:00:00Z" },
  { id: "rafael", ativo: true, ordem: 2, ultimo_lead_em: "2026-09-26T09:00:00Z" },
  { id: "rayan", ativo: true, ordem: 3, ultimo_lead_em: null },
  { id: "brendon", ativo: false, ordem: 4, ultimo_lead_em: null },
];

Deno.test("quem nunca recebeu vem primeiro, e inativo não entra", () => {
  assertEquals(proximoVendedor(equipe, [])?.id, "rayan");
});

Deno.test("repasse pula quem já foi avisado neste lead", () => {
  assertEquals(proximoVendedor(equipe, ["rayan"])?.id, "rafael");
  assertEquals(proximoVendedor(equipe, ["rayan", "rafael"])?.id, "paulo");
});

Deno.test("todos avisados: acabou o rodízio, é hora do gerente", () => {
  assertEquals(proximoVendedor(equipe, ["rayan", "rafael", "paulo"]), null);
});

const avisado = "2026-09-26T13:00:00Z";
const t = (min: number) => new Date(avisado).getTime() + min * 60_000;

Deno.test("prazo de 60 minutos, como o BNDV", () => {
  const c = { estado: "encaminhada", primeira_acao_humana_em: null, avisado_em: avisado };
  assertEquals(venceuPrazo(c, 60, t(59)), false);
  assertEquals(venceuPrazo(c, 60, t(60)), true);
});

Deno.test("alguém escreveu pelo aplicativo: não repassa", () => {
  assertEquals(venceuPrazo({ estado: "encaminhada", primeira_acao_humana_em: "2026-09-26T13:10:00Z", avisado_em: avisado }, 60, t(90)), false);
});

Deno.test("lead na fila da noite não repassa: ninguém foi avisado ainda", () => {
  assertEquals(venceuPrazo({ estado: "fila", primeira_acao_humana_em: null, avisado_em: null }, 60, t(600)), false);
});

Deno.test("telefone legível para achar a conversa", () => {
  assertEquals(foneLegivel("5511987654321"), "(11) 98765-4321");
  assertEquals(foneLegivel("551143218765"), "(11) 4321-8765");
});
