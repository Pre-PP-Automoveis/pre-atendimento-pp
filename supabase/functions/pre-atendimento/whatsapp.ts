// WhatsApp Cloud API: assinatura do webhook, envio de mensagens e a ligação da loja (cadastro incorporado).
// A Moza é Tech Provider: cada loja, ao se cadastrar, gera uma credencial própria, guardada em pa_credenciais
// (tabela sem acesso público). WHATSAPP_TOKEN no ambiente fica só como reserva para teste.
import { createClient } from "npm:@supabase/supabase-js@2";

export const GRAPH = `https://graph.facebook.com/${Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v25.0"}`;
const banco = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const tokens = new Map<string, string>();

async function tokenDo(phoneNumberId: string) {
  if (tokens.has(phoneNumberId)) return tokens.get(phoneNumberId)!;
  const { data } = await banco.from("pa_lojas").select("pa_credenciais(token_whatsapp)").eq("phone_number_id", phoneNumberId).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const token = (data as any)?.pa_credenciais?.token_whatsapp ?? Deno.env.get("WHATSAPP_TOKEN");
  if (!token) throw new Error(`sem credencial do WhatsApp para o número ${phoneNumberId}`);
  tokens.set(phoneNumberId, token);
  return token;
}

/* chamada à Graph API com uma credencial explícita (usada na ligação, antes de a loja ter número salvo) */
export async function graph(caminho: string, token: string, metodo = "GET", corpo?: Record<string, unknown>) {
  const r = await fetch(`${GRAPH}/${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...(corpo ? { "Content-Type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Graph ${metodo} ${caminho.split("?")[0]} ${r.status}: ${JSON.stringify(j?.error?.message ?? j)}`);
  return j;
}

/* X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, corpo cru). Sem isso qualquer um posta no webhook. */
export async function assinaturaValida(corpo: string, cabecalho: string | null, segredo: string) {
  if (!segredo || !cabecalho?.startsWith("sha256=")) return false;
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
    headers: { Authorization: `Bearer ${await tokenDo(phoneNumberId)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${JSON.stringify(j?.error ?? j)}`);
  return j?.messages?.[0]?.id as string | undefined;
}

export const enviarTexto = (phoneNumberId: string, para: string, texto: string) =>
  post(phoneNumberId, { recipient_type: "individual", to: para, type: "text", text: { preview_url: false, body: texto } });

/* marca como lida e mostra "digitando…" ao lead enquanto o robô escreve (some na resposta ou em ~25 s) */
export const marcarLida = (phoneNumberId: string, waId: string) =>
  post(phoneNumberId, { status: "read", message_id: waId, typing_indicator: { type: "text" } })
    .catch(() => post(phoneNumberId, { status: "read", message_id: waId }))
    .catch(() => undefined);

/* parâmetro de modelo não aceita quebra de linha, tab nem mais de 4 espaços seguidos, e tem teto de tamanho */
export const paramModelo = (s: string, max = 900) =>
  (s || "-").replace(/[\r\n\t]+/g, " · ").replace(/ {2,}/g, " ").trim().slice(0, max) || "-";

/* Aviso ao vendedor da vez, no WhatsApp pessoal dele. Mensagem iniciada pela empresa fora da janela de 24h só sai
   por modelo aprovado. Ele responde ao lead pelo aplicativo da loja, e é esse eco que marca a primeira ação humana. */
export const enviarAvisoVendedor = (phoneNumberId: string, para: string, modelo: string, params: string[]) =>
  post(phoneNumberId, {
    to: para, type: "template",
    template: {
      name: modelo, language: { code: "pt_BR" },
      components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: paramModelo(p) })) }],
    },
  });
