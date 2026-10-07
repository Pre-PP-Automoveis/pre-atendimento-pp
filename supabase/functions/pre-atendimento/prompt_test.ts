import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { contextoTurno, promptSistema, situacaoHorario, agoraSP, type Loja } from "./prompt.ts";

/* horário de funcionamento da Pedro Paulo, o mesmo da migração 20260924220000_loja_pp.sql */
const H: Loja["horario"] = { seg: ["08:00", "18:00"], ter: ["08:00", "18:00"], qua: ["08:00", "18:00"], qui: ["08:00", "18:00"], sex: ["08:00", "18:00"], sab: ["08:00", "17:00"], dom: null };
const sp = (iso: string) => new Date(`${iso}-03:00`);

Deno.test("aberta no meio da tarde de quarta", () => {
  assertEquals(situacaoHorario(H, sp("2026-09-23T15:00:00")), { aberta: true, abre: null, texto: "loja aberta até 18:00" });
});

Deno.test("madrugada de terça: abre hoje", () => {
  assertEquals(situacaoHorario(H, sp("2026-09-22T03:00:00")).texto, "loja fechada; abre hoje às 08:00");
});

Deno.test("sábado fecha às 17h e pula o domingo fechado", () => {
  assertEquals(situacaoHorario(H, sp("2026-09-26T16:59:00")).aberta, true);
  assertEquals(situacaoHorario(H, sp("2026-09-26T17:30:00")).abre, "segunda às 08:00");
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

import { notaDeCor } from "./prompt.ts";
Deno.test("cliente cita cor: a nota traz a cor de cada carro do modelo citado, pela ficha", () => {
  const v = (id: string, titulo: string, observacoes: string, laudo = "APROVADO") =>
    ({ id, titulo, observacoes, laudo_cautelar: laudo, disponivel: true, preco: null, km: null, leilao: null, unico_dono: null, anuncios: {} });
  const estoque = [v("1", "Chevrolet CRUZE LT NB 2012/2013 flex", "cor preta"), v("2", "Chevrolet CRUZE LTZ HB 2013/2014 flex", "cor branca"),
    v("3", "Chevrolet ONIX 1.4MT LT 2014/2015 flex", "cor preta"), v("4", "Honda CR-V EXL 2013", "cor prata", "REPROVADO")];
  const nota = notaDeCor([{ autor: "lead", texto: "qual o valor do cruze preto?" }], estoque)!;
  assertEquals(nota.includes("CRUZE LT NB 2012/2013 flex (preta)") && nota.includes("CRUZE LTZ HB 2013/2014 flex (branca)"), true);
  assertEquals(nota.includes("ONIX"), false);
  assertEquals(notaDeCor([{ autor: "lead", texto: "qual o valor do cruze?" }], estoque), null);
  assertEquals(notaDeCor([{ autor: "lead", texto: "tem CR-V prata?" }], estoque), null); // carro reprovado não entra
});

Deno.test("nota de cor separa o carro da cor pedida dos de outra cor", () => {
  const v = (id: string, titulo: string, observacoes: string) =>
    ({ id, titulo, observacoes, laudo_cautelar: "APROVADO", disponivel: true, preco: null, km: null, leilao: null, unico_dono: null, anuncios: {} });
  const nota = notaDeCor([{ autor: "lead", texto: "qual o valor do cruze preto?" }],
    [v("1", "Chevrolet CRUZE LT NB 2012/2013 flex", "cor preta"), v("2", "Chevrolet CRUZE LTZ HB 2013/2014 flex", "cor branca")])!;
  assertEquals(nota.includes("dessa cor só existe: Chevrolet CRUZE LT NB 2012/2013 flex (preta)"), true);
  assertEquals(nota.includes("De outra cor: Chevrolet CRUZE LTZ HB 2013/2014 flex (branca)"), true);
});
