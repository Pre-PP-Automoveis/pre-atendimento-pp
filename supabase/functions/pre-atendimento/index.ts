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
import { foneLegivel, passouDoRobo, pessoaPedida, proximoVendedor, venceuPrazo } from "./rodizio.ts";
import { assinaturaValida, enviarAvisoVendedor, enviarTexto, marcarLida } from "./whatsapp.ts";
import { ligarLoja } from "./ligacao.ts";
import { AVISO_PADRAO, despedidaPadrao, exigirConvite, notasDaConversa, semAvisoRepetido, semFrasesFeitas, semTravessao, visitaReal, type Encaminhamento, montarMensagens, type Resultado, rodarTurno } from "./conversa.ts";
import { simular } from "./simulador.ts";
import { equipeDoPainel, painelAdmin, painelConsultor, painelGerente } from "./painel.ts";
import { BLOQUEIO_MIN, confereSenha, hashSenha, MAX_FALHAS, normalizaUsuario, novoToken, resumoDoToken, SESSAO_DIAS, senhaPadrao } from "./acesso.ts";

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

/* o painel de leads é um projeto próprio de cada loja na Vercel, fora do site da Moza: o endereço vem do segredo
   PAINEL_ORIGENS (um ou mais, separados por vírgula) */
const ORIGENS_PAINEL = (Deno.env.get("PAINEL_ORIGENS") ?? "").split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);
const corsPainel = (origem: string | null) => ({
  "Access-Control-Allow-Origin": origem && ORIGENS_PAINEL.includes(origem) ? origem : ORIGENS_PAINEL[0] ?? "null",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, authorization", "Vary": "Origin",
});

/* o lead costuma mandar três mensagens em sequência; o robô espera ele terminar e responde uma vez só */
const ESPERA_MS = 5_000;
/* sem mensagem nova por esse tempo, a próxima abre outro atendimento (e outro aviso do 8.5). Com vendedor já
   na conversa o prazo é maior: negociação de carro pode ficar dias parada e não deve voltar para o robô. */
const REABRE_MS = 7 * 24 * 3600 * 1000;
const REABRE_COM_HUMANO_MS = 30 * 24 * 3600 * 1000;
/* intervalo mínimo entre dois lembretes de "já está com o vendedor" para o mesmo lead */
const LEMBRETE_MS = 30 * 60 * 1000;

/* erro vai para o log da função e para pa_erros, agrupado: o admin vê no painel o que falhou, onde e quantas vezes */
async function registrarErro(onde: string, e: unknown, lojaId: string | null = null, conversaId: string | null = null) {
  const mensagem = String((e as Error)?.message ?? e);
  console.error(onde, conversaId ?? "", mensagem);
  try {
    await admin.rpc("pa_registra_erro", { p_loja: lojaId, p_onde: onde, p_conversa: conversaId, p_mensagem: mensagem });
  } catch (falha) { console.error("pa_erros", falha); }
}
const bater = (chave: string, detalhe: unknown = null) =>
  admin.from("pa_saude").upsert({ chave, em: new Date().toISOString(), detalhe }).then(() => {}, () => {});

const primeiroNome = (s: string | null | undefined) => (s || "").trim().split(/\s+/)[0] || "";
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// deno-lint-ignore no-explicit-any
type Linha = Record<string, any>;

