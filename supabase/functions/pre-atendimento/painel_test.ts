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

import { equipeDoPainel } from "./painel.ts";
Deno.test("lead passado pelo gerente volta para a vez do novo dono até alguém escrever de novo", () => {
  const passado = { ...base, id: "f", estado: "encaminhada", vendedor_id: "paulo", tentativas: ["rafa", "paulo"], avisado_em: em(1), encaminhado_em: em(30),
    primeira_acao_humana_em: em(25), ultima_acao_humana_em: em(25), transferido_em: em(1), fixado_por: "gerente" };
  const p = painelConsultor([passado], "paulo", vend, 15, agora);
  assertEquals(p.sua_vez.map((l) => l.id), ["f"]);
  assertEquals(p.sua_vez[0].minutos_para_repasse, null); // dono fixo não repassa sozinho
  const respondido = { ...passado, ultima_acao_humana_em: em(0) };
  assertEquals(painelConsultor([respondido], "paulo", vend, 15, agora).sua_vez.length, 0);
  assertEquals(painelConsultor([respondido], "paulo", vend, 15, agora).atendidos.map((l) => l.id), ["f"]);
});

Deno.test("equipe do gerente mostra o próximo da vez e quem está fora do rodízio", () => {
  const equipe = [
    { id: "rafa", nome: "Rafael", ativo: true, ordem: 1, ultimo_lead_em: em(5), no_rodizio: true },
    { id: "paulo", nome: "Paulo", ativo: true, ordem: 2, ultimo_lead_em: em(50), no_rodizio: true },
    { id: "keila", nome: "Keila", ativo: true, ordem: 3, ultimo_lead_em: null, no_rodizio: false },
  ];
  const e = equipeDoPainel(equipe, conversas);
  assertEquals(e.map((x) => [x.id, x.proximo, x.no_rodizio, x.esperando]), [["rafa", false, true, 2], ["paulo", true, true, 1], ["keila", false, false, 0]]);
});

import { painelAdmin } from "./painel.ts";
Deno.test("admin vê saúde, números do dia e da semana, custo por conversa e erros das últimas 24h", () => {
  const msgs = [
    { conversa_id: "a", autor: "lead", custo_usd: null }, { conversa_id: "a", autor: "robo", custo_usd: 0.012 },
    { conversa_id: "d", autor: "robo", custo_usd: 0.03 }, { conversa_id: "d", autor: "vendedor", custo_usd: null },
  ];
  const conversasComMotivo = conversas.map((c) => ({ ...c, resumo: { ...c.resumo, motivo: c.id === "e" ? undefined : "qualificado" } }));
  const a = painelAdmin({
    conversas: conversasComMotivo, mensagens: msgs, vendedores: vend, lojaAtiva: false, inicioDoDia: em(35), agora,
    erros: [{ onde: "claude", vezes: 3, ultimo_em: em(60) }, { onde: "fila", vezes: 9, ultimo_em: em(60 * 30) }],
    saude: [{ chave: "cron", em: em(2) }],
  });
  assertEquals([a.saude.minutos_desde_cron, a.saude.minutos_desde_webhook, a.saude.erros_24h], [2, null, 3]);
  assertEquals([a.semana.conversas, a.semana.atendidas, a.semana.sem_resposta, a.semana.repasses, a.semana.custo_usd], [5, 1, 3, 1, 0.042]);
  assertEquals(a.hoje.conversas, 5);
  assertEquals(a.semana.motivos, { qualificado: 4 });
  assertEquals(a.conversas.find((c) => c.id === "d")!.falas, { lead: 0, robo: 1, time: 1 });
});
