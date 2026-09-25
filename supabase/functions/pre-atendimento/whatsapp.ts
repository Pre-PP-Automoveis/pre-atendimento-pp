// WhatsApp Cloud API: assinatura do webhook e envio de mensagens.
// O token é de usuário do sistema do Business Manager da Moza, com a loja dando acesso de parceiro à conta
// do WhatsApp dela. Um token atende todas as lojas; o que muda por loja é o phone_number_id.

const GRAPH = `https://graph.facebook.com/${Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v23.0"}`;
const TOKEN = () => Deno.env.get("WHATSAPP_TOKEN")!;

/* X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, corpo cru). Sem isso qualquer um posta no webhook. */
export async function assinaturaValida(corpo: string, cabecalho: string | null, segredo: string) {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpo)));
  const esperado = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  const recebido = cabecalho.slice(7).toLowerCase();
  if (recebido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

async function post(phoneNumberId: string, body: Record<string, unknown>) {
  const r = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${JSON.stringify(j?.error ?? j)}`);
  return j?.messages?.[0]?.id as string | undefined;
}

export const enviarTexto = (phoneNumberId: string, para: string, texto: string) =>
  post(phoneNumberId, { recipient_type: "individual", to: para, type: "text", text: { preview_url: false, body: texto } });

/* marca como lida: o lead vê o duplo check azul enquanto o robô escreve */
export const marcarLida = (phoneNumberId: string, waId: string) =>
  post(phoneNumberId, { status: "read", message_id: waId }).catch(() => undefined);

/* parâmetro de modelo não aceita quebra de linha, tab nem mais de 4 espaços seguidos, e tem teto de tamanho */
export const paramModelo = (s: string, max = 900) =>
  (s || "-").replace(/[\r\n\t]+/g, " · ").replace(/ {2,}/g, " ").trim().slice(0, max) || "-";

/* Aviso ao vendedor. Mensagem iniciada pela empresa fora da janela de 24h só sai por modelo aprovado.
   O botão de resposta rápida devolve o payload "assumi:<conversa>", que é o carimbo da primeira ação humana. */
export const enviarAvisoVendedor = (
  phoneNumberId: string, para: string, modelo: string, params: string[], payloadBotao: string,
) =>
  post(phoneNumberId, {
    to: para, type: "template",
    template: {
      name: modelo, language: { code: "pt_BR" },
      components: [
        { type: "body", parameters: params.map((p) => ({ type: "text", text: paramModelo(p) })) },
        { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: payloadBotao }] },
      ],
    },
  });
