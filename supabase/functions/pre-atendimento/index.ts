// Edge Function: pre-atendimento
// Webhook da WhatsApp Cloud API. O lead escreve primeiro (o robô nunca inicia conversa, item 2.3 do contrato),
// a Claude responde com a ficha da loja, faz a triagem e passa ao vendedor da vez pelo rodízio.
// O número é compartilhado com o time (coexistência): robô pela API, vendedores pelo WhatsApp Business.
// Quando alguém escreve ao lead pelo aplicativo, chega o eco da Meta e o robô sai da conversa.
// Estado em pa_conversas e pa_mensagens; os dois carimbos (robô x primeira ação humana) ficam separados.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { lerOrigem, type Referral } from "./origem.ts";
import { agoraSP, contextoTurno, type Loja, promptSistema, situacaoHorario, type Veiculo } from "./prompt.ts";
import { foneLegivel, passouDoRobo, proximoVendedor, venceuPrazo } from "./rodizio.ts";
import { assinaturaValida, enviarAvisoVendedor, enviarTexto, marcarLida } from "./whatsapp.ts";
import { ligarLoja } from "./ligacao.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
/* criado na primeira conversa: sem a chave gravada, o cron e a verificação da Meta continuam de pé */
let _anthropic: Anthropic | null = null;
const anthropic = () => (_anthropic ??= new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") }));
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
/* a página do cadastro mora no site da Moza e chama esta função pelo navegador */
/* o site responde em www (Vercel), mas o endereço sem www redireciona para lá: aceita os dois */
const ORIGENS_CADASTRO = ["https://www.mozabr.com.br", "https://mozabr.com.br"];
const corsCadastro = (origem: string | null) => ({
  "Access-Control-Allow-Origin": origem && ORIGENS_CADASTRO.includes(origem) ? origem : ORIGENS_CADASTRO[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", "Vary": "Origin",
});

/* USD por token. Cache de 1 hora: escrita a 2x, leitura a 0,1x da entrada. */
const PRECOS: Record<string, { in: number; out: number }> = {
  "claude-sonnet-5": { in: 2 / 1_000_000, out: 10 / 1_000_000 },
  "claude-haiku-4-5": { in: 1 / 1_000_000, out: 5 / 1_000_000 },
};
/* o lead costuma mandar três mensagens em sequência; o robô espera ele terminar e responde uma vez só */
const ESPERA_MS = 5_000;
/* sem mensagem nova por esse tempo, a próxima abre outro atendimento (e outro aviso do 8.5). Com vendedor já
   na conversa o prazo é maior: negociação de carro pode ficar dias parada e não deve voltar para o robô. */
const REABRE_MS = 7 * 24 * 3600 * 1000;
const REABRE_COM_HUMANO_MS = 30 * 24 * 3600 * 1000;
/* intervalo mínimo entre dois lembretes de "já está com o vendedor" para o mesmo lead */
const LEMBRETE_MS = 30 * 60 * 1000;
const AVISO_PADRAO = (nome: string) =>
  `Este é o atendimento automático da ${nome}. Seus dados são usados só para o atendimento comercial da loja, e se preferir falar com uma pessoa do time é só pedir.`;

const primeiroNome = (s: string | null | undefined) => (s || "").trim().split(/\s+/)[0] || "";
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// deno-lint-ignore no-explicit-any
type Linha = Record<string, any>;

/* ===== ferramenta: a única ação que o robô toma no mundo ===== */
const ENCAMINHAR: Anthropic.Tool = {
  name: "encaminhar_ao_vendedor",
  description: "Passa o atendimento ao time de vendas: o vendedor da vez recebe o resumo e continua a conversa neste mesmo número. Depois disso você não responde mais este lead: escreva só a mensagem de despedida.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["motivo", "veiculo", "troca", "pagamento", "prazo", "pendencias", "resumo"],
    properties: {
      motivo: { type: "string", enum: ["qualificado", "pediu_pessoa", "negociacao", "fora_do_escopo", "midia"] },
      veiculo: { type: "string", description: "Carro de interesse como a pessoa ou o anúncio disse. \"não identificado\" se não souber." },
      troca: { type: "string", description: "O que a pessoa disse sobre carro na troca, ou \"não perguntado\" / \"não respondeu\"." },
      pagamento: { type: "string", description: "À vista, financiado, entrada, ou \"não perguntado\" / \"não respondeu\"." },
      prazo: { type: "string", description: "Quando pensa em fechar, ou \"não perguntado\" / \"não respondeu\"." },
      pendencias: { type: "string", description: "Perguntas que ficaram para o vendedor responder, ou \"nenhuma\"." },
      resumo: { type: "string", description: "Uma frase para o vendedor sobre o que a pessoa quer." },
    },
  },
};

type Encaminhamento = { motivo: string; veiculo: string; troca: string; pagamento: string; prazo: string; pendencias: string; resumo: string };

/* ===== HTTP ===== */
Deno.serve(async (req) => {
  const url = new URL(req.url);
  /* verificação do webhook, feita uma vez no painel da Meta */
  if (req.method === "GET") {
    const ok = !!VERIFY_TOKEN && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("forbidden", { status: 403 });
  }
  if (req.method === "OPTIONS" && url.searchParams.get("ligar") !== null) return new Response(null, { status: 204, headers: corsCadastro(req.headers.get("origin")) });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  /* cadastro incorporado concluído na página www.mozabr.com.br/conectar-whatsapp: liga o número da loja */
  if (url.searchParams.get("ligar") !== null) {
    const pedido = await req.json().catch(() => ({}));
    const r = await ligarLoja(admin, pedido).catch((e) => ({ status: 500, corpo: { erro: String(e?.message ?? e) } }));
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { ...corsCadastro(req.headers.get("origin")), "Content-Type": "application/json" } });
  }

  /* checagem de saúde para quem tem a chave de serviço do projeto: testa a chave da Anthropic numa chamada
     que não gasta token e diz quais segredos existem, sem mostrar valor nenhum */
  if (url.searchParams.get("saude") !== null) {
    /* a chave vale se consegue o que só a chave de serviço consegue: executar pa_confere_cron */
    const chave = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { error: negado } = chave
      ? await createClient(Deno.env.get("SUPABASE_URL")!, chave, { auth: { persistSession: false } }).rpc("pa_confere_cron", { segredo: "-" })
      : { error: true };
    if (negado) return new Response("forbidden", { status: 403 });
    let claude = "ok";
    try { await anthropic().models.retrieve("claude-sonnet-5"); } catch (e) { claude = e instanceof Anthropic.APIError ? `erro ${e.status}` : "chave ausente"; }
    const tem = (n: string) => !!Deno.env.get(n);
    return new Response(JSON.stringify({
      anthropic: claude,
      segredos: { ANTHROPIC_API_KEY: tem("ANTHROPIC_API_KEY"), META_APP_ID: tem("META_APP_ID"), WHATSAPP_APP_SECRET: tem("WHATSAPP_APP_SECRET"), WHATSAPP_VERIFY_TOKEN: tem("WHATSAPP_VERIFY_TOKEN") },
    }), { headers: { "Content-Type": "application/json" } });
  }

  /* cron do banco (pg_cron + pg_net), a cada minuto: despacha a fila da noite e repassa quem ficou sem resposta */
  const cron = req.headers.get("x-cron-secret");
  if (cron !== null) {
    const { data: ok } = await admin.rpc("pa_confere_cron", { segredo: cron });
    if (ok !== true) return new Response("forbidden", { status: 403 });
    const tiradosDoRobo = await tirarDoRobo();
    const despachados = await despacharFila();
    const repasse = await repassar();
    return new Response(JSON.stringify({ tiradosDoRobo, despachados, ...repasse }), { headers: { "Content-Type": "application/json" } });
  }

  const corpo = await req.text();
  if (!(await assinaturaValida(corpo, req.headers.get("x-hub-signature-256"), APP_SECRET))) {
    return new Response("assinatura inválida", { status: 401 });
  }
  /* a Meta reenvia o que não recebe 200 rápido: responde já e trabalha em segundo plano */
  EdgeRuntime.waitUntil(processarPayload(JSON.parse(corpo)).catch((e) => console.error("payload", e)));
  return new Response("ok");
});

