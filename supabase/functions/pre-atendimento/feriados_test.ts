import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { feriadoEm, fechadoNoDia } from "./feriados.ts";
import { situacaoHorario, type Loja } from "./prompt.ts";

const H: Loja["horario"] = { seg: ["08:00", "18:00"], ter: ["08:00", "18:00"], qua: ["08:00", "18:00"], qui: ["08:00", "18:00"], sex: ["08:00", "18:00"], sab: ["08:00", "17:00"], dom: null };
const sp = (iso: string) => new Date(`${iso}-03:00`);
const PP = { calendario: "br-sp-santo-andre" };

Deno.test("os 10 feriados nacionais de 2026 (Portaria MGI 11.460/2025)", () => {
  const datas = ["2026-01-01", "2026-04-03", "2026-04-21", "2026-05-01", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25"];
  for (const d of datas) assertEquals(typeof feriadoEm(d), "string", d);
  assertEquals(feriadoEm("2026-04-03"), "Sexta-feira Santa");
  assertEquals(feriadoEm("2027-03-26"), "Sexta-feira Santa");
});

Deno.test("ponto facultativo não fecha a loja: Carnaval e Corpus Christi", () => {
  assertEquals(feriadoEm("2026-02-17", PP.calendario), null);
  assertEquals(feriadoEm("2026-06-04", PP.calendario), null);
  assertEquals(feriadoEm("2026-12-24", PP.calendario), null);
});

Deno.test("9 de julho só em SP e 8 de abril só em Santo André", () => {
  assertEquals(feriadoEm("2026-07-09"), null);
  assertEquals(feriadoEm("2026-07-09", "br-sp"), "Revolução Constitucionalista");
  assertEquals(feriadoEm("2026-04-08", "br-sp"), null);
  assertEquals(feriadoEm("2026-04-08", PP.calendario), "aniversário de Santo André");
});

Deno.test("exceções da loja: abrir num feriado, fechar num dia comum", () => {
  assertEquals(fechadoNoDia("2026-11-20", { ...PP, dias_abertos: ["2026-11-20"] }), null);
  assertEquals(fechadoNoDia("2026-02-17", { ...PP, dias_fechados: ["2026-02-17"] }), "a loja não abre");
});

Deno.test("Finados de 2026: a loja não abre, volta na terça", () => {
  const s = situacaoHorario(H, sp("2026-11-02T10:00:00"), PP);
  assertEquals(s.aberta, false);
  assertEquals(s.abre, "amanhã às 08:00");
  assertStringIncludes(s.texto, "hoje é feriado (Finados) e a loja não abre");
});

Deno.test("quinta à noite antes da Consciência Negra: abre no sábado e avisa a sexta", () => {
  const s = situacaoHorario(H, sp("2026-11-19T19:00:00"), PP);
  assertEquals(s.abre, "sábado às 08:00");
  assertStringIncludes(s.texto, "sexta, 20/11, a loja não abre (Consciência Negra)");
});

Deno.test("dia comum com feriado na semana: aberta, com o aviso do feriado", () => {
  const s = situacaoHorario(H, sp("2026-11-17T10:00:00"), PP);
  assertEquals(s.aberta, true);
  assertEquals(s.texto, "loja aberta até 18:00; sexta, 20/11, a loja não abre (Consciência Negra)");
});

Deno.test("feriado no domingo não vira aviso: a loja já não abre no domingo", () => {
  /* 15/11/2026 é domingo */
  assertEquals(situacaoHorario(H, sp("2026-11-12T10:00:00"), PP).texto, "loja aberta até 18:00");
});

Deno.test("Natal e Ano-Novo seguidos de fim de semana", () => {
  /* 25/12/2026 é sexta: quinta às 19h a loja só volta no sábado */
  assertEquals(situacaoHorario(H, sp("2026-12-24T19:00:00"), PP).abre, "sábado às 08:00");
});