/* ===== HTTP ===== */
Deno.serve(async (req) => {
  const url = new URL(req.url);
  /* verificação do webhook, feita uma vez no painel da Meta */
  /* painel de leads, com usuário e senha. ?painel=entrar | sair | senha; ?painel sozinho: GET lê, POST são ações do gerente.
     A sessão vai no cabeçalho Authorization, nunca na URL. */
  if (url.searchParams.get("painel") !== null) {
    const cabecalhos = { ...corsPainel(req.headers.get("origin")), "Content-Type": "application/json", "Cache-Control": "no-store" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cabecalhos });
    const rota = url.searchParams.get("painel") ?? "";
    const sessao = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const corpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const r = await (
      rota === "entrar" ? entrarNoPainel(corpo)
      : rota === "sair" ? sairDoPainel(sessao)
      : rota === "senha" ? trocarSenha(sessao, corpo)
      : rota === "conversa" ? lerConversa(sessao, url.searchParams.get("id") ?? "")
      : req.method === "POST" ? agirPainel(sessao, corpo)
      : lerPainel(sessao)
    ).catch((e) => ({ status: 500, corpo: { erro: String(e?.message ?? e) } }));
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: cabecalhos });
  }

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

  /* simulador: roda cenários com o prompt e o código reais, sem WhatsApp e sem gravar nada. Chave de serviço. */
  if (url.searchParams.get("simular") !== null) {
    const chave = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { error: negado } = chave
      ? await createClient(Deno.env.get("SUPABASE_URL")!, chave, { auth: { persistSession: false } }).rpc("pa_confere_cron", { segredo: "-" })
      : { error: true };
    if (negado) return new Response("forbidden", { status: 403 });
    const pedido = await req.json().catch(() => ({}));
    const { data: loja } = await admin.from("pa_lojas").select("*").eq("slug", pedido.loja ?? "pp-automoveis").single();
    if (!loja) return new Response(JSON.stringify({ erro: "loja não encontrada" }), { status: 404 });
    loja.equipe = await nomesDaEquipe(loja.id);
    /* sem estoque no pedido, usa o estoque real da loja */
    const { data: frota } = pedido.estoque ? { data: null } : await admin.from("pa_veiculos").select("*").eq("loja_id", loja.id).order("titulo");
    const resultado = await simular(anthropic(), loja, { ...pedido, estoque: pedido.estoque ?? frota ?? [] });
    return new Response(JSON.stringify(resultado), { headers: { "Content-Type": "application/json" } });
  }

  /* cron do banco (pg_cron + pg_net), a cada minuto: despacha a fila da noite e repassa quem ficou sem resposta */
  const cron = req.headers.get("x-cron-secret");
  if (cron !== null) {
    const { data: ok } = await admin.rpc("pa_confere_cron", { segredo: cron });
    if (ok !== true) return new Response("forbidden", { status: 403 });
    const tiradosDoRobo = await tirarDoRobo();
    const despachados = await despacharFila();
    const repasse = await repassar();
    await bater("cron", { tiradosDoRobo, despachados, ...repasse });
    return new Response(JSON.stringify({ tiradosDoRobo, despachados, ...repasse }), { headers: { "Content-Type": "application/json" } });
  }

  const corpo = await req.text();
  if (!(await assinaturaValida(corpo, req.headers.get("x-hub-signature-256"), APP_SECRET))) {
    return new Response("assinatura inválida", { status: 401 });
  }
  /* a Meta reenvia o que não recebe 200 rápido: responde já e trabalha em segundo plano */
  EdgeRuntime.waitUntil(Promise.all([bater("webhook"), processarPayload(JSON.parse(corpo)).catch((e) => registrarErro("payload", e))]));
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
        await tratarEco(loja, eco).catch((e) => registrarErro("eco", e, loja.id));
      }
      const nomes = Object.fromEntries((v.contacts ?? []).map((c: Linha) => [c.wa_id, c.profile?.name]));
      for (const msg of mensagens) {
        await tratarMensagem(loja, msg, nomes[msg.from] ?? null).catch((e) => registrarErro("mensagem", e, loja.id));
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
    ultima_msg_em: agora, ultima_acao_humana_em: agora,
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
  /* contato que o gerente marcou como "não é lead" no painel: o robô não responde */
  const { data: ignorado } = await admin.from("pa_ignorados").select("wa").eq("loja_id", loja.id).eq("wa", msg.from).maybeSingle();
  if (ignorado) return;

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
  const [{ data: estoque }, { data: historico }, equipe] = await Promise.all([
    admin.from("pa_veiculos").select("*").eq("loja_id", loja.id).order("titulo"),
    admin.from("pa_mensagens").select("autor, texto").eq("conversa_id", conversaId).in("autor", ["lead", "robo"]).order("id"),
    nomesDaEquipe(loja.id),
  ]);
  const veiculos = (estoque ?? []) as Veiculo[];
  const ficha = veiculos.find((v) => v.id === conversa.veiculo_id) ?? null;
  const primeiroTurno = !conversa.respondido_robo_em;
  const messages = montarMensagens(historico ?? [], contextoTurno({
    agora: agoraSP(), horario: situacaoHorario(loja.horario ?? {}).texto, canal: conversa.origem,
    veiculoAnuncio: conversa.origem_detalhe?.veiculo_texto ?? null, ficha, primeiroTurno, nome: conversa.lead_nome,
    notas: notasDaConversa(historico ?? [], loja.endereco, primeiroNome(conversa.lead_nome) || null),
  }));
  if (!messages) return;

  let textos: string[] = [];
  let custo = 0;
  let encaminhado: Resultado | null = null;
  try {
    const turno = await rodarTurno({
      cliente: anthropic(), modelo: loja.modelo, sistema: promptSistema({ ...loja, equipe } as Loja, veiculos), messages,
      validar: exigirConvite(historico ?? [], loja.endereco),
      aoEncaminhar: async (e) => {
        /* o cron dos 15 minutos ou o time podem ter levado a conversa enquanto a Claude pensava */
        const { data: estadoAgora } = await admin.from("pa_conversas").select("estado").eq("id", conversaId).single();
        if (estadoAgora?.estado !== "robo") return null;
        return encaminhar(loja, conversa, { ...e, visita: visitaReal(e.visita, historico ?? [], loja.endereco) });
      },
    });
    if (turno.interrompido) return;
    textos = turno.textos; custo = turno.custo; encaminhado = turno.encaminhado;
  } catch (e) {
    /* contingência do item 4.6: o lead não fica sem resposta e a conversa vai para uma pessoa */
    await registrarErro("claude", e, loja.id, conversaId);
    encaminhado ??= await encaminhar(loja, conversa, { motivo: "fora_do_escopo", consultor: "nenhum", veiculo: conversa.origem_detalhe?.veiculo_texto || "não identificado",
      troca: "não perguntado", pagamento: "não perguntado", visita: "não perguntado", pendencias: "nenhuma",
      resumo: "O robô ficou indisponível no meio do atendimento; retome a conversa do começo." });
    textos = [encaminhado.fila
      ? `Recebi sua mensagem. Um consultor continua a conversa aqui mesmo assim que a loja abrir${encaminhado.abre ? `, ${encaminhado.abre}` : ""}.`
      : "Recebi sua mensagem. Um consultor continua a conversa aqui mesmo em instantes."];
  }

  if (!textos.length && encaminhado) textos.push(despedidaPadrao(encaminhado));
  if (!textos.length) return;
  /* o time pode ter entrado pelo aplicativo enquanto a Claude pensava: aí a vez é deles, e o robô não fala por cima */
  const { data: agoraConversa } = await admin.from("pa_conversas").select("estado, primeira_acao_humana_em").eq("id", conversaId).single();
  if (agoraConversa?.primeira_acao_humana_em) return;
  if (!encaminhado && agoraConversa?.estado !== "robo") return; // o cron dos 15 minutos encaminhou no meio
  /* aviso do item 8.5 abrindo a primeira mensagem, em texto fixo */
  let texto = semFrasesFeitas(semTravessao(textos.join("\n\n")));
  if (primeiroTurno) {
    const ultimaDoLead = [...(historico ?? [])].reverse().find((m) => m.autor === "lead")?.texto ?? "";
    texto = `${loja.aviso_inicial || AVISO_PADRAO(loja.nome)}\n\n${semAvisoRepetido(texto, ultimaDoLead)}`;
  }

  await enviarTexto(loja.phone_number_id, conversa.lead_wa, texto);
  await admin.from("pa_mensagens").insert({ conversa_id: conversaId, autor: "robo", texto, custo_usd: Number(custo.toFixed(6)) });
  if (primeiroTurno) await admin.from("pa_conversas").update({ respondido_robo_em: new Date().toISOString() }).eq("id", conversaId);
}