async function processarPayload(payload: Linha) {
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value ?? {};
      const mensagens = change?.field === "messages" ? v.messages ?? [] : [];
      const ecos = change?.field === "smb_message_echoes" ? v.message_echoes ?? [] : [];
      const phoneNumberId = v.metadata?.phone_number_id;
      if (!phoneNumberId || !(mensagens.length || ecos.length)) continue; // status de entrega e leitura: ignorados
      const { data: loja } = await admin.from("pa_lojas").select("*").eq("phone_number_id", phoneNumberId).eq("ativo", true).maybeSingle();
      if (!loja) { console.warn("número sem loja ativa", phoneNumberId); continue; }
      /* eco primeiro: se o vendedor escreveu no mesmo lote em que o lead, o robô já precisa saber que saiu */
      for (const eco of ecos) {
        await tratarEco(loja, eco).catch((e) => console.error("eco", eco.id, e));
      }
      const nomes = Object.fromEntries((v.contacts ?? []).map((c: Linha) => [c.wa_id, c.profile?.name]));
      for (const msg of mensagens) {
        await tratarMensagem(loja, msg, nomes[msg.from] ?? null).catch((e) => console.error("mensagem", msg.id, e));
      }
    }
  }
}

/* texto que o robô e o painel enxergam, para qualquer tipo de mensagem */
function textoDe(msg: Linha): string {
  switch (msg.type) {
    case "text": return msg.text?.body ?? "";
    case "button": return msg.button?.text ?? "";
    case "interactive": return msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? "";
    case "audio": return "[a pessoa mandou um áudio, que você não consegue ouvir]";
    case "image": return `[a pessoa mandou uma foto, que você não consegue ver]${msg.image?.caption ? ` legenda: ${msg.image.caption}` : ""}`;
    case "video": return "[a pessoa mandou um vídeo, que você não consegue ver]";
    case "document": return "[a pessoa mandou um documento, que você não consegue abrir]";
    case "location": return "[a pessoa mandou uma localização]";
    case "sticker": return "[figurinha]";
    default: return `[mensagem do tipo ${msg.type}]`;
  }
}

