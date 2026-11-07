// Aviso de lead novo no celular de todo o time, mesmo com o painel fechado (Kauan, 07/11/2026).
// Web Push (RFC 8291 e 8292) pela @negrel/webpush, que usa só Web Crypto. As chaves VAPID ficam no segredo PP_VAPID
// (JSON de exportVapidKeys); a pública vai para o painel pela rota ?painel=push_chave.
// No iPhone o aviso só chega com o painel instalado na Tela de Início (iOS 16.4 ou mais novo).
import * as webpush from "jsr:@negrel/webpush@0.5.0";

let servidor: Promise<{ app: webpush.ApplicationServer; chaves: CryptoKeyPair }> | null = null;

function servidorPush() {
  if (!servidor) {
    const exportadas = Deno.env.get("PP_VAPID");
    if (!exportadas) throw new Error("PP_VAPID não configurado");
    servidor = webpush.importVapidKeys(JSON.parse(exportadas), { extractable: false }).then(async (chaves) => ({
      chaves,
      /* contato que o serviço de push (Google, Apple, Mozilla) usa se precisar falar com quem envia */
      app: await webpush.ApplicationServer.new({ contactInformation: "https://www.mozabr.com.br", vapidKeys: chaves }),
    }));
  }
  return servidor;
}

export async function chavePublica() {
  return await webpush.exportApplicationServerKey((await servidorPush()).chaves);
}

export type Aviso = { titulo: string; corpo: string; url: string; tag: string };

/* manda o aviso para cada aparelho; devolve os endpoints que o serviço disse que não existem mais, para apagar */
export async function enviarAvisos(inscricoes: { endpoint: string; inscricao: webpush.PushSubscription }[], aviso: Aviso) {
  const { app } = await servidorPush();
  const texto = JSON.stringify(aviso);
  const mortos: string[] = [];
  let enviados = 0;
  await Promise.all(inscricoes.map(async (i) => {
    try {
      await app.subscribe(i.inscricao).pushTextMessage(texto, { urgency: webpush.Urgency.High, ttl: 6 * 3600, topic: aviso.tag.slice(0, 32) });
      enviados++;
    } catch (e) {
      const status = (e as { response?: Response }).response?.status;
      if (status === 404 || status === 410) mortos.push(i.endpoint);
      else console.error("push", status ?? String(e));
    }
  }));
  return { enviados, mortos };
}