/* primeiros nomes de quem está ativo no time, para o robô reconhecer quando o cliente pede alguém */
async function nomesDaEquipe(lojaId: string) {
  const { data } = await admin.from("pa_vendedores").select("nome").eq("loja_id", lojaId).eq("ativo", true).eq("admin", false).order("ordem");
  return (data ?? []).map((v: Linha) => primeiroNome(v.nome)).filter(Boolean);
}

/* Fecha a triagem. Loja aberta: avisa já o vendedor da vez. Loja fechada: entra na fila e o cron avisa na abertura,
   para o lead não cair de madrugada no celular de quem estiver na vez e o SLA contar a partir do horário comercial.
   Cliente que pediu alguém do time pelo nome vai para essa pessoa, dentro ou fora do rodízio. */
async function encaminhar(loja: Linha, conversa: Linha, e: Encaminhamento): Promise<Resultado> {
  const { data: equipe } = await admin.from("pa_vendedores").select("*").eq("loja_id", loja.id).eq("admin", false);
  const pedida = pessoaPedida(equipe ?? [], e.consultor);
  const dono = pedida ? { vendedor_id: pedida.id, fixado_por: "lead" } : {};
  const horario = situacaoHorario(loja.horario ?? {});
  if (!horario.aberta) {
    await admin.from("pa_conversas").update({ estado: "fila", fila_em: new Date().toISOString(), resumo: e, ...dono }).eq("id", conversa.id);
    await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "sistema", texto: `na fila até a abertura (${e.motivo})${pedida ? `, pediu ${pedida.nome}` : ""}` });
    return { ok: true, vendedor: pedida ? primeiroNome(pedida.nome) : null, nomeado: !!pedida, fila: true, abre: horario.abre };
  }
  return avisarVendedor(loja, { ...conversa, resumo: e, ...dono });
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
        motivo: "tempo_esgotado", consultor: "nenhum", veiculo: conversa.origem_detalhe?.veiculo_texto || "ver na conversa",
        troca: "ver na conversa", pagamento: "ver na conversa", visita: "ver na conversa", pendencias: "ver na conversa",
        resumo: `Triagem não terminou em ${loja.prazo_robo_min ?? 15} min; a conversa inteira está no WhatsApp da loja.`,
      }).catch((err) => ({ ok: false, erro: String(err) }) as Resultado);
      if (r.ok) total++; else await registrarErro("tirar do robô", r.erro, loja.id, conversa.id);
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
      else await registrarErro("fila", r.erro, loja.id, conversa.id);
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
      .eq("estado", "encaminhada").is("primeira_acao_humana_em", null).is("escalado_em", null).is("fixado_por", null).not("avisado_em", "is", null);
    const { data: equipe } = await admin.from("pa_vendedores").select("*").eq("loja_id", loja.id);
    for (const conversa of pendentes ?? []) {
      if (!venceuPrazo(conversa, loja.prazo_repasse_min ?? 60)) continue;
      if (proximoVendedor(equipe ?? [], conversa.tentativas ?? [])) {
        const r = await avisarVendedor(loja, conversa).catch((err) => ({ ok: false, erro: String(err) }));
        if (r.ok) repassados++; else await registrarErro("repasse", r.erro, loja.id, conversa.id);
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
  const { data: equipe } = await admin.from("pa_vendedores").select("*").eq("loja_id", loja.id);
  /* dono fixo (o cliente pediu a pessoa): vai para ela, sem gastar a vez de ninguém no rodízio */
  const fixo = conversa.fixado_por ? (equipe ?? []).find((v: Linha) => v.id === conversa.vendedor_id && v.ativo) ?? null : null;
  const vend = fixo ?? proximoVendedor(equipe ?? [], tentativas);
  if (!vend) return falhar("nenhum vendedor ativo");

  /* modo painel (número compartilhado): o lead aparece no painel do consultor da vez, sem mensagem.
     modo whatsapp: além do painel, o consultor recebe o modelo aprovado no WhatsApp pessoal dele. */
  if (loja.aviso_modo === "whatsapp" && vend.whatsapp) {
    if (!loja.template_aviso_vendedor) return falhar("modelo de aviso não configurado");
    try {
      await enviarAvisoVendedor(loja.phone_number_id, vend.whatsapp, loja.template_aviso_vendedor, paramsAviso(conversa, e,
        repasse ? `Repassado: ninguém respondeu em ${loja.prazo_repasse_min ?? 60} min.` : ""));
    } catch (err) {
      return falhar(String(err));
    }
  }
  if (!fixo) await admin.from("pa_vendedores").update({ ultimo_lead_em: agora }).eq("id", vend.id);
  await admin.from("pa_conversas").update({
    estado: "encaminhada", vendedor_id: vend.id, avisado_em: agora, encaminhado_em: conversa.encaminhado_em ?? agora,
    tentativas: tentativas.includes(vend.id) ? tentativas : [...tentativas, vend.id], resumo: e, fixado_por: fixo ? conversa.fixado_por : null,
  }).eq("id", conversa.id);
  await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "sistema",
    texto: repasse && !fixo ? `repassado para ${vend.nome}: sem resposta em ${loja.prazo_repasse_min ?? 60} min`
      : `encaminhado para ${vend.nome} (${e.motivo})${fixo ? ", a pedido do cliente" : ""}${conversa.estado === "fila" ? ", vindo da fila" : ""}` });
  return { ok: true, vendedor: primeiroNome(vend.nome), nomeado: !!fixo };
}