/* Alguém do time escreveu ao lead pelo WhatsApp Business. É a primeira ação humana, e o robô sai da conversa. */
async function tratarEco(loja: Linha, eco: Linha) {
  if (eco.type === "revoke" || eco.type === "edit") return; // apagar ou editar não é atender
  const { data: conversa } = await admin.from("pa_conversas").select("*").eq("loja_id", loja.id).eq("lead_wa", eco.to).neq("estado", "encerrada").maybeSingle();
  if (!conversa) return; // conversa que o time começou por conta própria: não é lead do pré-atendimento
  const { error: dup } = await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "vendedor", tipo: eco.type, texto: textoDe(eco), wa_id: eco.id });
  if (dup) { if (dup.code === "23505") return; throw dup; }
  const agora = new Date().toISOString();
  const assumiu = conversa.estado === "robo" || conversa.estado === "fila";
  await admin.from("pa_conversas").update({
    ultima_msg_em: agora,
    /* entrou antes do robô encaminhar (ou de madrugada, com o lead na fila): a conversa passa a ser do time */
    ...(assumiu ? { estado: "encaminhada", encaminhado_em: conversa.encaminhado_em ?? agora } : {}),
  }).eq("id", conversa.id);
  await admin.from("pa_conversas").update({ primeira_acao_humana_em: agora }).eq("id", conversa.id).is("primeira_acao_humana_em", null);
  if (assumiu) await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "sistema", texto: "o time assumiu pelo aplicativo antes do encaminhamento" });
}

