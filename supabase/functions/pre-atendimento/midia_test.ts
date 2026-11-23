import { assertEquals } from "jsr:@std/assert@1";
import { rotuloAudio, rotuloFoto } from "./rotulos.ts";
import { linhaFicha, linkFotos, notaDeCor, type Veiculo } from "./prompt.ts";
import { polir, rodarTurno, soLinksDaFicha } from "./conversa.ts";
import { painelGerente } from "./painel.ts";

const gol: Veiculo = { id: "11111111-aaaa", titulo: "Volkswagen Gol 1.6 (G5) (Flex) 2011/2012 flex", disponivel: true, preco: 34900, km: 150000,
  leilao: null, laudo_cautelar: null, unico_dono: null, observacoes: "cor branco; câmbio manual", anuncios: { placa: "ABC1D23", bndv: "1540321" },
  fotos: ["https://cdn-sistema-lojistas.bndv.com.br/vehicles-images/sistema.lojistas/870/1540321/a.jpg"] };
const BASE = "https://pp-painel-leads.vercel.app/carro?c=";
const LINK = `${BASE}1540321`;

Deno.test("áudio e foto chegam para a Bia como texto rotulado", () => {
  assertEquals(rotuloAudio("  quero o gol\n branco "), "[áudio do cliente: quero o gol branco]");
  assertEquals(rotuloFoto("print de anúncio de um Gol G5 branco 2012, R$ 34.900", "esse aqui"), "[foto do cliente: print de anúncio de um Gol G5 branco 2012, R$ 34.900] legenda: esse aqui");
  assertEquals(rotuloFoto("foto de um Onix prata", null), "[foto do cliente: foto de um Onix prata]");
});

Deno.test("a ficha leva o link de fotos só com foto, código do BNDV e link da loja", () => {
  assertEquals(linkFotos(gol, BASE), LINK);
  assertEquals(linkFotos({ ...gol, fotos: [] }, BASE), null);
  assertEquals(linkFotos({ ...gol, anuncios: { placa: "ABC1D23" } }, BASE), null);
  assertEquals(linkFotos(gol, null), null);
  assertEquals(linhaFicha(gol, BASE).endsWith(`| fotos: ${LINK}`), true);
  assertEquals(linhaFicha(gol).includes("fotos:"), false);
});

Deno.test("o polimento não estraga o link e deixa ele numa linha só", () => {
  const t = polir(`As fotos dele estão aqui: ${LINK}`, [{ autor: "robo", texto: "oi" }, { autor: "lead", texto: "tem foto?" }], false);
  assertEquals(t, `As fotos dele estão aqui:\n${LINK}`);
});

Deno.test("link que não é da ficha sai, e a frase vira o consultor mandando", () => {
  assertEquals(soLinksDaFicha(`As fotos dele estão aqui:\n${LINK}`, [LINK]), `As fotos dele estão aqui:\n${LINK}`);
  assertEquals(soLinksDaFicha(`As fotos dele estão aqui:\n${BASE}999`, [LINK]), "As fotos dele o consultor te manda.");
  assertEquals(soLinksDaFicha("Temos sim, por R$ 34.900.", [LINK]), "Temos sim, por R$ 34.900.");
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