async function escalarGerente(loja: Linha, conversa: Linha) {
  const agora = new Date().toISOString();
  await admin.from("pa_conversas").update({ escalado_em: agora }).eq("id", conversa.id);
  if (loja.aviso_modo !== "whatsapp") {
    /* modo painel: o lead fica em vermelho no painel do gerente */
    await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "sistema", texto: "rodízio esgotado sem resposta: destacado no painel do gerente" });
    return true;
  }
  if (!loja.gerente_whatsapp || !loja.template_aviso_vendedor) {
    await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "sistema", texto: "rodízio esgotado sem resposta, e não há gerente cadastrado para avisar" });
    return false;
  }
  try {
    await enviarAvisoVendedor(loja.phone_number_id, loja.gerente_whatsapp, loja.template_aviso_vendedor,
      paramsAviso(conversa, conversa.resumo as Encaminhamento, "Ninguém do rodízio respondeu este lead."));
  } catch (err) {
    await registrarErro("aviso ao gerente", err, loja.id, conversa.id);
    return false;
  }
  await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "sistema", texto: `rodízio esgotado: gerente ${loja.gerente_nome ?? ""} avisado`.trim() });
  return true;
}

/* modelo na Meta: "Lead para você: {{1}}, {{2}}. Carro: {{3}}. Origem: {{4}}. {{5}} Responda pelo WhatsApp da loja." */
function paramsAviso(conversa: Linha, e: Encaminhamento, prefixo: string) {
  const detalhe = [prefixo, `Troca: ${e.troca}`, `Pagamento: ${e.pagamento}`, `Visita: ${e.visita}`, `Pendências: ${e.pendencias}`, e.resumo]
    .filter(Boolean).join(" · ");
  return [conversa.lead_nome || "cliente", foneLegivel(conversa.lead_wa), e.veiculo, conversa.origem, detalhe];
}