async function tratarMensagem(loja: Linha, msg: Linha, nomePerfil: string | null) {
  /* vendedor escrevendo do celular pessoal para o número da loja: não é lead */
  const { data: vendedor } = await admin.from("pa_vendedores").select("id").eq("loja_id", loja.id).eq("whatsapp", msg.from).maybeSingle();
  if (vendedor) return;

  const texto = textoDe(msg);
  const conversa = await abrirConversa(loja, msg, texto, nomePerfil);

  const { error: dup } = await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "lead", tipo: msg.type, texto, wa_id: msg.id });
  if (dup) { if (dup.code === "23505") return; throw dup; } // reentrega da Meta: já tratada
  await admin.from("pa_conversas").update({ ultima_msg_em: new Date().toISOString(), ...(nomePerfil ? { lead_nome: nomePerfil } : {}) }).eq("id", conversa.id);
  await marcarLida(loja.phone_number_id, msg.id);

  /* com o time já escrevendo, o robô fica quieto: a conversa é deles */
  if (conversa.primeira_acao_humana_em) return;
  if (conversa.estado === "encaminhada" || conversa.estado === "fila") return lembrarLead(loja, conversa);

  /* espera o lead terminar de digitar; se chegou mensagem mais nova, quem responde é o processamento dela */
  await dormir(ESPERA_MS);
  const { data: ultima } = await admin.from("pa_mensagens").select("wa_id").eq("conversa_id", conversa.id).eq("autor", "lead")
    .order("id", { ascending: false }).limit(1).single();
  if (ultima?.wa_id !== msg.id) return;

  await responder(loja, conversa.id);
}

async function abrirConversa(loja: Linha, msg: Linha, texto: string, nomePerfil: string | null): Promise<Linha> {
  const { data: aberta } = await admin.from("pa_conversas").select("*").eq("loja_id", loja.id).eq("lead_wa", msg.from).neq("estado", "encerrada").maybeSingle();
  if (aberta) {
    const parada = Date.now() - new Date(aberta.ultima_msg_em).getTime() > (aberta.primeira_acao_humana_em ? REABRE_COM_HUMANO_MS : REABRE_MS);
    if (!(aberta.estado === "encaminhada" && parada)) return aberta;
    await admin.from("pa_conversas").update({ estado: "encerrada" }).eq("id", aberta.id);
  }
  const origem = lerOrigem(texto, msg.referral as Referral | undefined);
  let veiculoId: string | null = null;
  if (origem.anuncio_id) {
    /* compara em código: o nome do canal tem espaço e acento, e o filtro JSON da API não aceita isso na chave */
    const { data: frota } = await admin.from("pa_veiculos").select("id, anuncios").eq("loja_id", loja.id);
    veiculoId = (frota ?? []).find((v: Linha) => v.anuncios?.[origem.canal] === origem.anuncio_id)?.id ?? null;
  }
  const { data: nova, error } = await admin.from("pa_conversas").insert({
    loja_id: loja.id, lead_wa: msg.from, lead_nome: nomePerfil, origem: origem.canal, veiculo_id: veiculoId,
    origem_detalhe: { anuncio_id: origem.anuncio_id, veiculo_texto: origem.veiculo_texto, url: origem.url, referral: origem.referral ?? null },
  }).select("*").single();
  if (error?.code === "23505") {
    /* duas mensagens do mesmo lead chegaram juntas e a outra criou o atendimento primeiro */
    const { data } = await admin.from("pa_conversas").select("*").eq("loja_id", loja.id).eq("lead_wa", msg.from).neq("estado", "encerrada").single();
    return data!;
  }
  if (error) throw error;
  return nova!;
}

