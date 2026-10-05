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
