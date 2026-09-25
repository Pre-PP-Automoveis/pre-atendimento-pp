import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { contextoTurno, promptSistema, situacaoHorario, agoraSP, type Loja } from "./prompt.ts";

/* horário de funcionamento da Pedro Paulo, o mesmo da migração 20260924220000_loja_pp.sql */
const H: Loja["horario"] = { seg: ["08:00", "18:00"], ter: ["08:00", "18:00"], qua: ["08:00", "18:00"], qui: ["08:00", "18:00"], sex: ["08:00", "18:00"], sab: ["08:00", "17:00"], dom: null };
const sp = (iso: string) => new Date(`${iso}-03:00`);

Deno.test("aberta no meio da tarde de quarta", () => {
  assertEquals(situacaoHorario(H, sp("2026-09-23T15:00:00")), { aberta: true, texto: "loja aberta até 18:00" });
});

Deno.test("madrugada de terça: abre hoje", () => {
  assertEquals(situacaoHorario(H, sp("2026-09-22T03:00:00")).texto, "loja fechada; abre hoje às 08:00");
});

Deno.test("sábado fecha às 17h e pula o domingo fechado", () => {
  assertEquals(situacaoHorario(H, sp("2026-09-26T16:59:00")).aberta, true);
  assertEquals(situacaoHorario(H, sp("2026-09-26T17:30:00")).texto, "loja fechada; abre segunda às 08:00");
});

Deno.test("sexta depois das 18h: abre amanhã, no sábado", () => {
  assertEquals(situacaoHorario(H, sp("2026-09-25T19:00:00")).texto, "loja fechada; abre amanhã às 08:00");
});

Deno.test("fuso de São Paulo, não UTC", () => {
  /* 02:00 UTC de quinta ainda é 23:00 de quarta em SP */
  assertEquals(agoraSP(new Date("2026-09-24T02:00:00Z")).dia, "qua");
});

Deno.test("sem ficha, o sistema proíbe confirmar qualquer dado de carro", () => {
  const p = promptSistema({ id: "x", nome: "Pedro Paulo Automóveis", voz: "", endereco: "", horario: H }, []);
  assertStringIncludes(p, "ainda não enviou as fichas");
  assert(!p.includes("—"), "o prompt não pode ter travessão, senão o modelo imita");
});

Deno.test("carro do link sem ficha vem marcado como não confirmável", () => {
  const c = contextoTurno({ agora: agoraSP(), horario: "loja aberta", canal: "WebMotors", veiculoAnuncio: "Volkswagen Up 2014/2015", ficha: null, primeiroTurno: true });
  assertStringIncludes(c, "sem ficha cadastrada");
  assertStringIncludes(c, "primeira resposta");
});