/* o lead voltou a escrever antes de alguém do time responder: um lembrete curto, no máximo a cada 30 minutos */
async function lembrarLead(loja: Linha, conversa: Linha) {
  const { data: ultimoRobo } = await admin.from("pa_mensagens").select("criado_em").eq("conversa_id", conversa.id).eq("autor", "robo")
    .order("id", { ascending: false }).limit(1).maybeSingle();
  if (ultimoRobo && Date.now() - new Date(ultimoRobo.criado_em).getTime() < LEMBRETE_MS) return;
  const abre = situacaoHorario(loja.horario ?? {}).abre;
  const texto = conversa.estado === "fila"
    ? `Sua mensagem ficou anotada. Um consultor continua a conversa aqui mesmo assim que a loja abrir${abre ? `, ${abre}` : ""}.`
    : "Sua mensagem ficou anotada. Um consultor continua a conversa aqui mesmo em instantes.";
  await enviarTexto(loja.phone_number_id, conversa.lead_wa, texto);
  await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "robo", texto });
}

/* ===== a conversa com a Claude ===== */
async function responder(loja: Linha, conversaId: string) {
  const { data: conversa } = await admin.from("pa_conversas").select("*").eq("id", conversaId).single();
  if (!conversa || conversa.estado !== "robo") return;
  const [{ data: estoque }, { data: historico }] = await Promise.all([
    admin.from("pa_veiculos").select("*").eq("loja_id", loja.id).order("titulo"),
    admin.from("pa_mensagens").select("autor, texto").eq("conversa_id", conversaId).in("autor", ["lead", "robo"]).order("id"),
  ]);
  const veiculos = (estoque ?? []) as Veiculo[];
  const ficha = veiculos.find((v) => v.id === conversa.veiculo_id) ?? null;
  const primeiroTurno = !conversa.respondido_robo_em;

  /* lead vira user, robô vira assistant; mensagens seguidas do mesmo lado viram um turno só */
  const messages: Anthropic.MessageParam[] = [];
  for (const m of historico ?? []) {
    const role = m.autor === "lead" ? "user" : "assistant";
    const ult = messages[messages.length - 1];
    if (ult?.role === role) ult.content = `${ult.content}\n${m.texto}`;
    else if (messages.length || role === "user") messages.push({ role, content: m.texto });
  }
  const ultimo = messages[messages.length - 1];
  if (ultimo?.role !== "user") return;
  ultimo.content = [
    { type: "text", text: ultimo.content as string },
    { type: "text", text: contextoTurno({
      agora: agoraSP(), horario: situacaoHorario(loja.horario ?? {}).texto, canal: conversa.origem,
      veiculoAnuncio: conversa.origem_detalhe?.veiculo_texto ?? null, ficha, primeiroTurno,
    }) },
  ];

  const sistema = promptSistema(loja as Loja, veiculos);
  const modelo: string = loja.modelo;
  const precos = PRECOS[modelo] ?? PRECOS["claude-sonnet-5"];
  let custo = 0;
  const textos: string[] = [];
  let encaminhado: Resultado | null = null;

  try {
    for (let volta = 0; volta < 3; volta++) {
      const resp = await anthropic().messages.create({
        model: modelo,
        max_tokens: 2048,
        /* triagem de roteiro fechado: esforço baixo responde rápido e custa menos. Haiku 4.5 não aceita effort. */
        ...(modelo.startsWith("claude-haiku") ? {} : { output_config: { effort: "low" as const } }),
        system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral", ttl: "1h" } }],
        tools: [ENCAMINHAR],
        messages,
      });
      const u = resp.usage;
      custo += u.input_tokens * precos.in + u.output_tokens * precos.out +
        (u.cache_creation_input_tokens ?? 0) * precos.in * 2 + (u.cache_read_input_tokens ?? 0) * precos.in * 0.1;
      if (resp.stop_reason === "refusal") throw new Error("resposta recusada pelo modelo");

      for (const b of resp.content) if (b.type === "text" && b.text.trim()) textos.push(b.text.trim());
      const chamada = resp.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (resp.stop_reason !== "tool_use" || !chamada) break;

      /* o cron dos 15 minutos ou o time podem ter levado a conversa enquanto a Claude pensava */
      const { data: estadoAgora } = await admin.from("pa_conversas").select("estado").eq("id", conversaId).single();
      if (estadoAgora?.estado !== "robo") return;
      const resultado = await encaminhar(loja, conversa, chamada.input as Encaminhamento);
      encaminhado = resultado;
      messages.push({ role: "assistant", content: resp.content });
      messages.push({ role: "user", content: [{
        type: "tool_result", tool_use_id: chamada.id, is_error: !resultado.ok,
        content: resultado.fila
          ? `A loja está fechada. O atendimento ficou anotado e um consultor continua a conversa aqui mesmo, neste número, quando a loja abrir, ${resultado.abre ?? "no próximo horário de funcionamento"}. Diga isso ao lead e despeça-se.`
          : resultado.ok
            ? "O consultor da vez recebeu o resumo e continua a conversa aqui mesmo, neste número. Escreva só a despedida, sem citar nome."
            : `Não foi possível avisar o consultor da vez agora (${resultado.erro}). Diga que um consultor continua a conversa aqui mesmo em instantes e despeça-se.`,
      }] });
      textos.length = 0; // o que veio antes da chamada era preâmbulo; vale a despedida
    }
  } catch (e) {
    /* contingência do item 4.6: o lead não fica sem resposta e a conversa vai para uma pessoa */
    console.error("claude", conversaId, e);
    textos.length = 0;
    if (!encaminhado) {
      encaminhado = await encaminhar(loja, conversa, { motivo: "fora_do_escopo", veiculo: conversa.origem_detalhe?.veiculo_texto || "não identificado",
        troca: "não perguntado", pagamento: "não perguntado", prazo: "não perguntado", pendencias: "nenhuma",
        resumo: "O robô ficou indisponível no meio do atendimento; retome a conversa do começo." });
    }
    textos.push(encaminhado.fila
      ? `Recebi sua mensagem. Um consultor continua a conversa aqui mesmo assim que a loja abrir${encaminhado.abre ? `, ${encaminhado.abre}` : ""}.`
      : "Recebi sua mensagem. Um consultor continua a conversa aqui mesmo em instantes.");
  }

  if (!textos.length && encaminhado?.fila) textos.push(`Anotei tudo. Um consultor continua a conversa aqui mesmo assim que a loja abrir${encaminhado.abre ? `, ${encaminhado.abre}` : ""}.`);
  else if (!textos.length && encaminhado) textos.push("Anotei tudo. Um consultor continua a conversa aqui mesmo em instantes.");
  if (!textos.length) return;
  /* o time pode ter entrado pelo aplicativo enquanto a Claude pensava: aí a vez é deles, e o robô não fala por cima */
  const { data: agoraConversa } = await admin.from("pa_conversas").select("estado, primeira_acao_humana_em").eq("id", conversaId).single();
  if (agoraConversa?.primeira_acao_humana_em) return;
  if (!encaminhado && agoraConversa?.estado !== "robo") return; // o cron dos 15 minutos encaminhou no meio
  let texto = textos.join("\n\n");
  if (primeiroTurno) texto += `\n\n${loja.aviso_inicial || AVISO_PADRAO(loja.nome)}`;

  await enviarTexto(loja.phone_number_id, conversa.lead_wa, texto);
  await admin.from("pa_mensagens").insert({ conversa_id: conversaId, autor: "robo", texto, custo_usd: Number(custo.toFixed(6)) });
  if (primeiroTurno) await admin.from("pa_conversas").update({ respondido_robo_em: new Date().toISOString() }).eq("id", conversaId);
}

