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
Deno.test("abertura de consultoria com nome, sem falar em robô", () => {
  const t = abertura({ loja: "Pedro Paulo Automóveis", assistente: "Bia", nomeDoLead: "marcos vinicius", quando: new Date("2026-10-07T10:00:00-03:00") });
  assertEquals(t, "Bom dia, Marcos! Sou a Bia, assistente da Pedro Paulo Automóveis, e vou iniciar o seu atendimento para encontrar o carro ideal para você. Se preferir falar direto com um consultor, é só me avisar.");
  assertEquals(/virtual|rob[oô]|autom[aá]tic/.test(t), false);
  assertEquals(abertura({ loja: "PP", nomeDoLead: "AUTO PEÇAS 123", quando: new Date("2026-10-07T20:00:00-03:00") }).startsWith("Boa noite! Sou a assistente da PP, e vou"), true);
});

Deno.test("primeira resposta sem segundo cumprimento nem segunda apresentação", () => {
  assertEquals(semAvisoRepetido("Boa tarde, Gustavo! Sou a Bia, assistente da loja. O Onix 2015 está por R$ 49.900.", "vi o onix"), "O Onix 2015 está por R$ 49.900.");
  assertEquals(semAvisoRepetido("Sou a Bia, faço a triagem inicial de forma automática. Quer que um consultor assuma agora?", "é robô?"),
    "Sou a Bia, faço a triagem inicial de forma automática. Quer que um consultor assuma agora?");
});

import { semMencaoDeRobo } from "./conversa.ts";
Deno.test("robô e automático só aparecem quando o cliente pergunta, e aí a resposta não nega", () => {
  const h = (t: string) => [{ autor: "lead", texto: t }];
  assertEquals(semMencaoDeRobo("Sou um robô, mas o consultor confirma isso. Quer passar na loja?", h("tem multimídia?")), "Quer passar na loja?");
  const honesta = "Eu faço a triagem inicial de forma automática. Se preferir, passo agora para um consultor.";
  assertEquals(semMencaoDeRobo(honesta, h("vc é robô?")), honesta);
});

import { despedidaPadrao, ondeContinua } from "./conversa.ts";
Deno.test("com número da Bia separado, a despedida manda o cliente esperar o WhatsApp da loja", () => {
  const onde = ondeContinua("(11) 96606-3690");
  assertEquals(onde, "pelo WhatsApp da loja, (11) 96606-3690");
  assertEquals(despedidaPadrao({ ok: true, vendedor: null, onde }), "Anotei tudo. Um consultor continua a conversa com você pelo WhatsApp da loja, (11) 96606-3690, em instantes.");
  assertEquals(despedidaPadrao({ ok: true, vendedor: null }), "Anotei tudo. Um consultor continua a conversa com você por aqui mesmo, em instantes.");
});

import { semCorNaoPedida, semFrasesFeitas as polimento, semNomeRepetido } from "./conversa.ts";
Deno.test("cor só aparece quando o cliente falou de cor (teste real de 21/10/2026)", () => {
  const h = (t: string) => [{ autor: "lead", texto: t }];
  assertEquals(semCorNaoPedida("Temos sim o BMW 320i 2015/2015, preta, com 143.000 km, por R$ 92.900.", h("procuro uma bmw 320i")),
    "Temos sim o BMW 320i 2015/2015, com 143.000 km, por R$ 92.900.");
  assertEquals(semCorNaoPedida("O Onix está com 118.423 km rodados, preto, e sai por R$ 49.900.", h("quantos km?")),
    "O Onix está com 118.423 km rodados e sai por R$ 49.900.");
  const pediu = "O Onix é preto, com 118.423 km.";
  assertEquals(semCorNaoPedida(pediu, h("qual a cor dele?")), pediu);
  assertEquals(semCorNaoPedida("Temos um Cruze, branco.", h("tem cruze preto?")), "Temos um Cruze, branco.");
});

Deno.test("fechamento genérico e convite de balcão saem", () => {
  assertEquals(polimento("O Onix 2015 está por R$ 49.900. Quer saber mais algum detalhe dele?"), "O Onix 2015 está por R$ 49.900.");
  assertEquals(polimento("O consultor organiza o test drive com você na loja, é só aparecer por lá: Rua Juquiá, 275."),
    "O consultor organiza o test drive com você na loja: Rua Juquiá, 275.");
  assertEquals(polimento("Quer saber mais alguma coisa sobre ele?"), "Quer saber mais alguma coisa sobre ele?");
});

Deno.test("nome da pessoa não se repete em mensagens seguidas", () => {
  const h = [{ autor: "robo", texto: "Boa tarde, Kauan! Sou a Bia." }, { autor: "lead", texto: "test drive?" }];
  assertEquals(semNomeRepetido("Dá sim, Kauan. O consultor organiza.", h, "Kauan"), "Dá sim. O consultor organiza.");
  assertEquals(semNomeRepetido("Kauan, o consultor organiza.", h, "Kauan"), "O consultor organiza.");
  const longe = [{ autor: "robo", texto: "Boa tarde, Kauan!" }, { autor: "robo", texto: "a" }, { autor: "robo", texto: "b" }];
  assertEquals(semNomeRepetido("Dá sim, Kauan.", longe, "Kauan"), "Dá sim, Kauan.");
});