/* ===== painel de leads ===== */
/* cada pessoa do time entra com usuário e senha. Quem é gerente vê a loja inteira, com os leads dele no topo. */
type Resposta = { status: number; corpo: unknown };
const SAIU: Resposta = { status: 401, corpo: { erro: "Sua sessão terminou. Entre de novo." } };
/* entrou com a senha padrão: só consegue trocar a senha, nada mais */
const TROCAR: Resposta = { status: 403, corpo: { trocar_senha: true, erro: "Troque a senha padrão antes de usar o painel." } };

async function donoDaSessao(sessao: string) {
  if (sessao.length < 32) return null;
  const { data } = await admin.from("pa_sessoes").select("expira_em, pa_vendedores(*)").eq("token_hash", await resumoDoToken(sessao)).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const pessoa = (data as any)?.pa_vendedores;
  return data && new Date(data.expira_em).getTime() > Date.now() && pessoa?.ativo ? pessoa as Linha : null;
}

async function entrarNoPainel(pedido: Linha): Promise<Resposta> {
  const recusa: Resposta = { status: 401, corpo: { erro: "Usuário ou senha incorretos." } };
  const usuario = normalizaUsuario(String(pedido.usuario ?? ""));
  const senha = String(pedido.senha ?? "");
  if (!usuario || !senha || senha.length > 200) return recusa;
  const { data: pessoa } = await admin.from("pa_vendedores").select("*").eq("usuario", usuario).maybeSingle();
  if (!pessoa?.ativo || !pessoa.senha_hash) { await confereSenha(senha, "pbkdf2$100000$00$00"); return recusa; } // mesmo tempo de resposta
  if (pessoa.bloqueado_ate && new Date(pessoa.bloqueado_ate).getTime() > Date.now()) {
    return { status: 429, corpo: { erro: `Muitas tentativas erradas. Tente de novo em ${BLOQUEIO_MIN} minutos ou peça uma senha nova ao gerente.` } };
  }
  if (!(await confereSenha(senha, pessoa.senha_hash))) {
    const falhas = (pessoa.falhas_login ?? 0) + 1;
    await admin.from("pa_vendedores").update(falhas >= MAX_FALHAS
      ? { falhas_login: 0, bloqueado_ate: new Date(Date.now() + BLOQUEIO_MIN * 60_000).toISOString() }
      : { falhas_login: falhas }).eq("id", pessoa.id);
    return recusa;
  }
  await admin.from("pa_vendedores").update({ falhas_login: 0, bloqueado_ate: null }).eq("id", pessoa.id);
  await admin.from("pa_sessoes").delete().eq("vendedor_id", pessoa.id).lt("expira_em", new Date().toISOString());
  const sessao = novoToken();
  await admin.from("pa_sessoes").insert({ token_hash: await resumoDoToken(sessao), vendedor_id: pessoa.id,
    expira_em: new Date(Date.now() + SESSAO_DIAS * 24 * 3600 * 1000).toISOString() });
  return { status: 200, corpo: { sessao, nome: pessoa.nome, trocar_senha: !!pessoa.trocar_senha } };
}

