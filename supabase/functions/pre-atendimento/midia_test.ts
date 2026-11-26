import { assertEquals } from "jsr:@std/assert@1";
import { rotuloAudio, rotuloFoto } from "./rotulos.ts";
import { linhaFicha, notaDeCor, type Veiculo } from "./prompt.ts";
import { polir, rodarTurno, semLinks } from "./conversa.ts";
import { fotosJaEnviadas, pedirFotos, rotuloFotos } from "./fotos.ts";
import { painelGerente } from "./painel.ts";

const gol: Veiculo = { id: "11111111-aaaa", titulo: "Volkswagen Gol 1.6 (G5) (Flex) 2011/2012 flex", disponivel: true, preco: 34900, km: 150000,
  leilao: null, laudo_cautelar: null, unico_dono: null, observacoes: "cor branco; câmbio manual", anuncios: { placa: "ABC1D23", bndv: "1540321" },
  fotos: ["1540321/a.jpg", "1540321/b.jpg", "1540321/c.jpg"] };
Deno.test("áudio e foto chegam para a Bia como texto rotulado", () => {
  assertEquals(rotuloAudio("  quero o gol\n branco "), "[áudio do cliente: quero o gol branco]");
  assertEquals(rotuloFoto("print de anúncio de um Gol G5 branco 2012, R$ 34.900", "esse aqui"), "[foto do cliente: print de anúncio de um Gol G5 branco 2012, R$ 34.900] legenda: esse aqui");
  assertEquals(rotuloFoto("foto de um Onix prata", null), "[foto do cliente: foto de um Onix prata]");
});

Deno.test("a ficha diz quantas fotos o carro tem, sem link nenhum", () => {
  assertEquals(linhaFicha(gol).endsWith("| fotos: 3"), true);
  /* carro sem foto diz que não tem, para a Bia não oferecer (24/11/2026) */
  assertEquals(linhaFicha({ ...gol, fotos: [] }).endsWith("| fotos: nenhuma (não ofereça foto)"), true);
  /* link antigo do BNDV não conta como foto */
  assertEquals(linhaFicha({ ...gol, fotos: ["https://cdn-sistema-lojistas.bndv.com.br/x/a.webp"] }).endsWith("fotos: nenhuma (não ofereça foto)"), true);
  assertEquals(linhaFicha(gol).includes("http"), false);
});

Deno.test("enviar_fotos manda de 8 em 8 e segue de onde parou", () => {
  const muitas: Veiculo = { ...gol, fotos: Array.from({ length: 10 }, (_, i) => `1540321/f${i}.jpg`) };
  const enviadas = new Map<string, number>();
  const a = pedirFotos([muitas], "[11111111]", enviadas);
  assertEquals(a.lote?.caminhos.length, 8);
  assertEquals(a.lote?.de, 0);
  assertEquals(a.paraModelo.includes("ficam mais 2"), true);
  const b = pedirFotos([muitas], "11111111", enviadas);
  assertEquals(b.lote?.caminhos, ["1540321/f8.jpg", "1540321/f9.jpg"]);
  const c = pedirFotos([muitas], "11111111", enviadas);
  assertEquals(c.lote, null);
  assertEquals(c.paraModelo.includes("já foram enviadas"), true);
  /* o que já foi em outra mensagem da conversa conta */
  assertEquals(pedirFotos([muitas], "11111111", fotosJaEnviadas([{ codigo: "1540321", de: 0, ate: 8, total: 10 }])).lote?.de, 8);
});