Deno.test("cor solta no fim da frase e opinião sobre pagamento saem sem quebrar a frase", () => {
  const h = [{ autor: "lead", texto: "o cobalt ainda tá aí?" }];
  assertEquals(semCorNaoPedida("Ele tem 150.362 km e é na cor preta.", h), "Ele tem 150.362 km.");
  assertEquals(semCorNaoPedida("Temos o Fusion AWD 2013, cor branca, com 148.754 km.", h), "Temos o Fusion AWD 2013, com 148.754 km.");
  assertEquals(semCorNaoPedida("O Ka está por R$ 27.900. Ele é prata.", h), "O Ka está por R$ 27.900.");
  assertEquals(polimento("Pagando à vista costuma facilitar bastante a negociação. Você tem algum carro na troca?"), "Você tem algum carro na troca?");
  assertEquals(polimento("O Ka 2009 está anunciado por R$ 27.900, se quiser saber mais alguma coisa sobre ele é só falar."), "O Ka 2009 está anunciado por R$ 27.900.");
  assertEquals(polimento("A quilometragem exata não está na minha ficha, isso o consultor confirma."), "A quilometragem exata eu não tenho aqui, isso o consultor confirma.");
  const ana = [{ autor: "robo", texto: "Boa noite, Ana!" }];
  assertEquals(semNomeRepetido("Fica anotado, Ana Paula. Segunda o consultor confirma.", ana, "Ana"), "Fica anotado. Segunda o consultor confirma.");
});

Deno.test("à vista sem opinião, ficha fora da boca da Bia, convite sem 'aparecer'", () => {
  assertEquals(polimento("Pagando à vista fica mais simples de fechar negócio. Você tem carro na troca?"), "Você tem carro na troca?");
  assertEquals(polimento("O Cruze LT está sem preço informado nessa ficha, então o consultor confirma."), "O Cruze LT está sem preço informado, então o consultor confirma.");
  assertEquals(polimento("Que tal aparecer para ver o Onix de perto?"), "Que tal vir para ver o Onix de perto?");
});

Deno.test("câmbio automático não é menção a robô", () => {
  const h = [{ autor: "lead", texto: "vocês tem spin?" }];
  const t = "Temos sim, a Spin 1.8L AT ACT 2017/2018, automática, com 170.000 km, por R$ 61.900.";
  assertEquals(semMencaoDeRobo(t, h), t);
  assertEquals(semMencaoDeRobo("Este atendimento é automático. A Spin está por R$ 61.900.", h), "A Spin está por R$ 61.900.");
  assertEquals(semMencaoDeRobo("Faço a triagem de forma automática. A Spin está por R$ 61.900.", h), "A Spin está por R$ 61.900.");
});

import { polir as polirTudo } from "./conversa.ts";
Deno.test("perguntada se é robô, a oferta do consultor fica; 'posso ajudar com mais' sai", () => {
  const t = "Isso mesmo, eu faço a triagem inicial de forma automática. Se preferir, posso te passar para um consultor agora.";
  assertEquals(polirTudo(t, [{ autor: "lead", texto: "isso é robô?" }], false), t);
  assertEquals(polimento("O câmbio o consultor confirma. Posso ajudar com mais algum carro?"), "O câmbio o consultor confirma.");
});

import { aberturaCurta } from "./conversa.ts";
Deno.test("pós-venda no primeiro contato recebe abertura curta", () => {
  const t = abertura({ loja: "Pedro Paulo Automóveis", assistente: "Bia", nomeDoLead: "Jhonatan", quando: new Date("2026-10-23T10:05:00-03:00"), curta: aberturaCurta("fora_do_escopo") });
  assertEquals(t, "Bom dia, Jhonatan! Sou a Bia, assistente da Pedro Paulo Automóveis.");
  assertEquals(aberturaCurta("qualificado"), false);
});

import { semONome } from "./conversa.ts";
Deno.test("primeira resposta sem o nome que a abertura já usou", () => {
  assertEquals(semONome("Não consigo ver as fotos por aqui, Pedro. Pode me contar qual carro?", "Pedro"), "Não consigo ver as fotos por aqui. Pode me contar qual carro?");
  assertEquals(semONome("Isso é com o consultor, Jhonatan: ele continua por aqui.", "Jhonatan"), "Isso é com o consultor: ele continua por aqui.");
  assertEquals(semONome("Kauan, temos sim.", "Kauan"), "Temos sim.");
});

Deno.test("depois da primeira resposta, sem novo 'Boa tarde, Fulano!' e sem 'costumam agradar'", () => {
  const h = [{ autor: "lead", texto: "oi" }, { autor: "robo", texto: "Boa tarde, Vitor! Sou a Bia." }, { autor: "lead", texto: "boa tarde, tudo bem?" }];
  assertEquals(polirTudo("Boa tarde, Vitor! Temos dois Gol no pátio agora.", h, false, "Vitor"), "Temos dois Gol no pátio agora.");
  assertEquals(polimento("Temos o Polo. Esses carros costumam agradar quem busca economia."), "Temos o Polo.");
});

Deno.test("nome do perfil em maiúsculas também sai quando repetido", () => {
  const h = [{ autor: "robo", texto: "Boa tarde, Vitor! Sou a Bia." }, { autor: "lead", texto: "tudo bem?" }];
  assertEquals(semNomeRepetido("Tudo bem, Vitor! Temos dois Gol.", h, "VITOR DE PAULA"), "Tudo bem! Temos dois Gol.");
});

Deno.test("comentário sobre o anúncio não chega ao cliente", () => {
  assertEquals(polimento("Esse anúncio é geral da loja, não fala de um carro específico. Qual carro você procura?"), "Qual carro você procura?");
});

Deno.test("pergunta da triagem é para você, não para ele", () => {
  assertEquals(polimento("O Gol tem 89.490 km. Ele tem carro na troca ou pensa em financiar?"), "O Gol tem 89.490 km. Você tem carro na troca ou pensa em financiar?");
});

Deno.test("'Quer que eu fale mais sobre algum deles?' sai", () => {
  assertEquals(polimento("Temos o Gol 2012 por R$ 34.900. Quer que eu fale mais sobre algum deles?"), "Temos o Gol 2012 por R$ 34.900.");
});