async function sairDoPainel(sessao: string): Promise<Resposta> {
  if (sessao) await admin.from("pa_sessoes").delete().eq("token_hash", await resumoDoToken(sessao));
  return { status: 200, corpo: { ok: true } };
}

async function trocarSenha(sessao: string, pedido: Linha): Promise<Resposta> {
  const pessoa = await donoDaSessao(sessao);
  if (!pessoa) return SAIU;
  const nova = String(pedido.nova ?? "");
  if (!(await confereSenha(String(pedido.atual ?? ""), pessoa.senha_hash))) return { status: 400, corpo: { erro: "A senha atual está errada." } };
  if (nova.length < 6 || nova.length > 100) return { status: 400, corpo: { erro: "A senha nova precisa ter pelo menos 6 caracteres." } };
  if (nova === String(pedido.atual)) return { status: 400, corpo: { erro: "A senha nova precisa ser diferente da atual." } };
  await admin.from("pa_vendedores").update({ senha_hash: await hashSenha(nova), trocar_senha: false }).eq("id", pessoa.id);
  /* derruba as outras sessões: quem sabia a senha antiga sai dos outros aparelhos */
  await admin.from("pa_sessoes").delete().eq("vendedor_id", pessoa.id).neq("token_hash", await resumoDoToken(sessao));
  return { status: 200, corpo: { ok: true } };
}