Deno.test("enviar_fotos não manda foto de carro sem foto, reprovado, vendido ou de código errado", () => {
  const e = new Map<string, number>();
  assertEquals(pedirFotos([{ ...gol, fotos: [] }], "11111111", e).lote, null);
  assertEquals(pedirFotos([{ ...gol, laudo_cautelar: "REPROVADO" }], "11111111", e).lote, null);
  assertEquals(pedirFotos([{ ...gol, disponivel: false }], "11111111", e).lote, null);
  assertEquals(pedirFotos([gol], "99999999", e).lote, null);
  assertEquals(pedirFotos([gol], "", e).lote, null);
  assertEquals(pedirFotos([gol], "11111111", e).paraModelo.includes("link"), true); // a instrução proíbe link
  assertEquals(rotuloFotos("Gol 2012", 1, 1, 1), "[1 foto do Gol 2012 enviadas, 1 de 1]");
  assertEquals(rotuloFotos("Gol 2012", 8, 8, 20), "[8 fotos do Gol 2012 enviadas, 8 de 20; dá para mandar mais]");
});

Deno.test("nenhum link sai para o cliente, e o rótulo das fotos não vira texto", () => {
  assertEquals(semLinks("As fotos dele estão aqui:\nhttps://pp-painel-leads.vercel.app/carro?c=1540321"), "As fotos dele o consultor te manda.");
  assertEquals(semLinks("Veja em www.ppgarage.com.br"), "Veja em");
  assertEquals(semLinks("Temos sim, por R$ 34.900."), "Temos sim, por R$ 34.900.");
  assertEquals(semLinks("[8 fotos do Gol 2012 enviadas, 8 de 20; dá para mandar mais]\nEssas são as fotos dele."), "Essas são as fotos dele.");
});

Deno.test("a Bia pede as fotos e escreve só a continuação, sem o preâmbulo", async () => {
  const respostas = [
    { stop_reason: "tool_use", content: [{ type: "text", text: "Vou te mandar as fotos." }, { type: "tool_use", id: "f1", name: "enviar_fotos", input: { carro: "11111111" } }], usage: { input_tokens: 1, output_tokens: 1 } },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Essas são as fotos dele. Você pensa em financiar?" }], usage: { input_tokens: 1, output_tokens: 1 } },
  ];
  const pedidos: unknown[] = [];
  // deno-lint-ignore no-explicit-any
  const cliente = { messages: { create: (r: any) => { pedidos.push(structuredClone(r)); return Promise.resolve(respostas.shift()); } } } as any;
  const pedidosDeFoto: string[] = [];
  const t = await rodarTurno({ cliente, modelo: "claude-sonnet-5", sistema: "s", messages: [{ role: "user", content: "manda foto" }],
    aoEncaminhar: () => Promise.resolve({ ok: true, vendedor: null }), aoPedirFotos: (c) => { pedidosDeFoto.push(c); return "3 fotos vão"; } });
  assertEquals(pedidosDeFoto, ["11111111"]);
  assertEquals(t.textos, ["Essas são as fotos dele. Você pensa em financiar?"]);
  assertEquals(t.fotos, 1);
  // deno-lint-ignore no-explicit-any
  assertEquals((pedidos[0] as any).tools.map((x: any) => x.name), ["encaminhar_ao_vendedor", "enviar_fotos"]);
  // deno-lint-ignore no-explicit-any
  const ult = (pedidos[1] as any).messages.at(-1);
  assertEquals(ult.content[0].type, "tool_result");
  assertEquals(ult.content[0].content, "3 fotos vão");
});

Deno.test("o painel entrega a primeira mensagem que a Bia escreveu", () => {
  const conversa = { id: "c1", estado: "encaminhada", lead_wa: "5511999998888", lead_nome: "Ariane", iniciada_em: "2026-11-23T12:00:00Z", avisado_em: "2026-11-23T12:01:00Z",
    resumo: { veiculo: "Gol 2012 branco", primeira_mensagem: "Oi, Ariane! Aqui é {consultor}, da Pedro Paulo Automóveis." } };
  const { sem_resposta } = painelGerente([conversa], new Map(), 15, Date.parse("2026-11-23T12:05:00Z"));
  assertEquals(sem_resposta[0].mensagem, "Oi, Ariane! Aqui é {consultor}, da Pedro Paulo Automóveis.");
  const semMsg = painelGerente([{ ...conversa, resumo: { veiculo: "Gol" } }], new Map(), 15).sem_resposta[0];
  assertEquals(semMsg.mensagem, null);
});

