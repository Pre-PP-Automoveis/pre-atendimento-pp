import { assertEquals } from "jsr:@std/assert@1";
import { foneLegivel, passouDoRobo, proximoVendedor, venceuPrazo } from "./rodizio.ts";

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

Deno.test("repasse em 15 minutos sem resposta", () => {
  const c = { estado: "encaminhada", primeira_acao_humana_em: null, avisado_em: avisado };
  assertEquals(venceuPrazo(c, 15, t(14)), false);
  assertEquals(venceuPrazo(c, 15, t(15)), true);
});

Deno.test("lead fica no máximo 15 minutos com o robô", () => {
  const c = { estado: "robo", primeira_acao_humana_em: null, iniciada_em: avisado };
  assertEquals(passouDoRobo(c, 15, t(14)), false);
  assertEquals(passouDoRobo(c, 15, t(15)), true);
  assertEquals(passouDoRobo({ ...c, estado: "encaminhada" }, 15, t(30)), false);
  assertEquals(passouDoRobo({ ...c, primeira_acao_humana_em: avisado }, 15, t(30)), false);
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

import { pessoaPedida } from "./rodizio.ts";
Deno.test("quem está fora do rodízio não recebe lead automático", () => {
  const equipe = [
    { id: "keila", nome: "Keila", ativo: true, ordem: 1, ultimo_lead_em: null, no_rodizio: false },
    { id: "ryan", nome: "Ryan", ativo: true, ordem: 2, ultimo_lead_em: "2026-10-06T10:00:00Z", no_rodizio: true },
  ];
  assertEquals(proximoVendedor(equipe, [])?.id, "ryan");
});

Deno.test("lead que pede alguém pelo nome acha a pessoa, mesmo fora do rodízio e com apelido", () => {
  const equipe = ["Leo", "Ryan", "Rafa", "Pedro", "Keila"].map((nome, i) => ({ id: nome, nome, ativo: true, ordem: i, ultimo_lead_em: null, no_rodizio: nome !== "Pedro" }));
  assertEquals(pessoaPedida(equipe, "Pedro")?.id, "Pedro");
  assertEquals(pessoaPedida(equipe, "Rafael")?.id, "Rafa");
  assertEquals(pessoaPedida(equipe, "Leonardo")?.id, "Leo");
  assertEquals(pessoaPedida(equipe, "nenhum"), null);
  assertEquals(pessoaPedida(equipe, "Marcos"), null);
});