type Resultado = { ok: boolean; vendedor: string | null; fila?: boolean; abre?: string | null; erro?: string };

/* Fecha a triagem. Loja aberta: avisa já o vendedor da vez. Loja fechada: entra na fila e o cron avisa na abertura,
   para o lead não cair de madrugada no celular de quem estiver na vez e o SLA contar a partir do horário comercial. */
async function encaminhar(loja: Linha, conversa: Linha, e: Encaminhamento): Promise<Resultado> {
  const horario = situacaoHorario(loja.horario ?? {});
  if (!horario.aberta) {
    await admin.from("pa_conversas").update({ estado: "fila", fila_em: new Date().toISOString(), resumo: e }).eq("id", conversa.id);
    await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "sistema", texto: `na fila até a abertura (${e.motivo})` });
    return { ok: true, vendedor: null, fila: true, abre: horario.abre };
  }
  return avisarVendedor(loja, { ...conversa, resumo: e });
}

/* cron: o lead fica no máximo prazo_robo_min com o robô. Passou disso sem a triagem acabar (o lead parou de
   responder, ou a conversa se alongou), vai para o consultor da vez com o que tiver; de noite, para a fila. */
async function tirarDoRobo() {
  const { data: lojas } = await admin.from("pa_lojas").select("*").eq("ativo", true);
  let total = 0;
  for (const loja of lojas ?? []) {
    const { data: abertas } = await admin.from("pa_conversas").select("*").eq("loja_id", loja.id).eq("estado", "robo").is("primeira_acao_humana_em", null);
    for (const conversa of abertas ?? []) {
      if (!passouDoRobo(conversa, loja.prazo_robo_min ?? 15)) continue;
      const r = await encaminhar(loja, conversa, {
        motivo: "tempo_esgotado", veiculo: conversa.origem_detalhe?.veiculo_texto || "ver na conversa",
        troca: "ver na conversa", pagamento: "ver na conversa", prazo: "ver na conversa", pendencias: "ver na conversa",
        resumo: `Triagem não terminou em ${loja.prazo_robo_min ?? 15} min; a conversa inteira está no WhatsApp da loja.`,
      }).catch((err) => ({ ok: false, erro: String(err) }) as Resultado);
      if (r.ok) total++; else console.error("robo", conversa.id, r.erro);
    }
  }
  return total;
}

