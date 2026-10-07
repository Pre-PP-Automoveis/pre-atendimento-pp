import { assertEquals } from "jsr:@std/assert@1";
import { semAvisoRepetido } from "./conversa.ts";

Deno.test("tira a frase em que o robô se anuncia, mantém o cumprimento", () => {
  assertEquals(semAvisoRepetido("Boa noite! Este atendimento é automático. Sim, o Cobalt está disponível.", "o cobalt ainda tá aí?"),
    "Sim, o Cobalt está disponível.");
  assertEquals(semAvisoRepetido("Atendimento automático da Pedro Paulo Automóveis, boa tarde. Sim, o Up está disponível.", "ainda disponível?"),
    "Sim, o Up está disponível.");
});

Deno.test("mantém quando o cliente perguntou se é robô", () => {
  const t = "Sim, este é o atendimento automático da Pedro Paulo Automóveis. Qual carro você viu?";
  assertEquals(semAvisoRepetido(t, "isso é robô?"), t);
});

Deno.test("marcação de áudio não conta como pergunta sobre robô", () => {
  assertEquals(semAvisoRepetido("Oi! Esse é o atendimento automático da Pedro Paulo Automóveis. Não consigo ouvir áudio, pode escrever?", "[a pessoa mandou um áudio, que você não consegue ouvir]"),
    "Não consigo ouvir áudio, pode escrever?");
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
    "Não consigo ouvir áudio, pode escrever o que procura?");
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

import { polir, semPerguntaRepetida, semPromessaAntesDaHora } from "./conversa.ts";
Deno.test("abertura feita e 'até já' saem; nome sozinho depois de 'Perfeito' cai junto", () => {
  assertEquals(semFrasesFeitas("Show, Marcos, já passei seus dados para o consultor. Até já!"), "Marcos, já passei seus dados para o consultor.");
  assertEquals(semFrasesFeitas("Perfeito, Carla. Um consultor continua com você por aqui em instantes."), "Um consultor continua com você por aqui em instantes.");
  assertEquals(semFrasesFeitas("A CR-V o consultor apresenta pessoalmente. Quer que eu já encaminhe para ele te passar os detalhes?"), "A CR-V o consultor apresenta pessoalmente.");
});

Deno.test("promessa de consultor sai quando ninguém foi chamado, fica na despedida", () => {
  const t = "Em instantes um consultor pode continuar por aqui. Temos sim, um Fusion 2013 por R$ 71.900.";
  assertEquals(semPromessaAntesDaHora(t, false), "Temos sim, um Fusion 2013 por R$ 71.900.");
  assertEquals(semPromessaAntesDaHora("Um consultor continua com você por aqui em instantes.", true), "Um consultor continua com você por aqui em instantes.");
});

Deno.test("pergunta de pagamento sem resposta não volta na mensagem seguinte", () => {
  const h = [{ autor: "lead", texto: "qual o valor?" }, { autor: "robo", texto: "É R$ 46.900. Você pensa em pagar à vista ou financiar?" }, { autor: "lead", texto: "quantos km ele tem?" }];
  assertEquals(semPerguntaRepetida("A ficha não traz o km, o consultor confirma. Você chegou a pensar em financiamento ou à vista?", h), "A ficha não traz o km, o consultor confirma.");
  assertEquals(polir("Tenho sim - por R$ 46.900.", [], false), "Tenho sim, por R$ 46.900.");
});

Deno.test("'posso te ajudar com mais' sai mesmo no meio da frase, e o 'show' do fim também", () => {
  assertEquals(semFrasesFeitas("Isso o consultor te confirma. Fora isso, posso te ajudar com mais alguma dúvida sobre o Ka?"), "Isso o consultor te confirma.");
  assertEquals(semFrasesFeitas("Gol 2012 com 150 mil km, show. Você pensa em financiar?"), "Gol 2012 com 150 mil km. Você pensa em financiar?");
});

Deno.test("nome composto sozinho depois de abertura cai; 'Combinado' fica, porque é resposta natural a horário", () => {
  assertEquals(semFrasesFeitas("Perfeito, Ana Paula. Um consultor continua por aqui segunda às 08:00."), "Um consultor continua por aqui segunda às 08:00.");
  assertEquals(semFrasesFeitas("Combinado, Juliana! Um consultor confirma o horário."), "Combinado, Juliana! Um consultor confirma o horário.");
});

Deno.test("pedir licença para colocar em contato sai", () => {
  assertEquals(semFrasesFeitas("O preço desse Fit o consultor passa certinho. Posso te colocar em contato com ele agora?"), "O preço desse Fit o consultor passa certinho.");
  assertEquals(semFrasesFeitas("Esse Fit o consultor apresenta. Posso te ajudar com outras dúvidas enquanto isso?"), "Esse Fit o consultor apresenta.");
});

Deno.test("aviso cortado não deixa a frase começando com 'E'", () => {
  assertEquals(semAvisoRepetido("Oi! Esse é o atendimento automático da Pedro Paulo Automóveis e infelizmente eu não consigo ouvir áudio. Pode escrever?", "[a pessoa mandou um áudio, que você não consegue ouvir]"),
    "Infelizmente eu não consigo ouvir áudio. Pode escrever?");
});

Deno.test("robô comentando o aviso: a frase sai, ou fica só o que vem depois dos dois-pontos", () => {
  assertEquals(semAvisoRepetido("Boa tarde, Gustavo! Esse aviso aqui é automático, já te explico. Temos o Onix 2015 por R$ 49.900.", "vi o onix"),
    "Temos o Onix 2015 por R$ 49.900.");
  assertEquals(semAvisoRepetido("Boa tarde, Gustavo! Esse aviso é do atendimento automático, mas já te adianto: temos o Onix 2015 por R$ 49.900.", "vi o onix"),
    "Temos o Onix 2015 por R$ 49.900.");
});

Deno.test("opinião sobre o modelo sai", () => {
  assertEquals(semFrasesFeitas("Consumo certinho quem te passa é o consultor, mas o Onix costuma ser bem econômico no dia a dia. Quer ver de perto?"),
    "Consumo certinho quem te passa é o consultor. Quer ver de perto?");
});

import { abertura } from "./conversa.ts";
Deno.test("abertura de consultoria com nome, que cumpre o item 8.5 do contrato", () => {
  const t = abertura({ loja: "Pedro Paulo Automóveis", assistente: "Bia", nomeDoLead: "marcos vinicius", quando: new Date("2026-10-07T10:00:00-03:00") });
  assertEquals(t.startsWith("Bom dia, Marcos! Sou a Bia, assistente virtual da Pedro Paulo Automóveis. Vou iniciar o seu atendimento e fazer uma triagem"), true);
  assertEquals(/assistente virtual/.test(t) && /dados ficam só com a loja/.test(t) && /falar direto com um consultor/.test(t), true); // 8.5: automatizado, dados, pessoa
  assertEquals(abertura({ loja: "PP", nomeDoLead: "AUTO PEÇAS 123", quando: new Date("2026-10-07T20:00:00-03:00") }).startsWith("Boa noite! Sou a assistente virtual da PP."), true);
});

Deno.test("primeira resposta sem segundo cumprimento nem segunda apresentação", () => {
  assertEquals(semAvisoRepetido("Boa tarde, Gustavo! Sou a Bia, assistente virtual da loja. O Onix 2015 está por R$ 49.900.", "vi o onix"), "O Onix 2015 está por R$ 49.900.");
  assertEquals(semAvisoRepetido("Sou a Bia, assistente virtual da loja, e um consultor assume quando você quiser.", "é robô?"),
    "Sou a Bia, assistente virtual da loja, e um consultor assume quando você quiser.");
});