Deno.test("carro sem foto: a Bia não fala de cadastro, diz que o consultor manda", () => {
  const h = [{ autor: "robo", texto: "oi" }, { autor: "lead", texto: "manda foto do celta" }];
  assertEquals(polir("O Celta Spirit 2010 não tem fotos cadastradas aqui comigo, mas o consultor consegue te mandar as imagens dele.", h, false),
    "O consultor consegue te mandar as fotos dele.");
  assertEquals(polir("Temos sim, por R$ 27.900.", h, false), "Temos sim, por R$ 27.900.");
});

Deno.test("recusada por falta de convite, a Bia responde a pessoa em vez de encaminhar de novo", async () => {
  const pedidos: Record<string, unknown>[] = [];
  const chamada = { type: "tool_use", id: "t1", name: "encaminhar_ao_vendedor", input: { motivo: "qualificado", consultor: "nenhum", veiculo: "Gol", troca: "Palio", pagamento: "financiamento", visita: "não convidado", pendencias: "nenhuma", resumo: "x", primeira_mensagem: "y" } };
  const respostas = [
    { stop_reason: "tool_use", content: [{ type: "text", text: "Temos sim, por R$ 34.900." }, chamada], usage: { input_tokens: 1, output_tokens: 1 } },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Temos sim, o Gol 2012 por R$ 34.900. Fica o convite: Rua Juquiá, 275." }], usage: { input_tokens: 1, output_tokens: 1 } },
  ];
  // deno-lint-ignore no-explicit-any
  const cliente = { messages: { create: (r: any) => { pedidos.push(r); return Promise.resolve(respostas.shift()); } } } as any;
  let encaminhou = false;
  const t = await rodarTurno({ cliente, modelo: "claude-sonnet-5", sistema: "s", messages: [{ role: "user", content: "oi" }],
    validar: () => "Não encaminhe ainda. Convide com o endereço.", aoEncaminhar: () => { encaminhou = true; return Promise.resolve({ ok: true, vendedor: null }); } });
  assertEquals(encaminhou, false);
  assertEquals(t.textos, ["Temos sim, o Gol 2012 por R$ 34.900. Fica o convite: Rua Juquiá, 275."]);
  assertEquals((pedidos[1] as { tool_choice?: { type: string } }).tool_choice?.type, "none");
  assertEquals("tool_choice" in pedidos[0], false);
  /* a resposta recusada volta ao modelo sem o texto, para ele responder de novo por inteiro */
  // deno-lint-ignore no-explicit-any
  const recusada = (pedidos[1] as any).messages.find((m: any) => m.role === "assistant");
  // deno-lint-ignore no-explicit-any
  assertEquals(recusada.content.some((b: any) => b.type === "text"), false);
});

Deno.test("a cor vale para o carro da frase, não para o carro da troca citado junto", () => {
  const palio: Veiculo = { ...gol, id: "22222222-bbbb", titulo: "Fiat Palio Fire 1.0 2011/2012 flex", observacoes: "cor vermelho; câmbio manual" };
  const nota = notaDeCor([{ autor: "lead", texto: "Vocês ainda têm aquele Gol branco 2012? Eu tenho um Palio 2010 para dar na troca." }], [gol, palio])!;
  assertEquals(nota.includes("Palio"), false);
  assertEquals(nota.includes("Gol"), true);
  /* sem modelo na frase da cor, vale o que a pessoa já falou antes */
  const antes = notaDeCor([{ autor: "lead", texto: "Tem Palio?" }, { autor: "robo", texto: "Temos." }, { autor: "lead", texto: "É vermelho?" }], [gol, palio])!;
  assertEquals(antes.includes("Palio"), true);
});