/* cron: despacha a fila de cada loja ativa que já abriu, na ordem em que os leads chegaram.
   Quem falhou antes (modelo da Meta fora, nenhum vendedor ativo) também está na fila e é tentado de novo. */
async function despacharFila() {
  const { data: lojas } = await admin.from("pa_lojas").select("*").eq("ativo", true);
  let total = 0;
  for (const loja of lojas ?? []) {
    if (!situacaoHorario(loja.horario ?? {}).aberta) continue;
    const { data: fila } = await admin.from("pa_conversas").select("*").eq("loja_id", loja.id).eq("estado", "fila").order("fila_em");
    for (const conversa of fila ?? []) {
      const r = await avisarVendedor(loja, conversa).catch((err) => ({ ok: false, erro: String(err) }));
      if (r.ok) total++;
      else console.error("fila", conversa.id, r.erro);
    }
  }
  return total;
}

/* cron: vendedor da vez não respondeu no prazo, o lead passa para o próximo; acabado o rodízio, avisa o gerente.
   Só com a loja aberta: aviso das 17h50 sem resposta repassa na abertura seguinte. */
async function repassar() {
  const { data: lojas } = await admin.from("pa_lojas").select("*").eq("ativo", true);
  let repassados = 0, escalados = 0;
  for (const loja of lojas ?? []) {
    if (!situacaoHorario(loja.horario ?? {}).aberta) continue;
    const { data: pendentes } = await admin.from("pa_conversas").select("*").eq("loja_id", loja.id)
      .eq("estado", "encaminhada").is("primeira_acao_humana_em", null).is("escalado_em", null).not("avisado_em", "is", null);
    const { data: equipe } = await admin.from("pa_vendedores").select("*").eq("loja_id", loja.id);
    for (const conversa of pendentes ?? []) {
      if (!venceuPrazo(conversa, loja.prazo_repasse_min ?? 60)) continue;
      if (proximoVendedor(equipe ?? [], conversa.tentativas ?? [])) {
        const r = await avisarVendedor(loja, conversa).catch((err) => ({ ok: false, erro: String(err) }));
        if (r.ok) repassados++; else console.error("repasse", conversa.id, r.erro);
      } else if (await escalarGerente(loja, conversa)) escalados++;
    }
  }
  return { repassados, escalados };
}