async function lerPainel(sessao: string): Promise<Resposta> {
  const pessoa = await donoDaSessao(sessao);
  if (!pessoa) return SAIU;
  if (pessoa.trocar_senha) return TROCAR;
  const { data: loja } = await admin.from("pa_lojas").select("*").eq("id", pessoa.loja_id).single();

  const desde = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [{ data: conversas }, { data: equipe }] = await Promise.all([
    admin.from("pa_conversas").select("*").eq("loja_id", loja.id).neq("estado", "encerrada").gte("ultima_msg_em", desde),
    admin.from("pa_vendedores").select("id, nome, usuario, ativo, ordem, no_rodizio, gerente, admin, ultimo_lead_em").eq("loja_id", loja.id),
  ]);
  const nomes = new Map<string, string>((equipe ?? []).map((v: Linha) => [v.id, v.nome]));
  const prazo = loja.prazo_repasse_min ?? 15;
  const hojeSP = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const inicioDoDia = new Date(`${hojeSP}T00:00:00-03:00`).toISOString();
  const cabecalho = { loja: loja.nome, prazo_repasse_min: prazo, horario: situacaoHorario(loja.horario ?? {}).texto, atualizado_em: new Date().toISOString(), nome: pessoa.nome, eu: pessoa.id };
  const meus = painelConsultor(conversas ?? [], pessoa.id, nomes, prazo);
  if (!pessoa.gerente) return { status: 200, corpo: { ...cabecalho, quem: "consultor", ...meus } };
  return { status: 200, corpo: {
    ...cabecalho, quem: "gerente", voce: meus,
    ...painelGerente(conversas ?? [], nomes, prazo, Date.now(), inicioDoDia),
    equipe: equipeDoPainel((equipe ?? []).filter((v: Linha) => !v.admin), conversas ?? []),
    ...(pessoa.admin ? { admin: await dadosDoAdmin(loja, nomes, inicioDoDia) } : {}),
  } };
}

/* administrador da Moza: saúde, erros, números e conversas da semana */
async function dadosDoAdmin(loja: Linha, nomes: Map<string, string>, inicioDoDia: string) {
  const desde = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [{ data: conversas }, { data: erros }, { data: saude }] = await Promise.all([
    admin.from("pa_conversas").select("*").eq("loja_id", loja.id).gte("iniciada_em", desde).order("iniciada_em", { ascending: false }).limit(300),
    admin.from("pa_erros").select("onde, conversa_id, mensagem, vezes, primeiro_em, ultimo_em").or(`loja_id.eq.${loja.id},loja_id.is.null`)
      .gte("ultimo_em", desde).order("ultimo_em", { ascending: false }).limit(50),
    admin.from("pa_saude").select("chave, em, detalhe"),
  ]);
  const ids = (conversas ?? []).map((c: Linha) => c.id);
  const { data: mensagens } = ids.length
    ? await admin.from("pa_mensagens").select("conversa_id, autor, custo_usd").in("conversa_id", ids)
    : { data: [] };
  return painelAdmin({ conversas: conversas ?? [], mensagens: mensagens ?? [], erros: erros ?? [], saude: saude ?? [], vendedores: nomes, lojaAtiva: !!loja.ativo, inicioDoDia });
}

/* a conversa inteira de um lead, com as mensagens do sistema (encaminhamento, repasse, erros), só para o admin */
async function lerConversa(sessao: string, id: string): Promise<Resposta> {
  const pessoa = await donoDaSessao(sessao);
  if (!pessoa) return SAIU;
  if (pessoa.trocar_senha) return TROCAR;
  if (!pessoa.admin) return { status: 403, corpo: { erro: "Só o administrador abre a conversa inteira." } };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 404, corpo: { erro: "Conversa não encontrada." } };
  const { data: conversa } = await admin.from("pa_conversas").select("*").eq("id", id).eq("loja_id", pessoa.loja_id).maybeSingle();
  if (!conversa) return { status: 404, corpo: { erro: "Conversa não encontrada." } };
  const { data: mensagens } = await admin.from("pa_mensagens").select("autor, tipo, texto, custo_usd, criado_em").eq("conversa_id", id).order("id");
  return { status: 200, corpo: { conversa, mensagens: mensagens ?? [] } };
}

