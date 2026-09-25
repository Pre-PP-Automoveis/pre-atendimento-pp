// deno test supabase/functions/pre-atendimento/
import { assertEquals } from "jsr:@std/assert@1";
import { lerOrigem } from "./origem.ts";

Deno.test("WebMotors: a mensagem pronta do portal traz carro, ano e id do anúncio", () => {
  /* a conversa real de 31/07/2026 que redesenhou o roteiro */
  const o = lerOrigem("Olá, estou entrando em contato referente ao seu anúncio na Webmotors webmotors.com.br/comprar/volkswagen/up/10-mpi-take-up-12v-flex-4p-manual/4-portas/2014-2015/73702794");
  assertEquals(o.canal, "WebMotors");
  assertEquals(o.anuncio_id, "73702794");
  assertEquals(o.veiculo_texto, "Volkswagen Up 10 Mpi Take Up 12v Flex 4p Manual 2014/2015");
});

Deno.test("Mercado Livre: id MLB e título do slug", () => {
  const o = lerOrigem("https://carro.mercadolivre.com.br/MLB-5123456789-volkswagen-up-take-10-2015-_JM ainda tem?");
  assertEquals(o.canal, "Mercado Livre");
  assertEquals(o.anuncio_id, "MLB5123456789");
  assertEquals(o.veiculo_texto, "Volkswagen Up Take 10 2015");
});

Deno.test("Mobi Auto: id é a última sequência longa de dígitos", () => {
  const o = lerOrigem("https://www.mobiauto.com.br/comprar/carros/sp-santo-andre/volkswagen/up/2015/take/detalhes/20998877");
  assertEquals(o.canal, "Mobi Auto");
  assertEquals(o.anuncio_id, "20998877");
});

Deno.test("anúncio do Meta ganha do texto", () => {
  const o = lerOrigem("Olá! Tenho interesse", { source_type: "ad", source_id: "120210000000", headline: "Up! Take 2015", ctwa_clid: "abc" });
  assertEquals(o.canal, "Tráfego Pago");
  assertEquals(o.anuncio_id, "120210000000");
});

Deno.test("sem link, o nome do portal na mensagem ainda marca a origem", () => {
  assertEquals(lerOrigem("vi o carro de vocês na OLX").canal, "OLX");
});

Deno.test("contato direto fica Não identificado, de propósito", () => {
  const o = lerOrigem("boa tarde, o up ainda está disponível?");
  assertEquals(o.canal, "Não identificado");
  assertEquals(o.anuncio_id, null);
});
