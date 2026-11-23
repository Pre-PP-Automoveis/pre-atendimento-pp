import { assertEquals } from "jsr:@std/assert@1";
import { rotuloAudio, rotuloFoto } from "./rotulos.ts";
import { linhaFicha, linkFotos, type Veiculo } from "./prompt.ts";
import { polir, soLinksDaFicha } from "./conversa.ts";
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
