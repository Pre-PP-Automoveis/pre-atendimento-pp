import { assertEquals } from "jsr:@std/assert@1";
import { semAvisoRepetido } from "./conversa.ts";

Deno.test("tira a frase em que o robô se anuncia, mantém o cumprimento", () => {
  assertEquals(semAvisoRepetido("Boa noite! Este atendimento é automático. Sim, o Cobalt está disponível.", "o cobalt ainda tá aí?"),
    "Boa noite! Sim, o Cobalt está disponível.");
  assertEquals(semAvisoRepetido("Atendimento automático da Pedro Paulo Automóveis, boa tarde. Sim, o Up está disponível.", "ainda disponível?"),
    "Sim, o Up está disponível.");
});

Deno.test("mantém quando o cliente perguntou se é robô", () => {
  const t = "Sim, este é o atendimento automático da Pedro Paulo Automóveis. Qual carro você viu?";
  assertEquals(semAvisoRepetido(t, "isso é robô?"), t);
});

Deno.test("marcação de áudio não conta como pergunta sobre robô", () => {
  assertEquals(semAvisoRepetido("Oi! Esse é o atendimento automático da Pedro Paulo Automóveis. Não consigo ouvir áudio, pode escrever?", "[a pessoa mandou um áudio, que você não consegue ouvir]"),
    "Oi! Não consigo ouvir áudio, pode escrever?");
});

import { semTravessao } from "./conversa.ts";
Deno.test("hífen solto vira vírgula, hífen de palavra fica", () => {
  assertEquals(semTravessao("R$ 52.900 - pretende financiar?"), "R$ 52.900, pretende financiar?");
  assertEquals(semTravessao("CR-V e T-Cross"), "CR-V e T-Cross");
});

import { notasDaConversa, semFrasesFeitas, visitaReal } from "./conversa.ts";
const END = "Rua Juquiá, 275, Paraíso, Santo André";
Deno.test("pergunta sem resposta vira nota para não insistir", () => {
  const h = [{ autor: "lead", texto: "vi o onix" }, { autor: "robo", texto: "Temos o Onix 2015. Você tem carro na troca?" }, { autor: "lead", texto: "tem multimídia?" }];
  const n = notasDaConversa(h, END, null);
  assertEquals(n.some((x) => x.includes("carro na troca") && x.includes("não respondeu")), true);
});
Deno.test("o que a pessoa já disse vira nota, endereço enviado e nome usado também", () => {
  const h = [{ autor: "lead", texto: "vou à vista" }, { autor: "robo", texto: "Boa, Carla. Quer passar na loja? É na Rua Juquiá, 275." }, { autor: "lead", texto: "ok" }];
  const n = notasDaConversa(h, END, "Carla");
  assertEquals(n.some((x) => x.includes("forma de pagamento") && x.includes("já falou")), true);
  assertEquals(n.some((x) => x.includes("endereço já foi enviado")), true);
  assertEquals(n.some((x) => x.includes("nome Carla")), true);
});
Deno.test("resumo não diz convidado sem endereço enviado", () => {
  assertEquals(visitaReal("convidado, sem resposta", [{ autor: "robo", texto: "Tem troca?" }], END), "não convidado");
  assertEquals(visitaReal("convidado, sem resposta", [{ autor: "robo", texto: "É na Rua Juquiá, 275." }], END), "convidado, sem resposta");
});
Deno.test("frase-padrão sai", () => {
  assertEquals(semFrasesFeitas("O Ka está por R$ 27.900. Posso te ajudar com mais alguma coisa sobre ele?"), "O Ka está por R$ 27.900.");
});

import { exigirConvite } from "./conversa.ts";
Deno.test("filtro do aviso tira só o trecho e mantém o resto da frase", () => {
  assertEquals(semAvisoRepetido("Oi! Este atendimento é automático e não consigo ouvir áudio, pode escrever o que procura?", "[a pessoa mandou um áudio, que você não consegue ouvir]"),
    "Oi! Não consigo ouvir áudio, pode escrever o que procura?");
});
Deno.test("lead qualificado sem convite volta para o robô convidar", () => {
  const e = { motivo: "qualificado", veiculo: "Ka", troca: "não tem", pagamento: "à vista", visita: "não convidado", pendencias: "nenhuma", resumo: "" };
  assertEquals(typeof exigirConvite([{ autor: "robo", texto: "Tem troca?" }], END)(e), "string");
  assertEquals(exigirConvite([{ autor: "robo", texto: "É na Rua Juquiá, 275." }], END)(e), null);
  assertEquals(exigirConvite([], END)({ ...e, visita: "quer vir amanhã" }), null);
  assertEquals(exigirConvite([], END)({ ...e, motivo: "pediu_pessoa" }), null);
});

Deno.test("frase de bastidor não chega ao cliente", () => {
  assertEquals(semFrasesFeitas("Ótimo. Já mandei o convite com o endereço, vou aguardar a resposta da Carla antes de encaminhar."), "Ótimo.");
});

Deno.test("resto do aviso some", () => {
  assertEquals(semFrasesFeitas("Já aviso antes de começar. Esse Fit o consultor apresenta pessoalmente."), "Esse Fit o consultor apresenta pessoalmente.");
});
