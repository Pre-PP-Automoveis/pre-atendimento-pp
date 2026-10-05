import { assertEquals } from "jsr:@std/assert@1";
import { painelConsultor, painelGerente } from "./painel.ts";

const agora = new Date("2026-10-05T15:00:00-03:00").getTime();
const em = (minAtras: number) => new Date(agora - minAtras * 60_000).toISOString();
const vend = new Map([["rafa", "Rafael"], ["paulo", "Paulo"]]);
const base = { lead_wa: "5511987654321", origem: "WebMotors", resumo: { veiculo: "Up 2017" }, iniciada_em: em(30), escalado_em: null };
const conversas = [
  { ...base, id: "a", estado: "encaminhada", vendedor_id: "rafa", tentativas: ["rafa"], avisado_em: em(4), encaminhado_em: em(4), primeira_acao_humana_em: null },
  { ...base, id: "b", estado: "encaminhada", vendedor_id: "rafa", tentativas: ["rafa"], avisado_em: em(12), encaminhado_em: em(12), primeira_acao_humana_em: null },
  { ...base, id: "c", estado: "encaminhada", vendedor_id: "paulo", tentativas: ["rafa", "paulo"], avisado_em: em(2), encaminhado_em: em(20), primeira_acao_humana_em: null },
  { ...base, id: "d", estado: "encaminhada", vendedor_id: "rafa", tentativas: ["rafa"], avisado_em: em(40), encaminhado_em: em(40), primeira_acao_humana_em: em(35) },
  { ...base, id: "e", estado: "robo", vendedor_id: null, tentativas: [], avisado_em: null, encaminhado_em: null, primeira_acao_humana_em: null },
];

Deno.test("consultor vê a vez dele em ordem de espera, com o tempo até o repasse", () => {
  const p = painelConsultor(conversas, "rafa", vend, 15, agora);
  assertEquals(p.sua_vez.map((l) => l.id), ["b", "a"]);
  assertEquals(p.sua_vez[0].minutos_esperando, 12);
  assertEquals(p.sua_vez[0].minutos_para_repasse, 3);
  assertEquals(p.atendidos.map((l) => l.id), ["d"]);
  assertEquals(p.passaram.map((l) => l.id), ["c"]);
  assertEquals(p.sua_vez[0].whatsapp_link, "https://wa.me/5511987654321");
});

Deno.test("gerente vê sem resposta com o nome de quem está com o lead, e o placar", () => {
  const g = painelGerente(conversas, vend, 15, agora);
  assertEquals(g.sem_resposta.map((l) => [l.id, l.consultor]), [["b", "Rafael"], ["a", "Rafael"], ["c", "Paulo"]]);
  assertEquals(g.com_robo.map((l) => l.id), ["e"]);
  const rafa = g.placar.find((p) => p.consultor === "Rafael")!;
  assertEquals([rafa.recebidos, rafa.atendidos, rafa.passaram_adiante, rafa.minutos_ate_responder], [4, 1, 1, 5]);
});
