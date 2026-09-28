// Ligação da loja: recebe o que o cadastro incorporado devolve no navegador e deixa o número pronto na API,
// sem tirar o número do WhatsApp Business do time (coexistência). A loja continua desligada (ativo = false)
// até o teste com o time; quem liga é a Moza.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { GRAPH, graph } from "./whatsapp.ts";

const MODELO_AVISO = "novo_lead_pre_atendimento";
const TEXTO_AVISO = "Lead para você: {{1}}, {{2}}. Carro: {{3}}. Origem: {{4}}. {{5}} Responda pelo WhatsApp da loja.";

export type PedidoLigacao = { convite?: string; code?: string; waba_id?: string; phone_number_id?: string };

export async function ligarLoja(admin: SupabaseClient, p: PedidoLigacao) {
  if (!p.convite || !p.code || !p.waba_id) return { status: 400, corpo: { erro: "faltou convite, código ou conta do WhatsApp" } };
  const { data: loja } = await admin.from("pa_lojas").select("*").eq("convite_onboarding", p.convite).maybeSingle();
  if (!loja) return { status: 404, corpo: { erro: "convite inválido ou já usado" } };

  const appId = Deno.env.get("META_APP_ID"), segredo = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!appId || !segredo) return { status: 500, corpo: { erro: "app da Meta não configurado no servidor" } };

  /* 1. o código do navegador vira a credencial de integração da loja (só o servidor conhece o segredo do app) */
  const r = await fetch(`${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${segredo}&code=${encodeURIComponent(p.code)}`);
  const troca = await r.json().catch(() => ({}));
  if (!r.ok || !troca.access_token) return { status: 502, corpo: { erro: "a Meta recusou o código do cadastro", detalhe: troca?.error?.message } };
  const token: string = troca.access_token;

  /* 2. no fluxo de coexistência a Meta pode não mandar o id do número: busca na conta */
  let phoneId = p.phone_number_id ?? null, exibido: string | null = null;
  const numeros = await graph(`${p.waba_id}/phone_numbers?fields=id,display_phone_number`, token);
  const escolhido = (numeros.data ?? []).find((n: { id: string }) => n.id === phoneId) ?? numeros.data?.[0];
  if (!escolhido) return { status: 502, corpo: { erro: "a conta do WhatsApp veio sem número" } };
  phoneId = escolhido.id; exibido = escolhido.display_phone_number ?? null;

  /* guarda antes de seguir: se um passo abaixo falhar, dá para refazer sem pedir o cadastro de novo */
  await admin.from("pa_credenciais").upsert({ loja_id: loja.id, token_whatsapp: token, atualizado_em: new Date().toISOString() });
  await admin.from("pa_lojas").update({ waba_id: p.waba_id, phone_number_id: phoneId, numero_exibido: exibido, ligada_em: new Date().toISOString() }).eq("id", loja.id);

  const pendencias: string[] = [];
  /* 3. o app da Moza passa a receber os webhooks dessa conta */
  await graph(`${p.waba_id}/subscribed_apps`, token, "POST").catch((e) => pendencias.push(`assinatura do webhook: ${e.message}`));

  /* 4. coexistência: contatos e histórico precisam ser pedidos em até 24 horas, senão a ligação cai */
  try {
    await graph(`${phoneId}/smb_app_data`, token, "POST", { messaging_product: "whatsapp", sync_type: "smb_app_state_sync" });
    await graph(`${phoneId}/smb_app_data`, token, "POST", { messaging_product: "whatsapp", sync_type: "history" });
    await admin.from("pa_lojas").update({ sincronizada_em: new Date().toISOString() }).eq("id", loja.id);
  } catch (e) { pendencias.push(`sincronização (prazo de 24h): ${(e as Error).message}`); }

  /* 5. modelo de aviso ao consultor, que a Meta precisa aprovar antes do primeiro encaminhamento */
  await graph(`${p.waba_id}/message_templates`, token, "POST", {
    name: MODELO_AVISO, language: "pt_BR", category: "UTILITY",
    components: [{ type: "BODY", text: TEXTO_AVISO, example: { body_text: [[
      "Carlos", "(11) 98765-4321", "Volkswagen Up Take 2015", "WebMotors",
      "Troca: não tem · Pagamento: financiado · Prazo: esta semana · Pendências: nenhuma · Quer ver o carro no sábado",
    ]] } }],
  }).catch((e) => { if (!/already exists|já existe/i.test(e.message)) pendencias.push(`modelo de aviso: ${e.message}`); });
  await admin.from("pa_lojas").update({ template_aviso_vendedor: MODELO_AVISO, ...(pendencias.length ? {} : { convite_onboarding: null }) }).eq("id", loja.id);

  if (pendencias.length) console.error("ligação com pendências", loja.slug, pendencias);
  return { status: 200, corpo: { ok: true, loja: loja.nome, numero: exibido, pendencias } };
}