/* ações do gerente: passar um lead (inclusive para ele mesmo), ligar e desligar alguém do rodízio, marcar "não é lead" */
async function agirPainel(sessao: string, pedido: Linha): Promise<Resposta> {
  const gerente = await donoDaSessao(sessao);
  if (!gerente) return SAIU;
  if (gerente.trocar_senha) return TROCAR;
  if (!gerente.gerente) return { status: 403, corpo: { erro: "Só o gerente faz mudanças no painel." } };
  const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
  const agora = new Date().toISOString();
  const quem = primeiroNome(gerente.nome);

  if (pedido.acao === "rodizio") {
    const id = uuid(pedido.vendedor_id);
    const { data: pessoa } = id ? await admin.from("pa_vendedores").update({ no_rodizio: !!pedido.no_rodizio })
      .eq("id", id).eq("loja_id", gerente.loja_id).eq("admin", false).select("nome").maybeSingle() : { data: null };
    return pessoa ? { status: 200, corpo: { ok: true } } : { status: 404, corpo: { erro: "Pessoa não encontrada." } };
  }

  /* quem esqueceu a senha: o gerente gera uma nova, vê uma vez e passa para a pessoa. Ela sai de todos os aparelhos
     e troca a senha no próximo acesso. */
  if (pedido.acao === "nova_senha") {
    const id = uuid(pedido.vendedor_id);
    const senha = senhaPadrao();
    const { data: pessoa } = id ? await admin.from("pa_vendedores").update({ senha_hash: await hashSenha(senha), trocar_senha: true, falhas_login: 0, bloqueado_ate: null })
      .eq("id", id).eq("loja_id", gerente.loja_id).eq("admin", false).select("id, nome, usuario").maybeSingle() : { data: null };
    if (!pessoa) return { status: 404, corpo: { erro: "Pessoa não encontrada." } };
    await admin.from("pa_sessoes").delete().eq("vendedor_id", pessoa.id);
    return { status: 200, corpo: { ok: true, nome: pessoa.nome, usuario: pessoa.usuario, senha } };
  }

  const id = uuid(pedido.conversa_id);
  const { data: conversa } = id ? await admin.from("pa_conversas").select("*").eq("id", id).eq("loja_id", gerente.loja_id).neq("estado", "encerrada").maybeSingle() : { data: null };
  if (!conversa) return { status: 404, corpo: { erro: "Esse lead não está mais aberto. Atualize o painel." } };

  if (pedido.acao === "passar") {
    const paraId = uuid(pedido.para);
    const { data: para } = paraId ? await admin.from("pa_vendedores").select("*").eq("id", paraId).eq("loja_id", gerente.loja_id).eq("ativo", true).eq("admin", false).maybeSingle() : { data: null };
    if (!para) return { status: 404, corpo: { erro: "Pessoa não encontrada." } };
    const tentativas: string[] = conversa.tentativas ?? [];
    /* com o robô ou na fila da noite: o robô sai da conversa na hora e quem recebe continua pelo aplicativo */
    await admin.from("pa_conversas").update({
      estado: "encaminhada", vendedor_id: para.id, fixado_por: "gerente", transferido_em: agora, avisado_em: agora, escalado_em: null,
      encaminhado_em: conversa.encaminhado_em ?? agora, tentativas: tentativas.includes(para.id) ? tentativas : [...tentativas, para.id],
      resumo: conversa.resumo ?? { motivo: "passado_pelo_gerente", consultor: "nenhum", veiculo: conversa.origem_detalhe?.veiculo_texto || "ver na conversa",
        troca: "ver na conversa", pagamento: "ver na conversa", visita: "ver na conversa", pendencias: "ver na conversa", resumo: "Passado pelo gerente; a conversa está no WhatsApp da loja." },
    }).eq("id", conversa.id);
    await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "sistema",
      texto: para.id === gerente.id ? `${quem} puxou o lead para si` : `${quem} passou o lead para ${para.nome}` });
    return { status: 200, corpo: { ok: true } };
  }

  if (pedido.acao === "nao_e_lead") {
    await admin.from("pa_conversas").update({ estado: "encerrada" }).eq("id", conversa.id);
    await admin.from("pa_ignorados").upsert({ loja_id: gerente.loja_id, wa: conversa.lead_wa, motivo: `marcado por ${quem}` });
    await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "sistema", texto: `${quem} marcou como "não é lead": o robô não responde mais este contato` });
    return { status: 200, corpo: { ok: true } };
  }
  return { status: 400, corpo: { erro: "Ação desconhecida." } };
}