/* ===== rodízio sequencial: recebe quem está há mais tempo sem lead, como a distribuição do BNDV ===== */
async function avisarVendedor(loja: Linha, conversa: Linha): Promise<Resultado> {
  const e = conversa.resumo as Encaminhamento;
  const tentativas: string[] = conversa.tentativas ?? [];
  const repasse = tentativas.length > 0;
  const agora = new Date().toISOString();
  /* sem aviso, o lead volta para a fila e o cron tenta de novo no minuto seguinte, com a loja aberta */
  const falhar = async (erro: string): Promise<Resultado> => {
    if (!repasse) await admin.from("pa_conversas").update({ estado: "fila", fila_em: conversa.fila_em ?? agora, resumo: { ...e, erro } }).eq("id", conversa.id);
    return { ok: false, vendedor: null, erro };
  };
  if (!loja.template_aviso_vendedor) return falhar("modelo de aviso não configurado");
  const { data: equipe } = await admin.from("pa_vendedores").select("*").eq("loja_id", loja.id);
  const vend = proximoVendedor(equipe ?? [], tentativas);
  if (!vend) return falhar("nenhum vendedor ativo");

  try {
    await enviarAvisoVendedor(loja.phone_number_id, vend.whatsapp, loja.template_aviso_vendedor, paramsAviso(conversa, e,
      repasse ? `Repassado: ninguém respondeu em ${loja.prazo_repasse_min ?? 60} min.` : ""));
  } catch (err) {
    return falhar(String(err));
  }
  await admin.from("pa_vendedores").update({ ultimo_lead_em: agora }).eq("id", vend.id);
  await admin.from("pa_conversas").update({
    estado: "encaminhada", vendedor_id: vend.id, avisado_em: agora, encaminhado_em: conversa.encaminhado_em ?? agora,
    tentativas: [...tentativas, vend.id], resumo: e,
  }).eq("id", conversa.id);
  await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "sistema",
    texto: repasse ? `repassado para ${vend.nome}: sem resposta em ${loja.prazo_repasse_min ?? 60} min` : `encaminhado para ${vend.nome} (${e.motivo})${conversa.estado === "fila" ? ", vindo da fila" : ""}` });
  return { ok: true, vendedor: primeiroNome(vend.nome) };
}

async function escalarGerente(loja: Linha, conversa: Linha) {
  const agora = new Date().toISOString();
  await admin.from("pa_conversas").update({ escalado_em: agora }).eq("id", conversa.id);
  if (!loja.gerente_whatsapp || !loja.template_aviso_vendedor) {
    await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "sistema", texto: "rodízio esgotado sem resposta, e não há gerente cadastrado para avisar" });
    return false;
  }
  try {
    await enviarAvisoVendedor(loja.phone_number_id, loja.gerente_whatsapp, loja.template_aviso_vendedor,
      paramsAviso(conversa, conversa.resumo as Encaminhamento, "Ninguém do rodízio respondeu este lead."));
  } catch (err) {
    console.error("gerente", conversa.id, err);
    return false;
  }
  await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "sistema", texto: `rodízio esgotado: gerente ${loja.gerente_nome ?? ""} avisado`.trim() });
  return true;
}

/* modelo na Meta: "Lead para você: {{1}}, {{2}}. Carro: {{3}}. Origem: {{4}}. {{5}} Responda pelo WhatsApp da loja." */
function paramsAviso(conversa: Linha, e: Encaminhamento, prefixo: string) {
  const detalhe = [prefixo, `Troca: ${e.troca}`, `Pagamento: ${e.pagamento}`, `Prazo: ${e.prazo}`, `Pendências: ${e.pendencias}`, e.resumo]
    .filter(Boolean).join(" · ");
  return [conversa.lead_nome || "cliente", foneLegivel(conversa.lead_wa), e.veiculo, conversa.origem, detalhe];
}
