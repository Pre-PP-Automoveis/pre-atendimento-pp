// Edge Function: pre-atendimento
// Webhook da WhatsApp Cloud API. O lead escreve primeiro (o robô nunca inicia conversa, item 2.3 do contrato),
// a Claude responde com a ficha da loja, faz a triagem e passa ao vendedor da vez pelo rodízio.
// Estado em pa_conversas e pa_mensagens; os dois carimbos (robô x primeira ação humana) ficam separados.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { lerOrigem, type Referral } from "./origem.ts";
import { agoraSP, contextoTurno, type Loja, promptSistema, situacaoHorario, type Veiculo } from "./prompt.ts";
import { assinaturaValida, enviarAvisoVendedor, enviarTexto, marcarLida } from "./whatsapp.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
/* criado na primeira conversa: sem a chave gravada, o cron e a verificação da Meta continuam de pé */
let _anthropic: Anthropic | null = null;
const anthropic = () => (_anthropic ??= new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") }));
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";

/* USD por token. Cache de 1 hora: escrita a 2x, leitura a 0,1x da entrada. */
const PRECOS: Record<string, { in: number; out: number }> = {
  "claude-sonnet-5": { in: 2 / 1_000_000, out: 10 / 1_000_000 },
  "claude-haiku-4-5": { in: 1 / 1_000_000, out: 5 / 1_000_000 },
};
/* o lead costuma mandar três mensagens em sequência; o robô espera ele terminar e responde uma vez só */
const ESPERA_MS = 5_000;
/* encaminhada e sem mensagem nova por esse tempo, a próxima abre outro atendimento (e outro aviso do 8.5) */
const REABRE_MS = 7 * 24 * 3600 * 1000;
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
  description: "Passa o atendimento ao vendedor da vez, pelo rodízio da loja, com o resumo e o contato do lead. Depois disso você não responde mais este lead: escreva só a mensagem de despedida.",
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
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  /* checagem de saúde para quem tem a chave de serviço do projeto: testa a chave da Anthropic numa chamada
     que não gasta token e diz quais segredos existem, sem mostrar valor nenhum */
  if (url.searchParams.get("saude") !== null) {
    const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!chaveServico || req.headers.get("authorization") !== `Bearer ${chaveServico}`) return new Response("forbidden", { status: 403 });
    let claude = "ok";
    try { await anthropic().models.retrieve("claude-sonnet-5"); } catch (e) { claude = e instanceof Anthropic.APIError ? `erro ${e.status}` : "chave ausente"; }
    const tem = (n: string) => !!Deno.env.get(n);
    return new Response(JSON.stringify({
      anthropic: claude,
      segredos: { ANTHROPIC_API_KEY: tem("ANTHROPIC_API_KEY"), WHATSAPP_TOKEN: tem("WHATSAPP_TOKEN"), WHATSAPP_APP_SECRET: tem("WHATSAPP_APP_SECRET"), WHATSAPP_VERIFY_TOKEN: tem("WHATSAPP_VERIFY_TOKEN") },
    }), { headers: { "Content-Type": "application/json" } });
  }

  /* cron do banco (pg_cron + pg_net), a cada 5 minutos: avisa os vendedores da fila das lojas que abriram */
  const cron = req.headers.get("x-cron-secret");
  if (cron !== null) {
    const { data: ok } = await admin.rpc("pa_confere_cron", { segredo: cron });
    if (ok !== true) return new Response("forbidden", { status: 403 });
    const despachados = await despacharFila();
    return new Response(JSON.stringify({ despachados }), { headers: { "Content-Type": "application/json" } });
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
      if (change?.field !== "messages") continue;
      const v = change.value ?? {};
      const phoneNumberId = v.metadata?.phone_number_id;
      if (!phoneNumberId || !v.messages?.length) continue; // status de entrega e leitura: ignorados
      const { data: loja } = await admin.from("pa_lojas").select("*").eq("phone_number_id", phoneNumberId).eq("ativo", true).maybeSingle();
      if (!loja) { console.warn("número sem loja ativa", phoneNumberId); continue; }
      const nomes = Object.fromEntries((v.contacts ?? []).map((c: Linha) => [c.wa_id, c.profile?.name]));
      for (const msg of v.messages) {
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

async function tratarMensagem(loja: Linha, msg: Linha, nomePerfil: string | null) {
  /* vendedor tocando em "Assumi" no aviso: é o carimbo da primeira ação humana */
  const { data: vendedor } = await admin.from("pa_vendedores").select("*").eq("loja_id", loja.id).eq("whatsapp", msg.from).maybeSingle();
  if (vendedor) {
    const payload: string = msg.button?.payload ?? msg.interactive?.button_reply?.id ?? "";
    if (payload.startsWith("assumi:")) {
      await admin.from("pa_conversas").update({ primeira_acao_humana_em: new Date().toISOString() })
        .eq("id", payload.slice(7)).is("primeira_acao_humana_em", null);
      await enviarTexto(loja.phone_number_id, msg.from, "Anotado, o lead está com você.").catch(() => undefined);
    }
    return;
  }

  const texto = textoDe(msg);
  const conversa = await abrirConversa(loja, msg, texto, nomePerfil);

  const { error: dup } = await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "lead", tipo: msg.type, texto, wa_id: msg.id });
  if (dup) { if (dup.code === "23505") return; throw dup; } // reentrega da Meta: já tratada
  await admin.from("pa_conversas").update({ ultima_msg_em: new Date().toISOString(), ...(nomePerfil ? { lead_nome: nomePerfil } : {}) }).eq("id", conversa.id);
  await marcarLida(loja.phone_number_id, msg.id);

  if (conversa.estado === "encaminhada" || conversa.estado === "fila") return lembrarVendedor(loja, conversa);

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
    const parada = Date.now() - new Date(aberta.ultima_msg_em).getTime() > REABRE_MS;
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

async function lembrarVendedor(loja: Linha, conversa: Linha) {
  const { data: ultimoRobo } = await admin.from("pa_mensagens").select("criado_em").eq("conversa_id", conversa.id).eq("autor", "robo")
    .order("id", { ascending: false }).limit(1).maybeSingle();
  if (ultimoRobo && Date.now() - new Date(ultimoRobo.criado_em).getTime() < LEMBRETE_MS) return;
  const { data: vend } = conversa.vendedor_id
    ? await admin.from("pa_vendedores").select("nome").eq("id", conversa.vendedor_id).maybeSingle()
    : { data: null };
  const quem = primeiroNome(vend?.nome);
  const abre = situacaoHorario(loja.horario ?? {}).abre;
  const texto = conversa.estado === "fila"
    ? `Seu atendimento já está anotado. Um vendedor te chama assim que a loja abrir${abre ? `, ${abre}` : ""}.`
    : quem
    ? `Seu atendimento já está com o ${quem}, ele te chama pelo WhatsApp dele. Se preferir, pode falar direto com ele.`
    : "Seu atendimento já está com o time de vendas, alguém te chama em instantes.";
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

      const resultado = await encaminhar(loja, conversa, chamada.input as Encaminhamento);
      encaminhado = resultado;
      messages.push({ role: "assistant", content: resp.content });
      messages.push({ role: "user", content: [{
        type: "tool_result", tool_use_id: chamada.id, is_error: !resultado.ok,
        content: resultado.fila
          ? `A loja está fechada. O atendimento ficou anotado e o vendedor da vez recebe o resumo quando a loja abrir, ${resultado.abre ?? "no próximo horário de funcionamento"}. Diga isso ao lead e despeça-se.`
          : resultado.ok
            ? `Encaminhado para ${resultado.vendedor}. Escreva só a despedida.`
            : `Não foi possível avisar um vendedor agora (${resultado.erro}). Diga que o time de vendas vai retomar a conversa e despeça-se.`,
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
      ? `Recebi sua mensagem. Um vendedor te atende assim que a loja abrir${encaminhado.abre ? `, ${encaminhado.abre}` : ""}.`
      : "Recebi sua mensagem. Uma pessoa do nosso time de vendas já vai te responder.");
  }

  if (!textos.length && encaminhado?.fila) textos.push(`Anotei tudo. Um vendedor te chama assim que a loja abrir${encaminhado.abre ? `, ${encaminhado.abre}` : ""}.`);
  else if (!textos.length && encaminhado?.vendedor) textos.push(`Passei tudo para o ${encaminhado.vendedor}, ele te chama em instantes.`);
  if (!textos.length) return;
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

/* chamado pelo cron: despacha a fila de cada loja ativa que já abriu, na ordem em que os leads chegaram */
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

/* ===== rodízio sequencial: recebe quem está há mais tempo sem lead, como a distribuição do BNDV ===== */
async function avisarVendedor(loja: Linha, conversa: Linha): Promise<Resultado> {
  const e = conversa.resumo as Encaminhamento;
  const veioDaFila = conversa.estado === "fila";
  const agora = new Date().toISOString();
  const marcar = (vendedorId: string | null, erro?: string) =>
    admin.from("pa_conversas").update({
      /* falha na fila fica na fila, e o cron tenta de novo em 5 minutos */
      estado: erro && veioDaFila ? "fila" : "encaminhada",
      vendedor_id: vendedorId, encaminhado_em: erro ? null : agora, resumo: { ...e, ...(erro ? { erro } : {}) },
    }).eq("id", conversa.id);

  const { data: vend } = await admin.from("pa_vendedores").select("*").eq("loja_id", loja.id).eq("ativo", true)
    .order("ultimo_lead_em", { ascending: true, nullsFirst: true }).order("ordem").limit(1).maybeSingle();
  if (!vend) { await marcar(null, "nenhum vendedor ativo"); return { ok: false, vendedor: null, erro: "nenhum vendedor ativo" }; }
  if (!loja.template_aviso_vendedor) { await marcar(null, "modelo de aviso não configurado"); return { ok: false, vendedor: null, erro: "modelo de aviso não configurado" }; }

  const detalhe = [`Troca: ${e.troca}`, `Pagamento: ${e.pagamento}`, `Prazo: ${e.prazo}`, `Pendências: ${e.pendencias}`, e.resumo].join(" · ");
  try {
    /* modelo na Meta: "Novo lead: {{1}}, wa.me/{{2}}. Carro: {{3}}. Origem: {{4}}. {{5}}" + botão "Assumi" */
    await enviarAvisoVendedor(loja.phone_number_id, vend.whatsapp, loja.template_aviso_vendedor,
      [conversa.lead_nome || "cliente", conversa.lead_wa, e.veiculo, conversa.origem, detalhe], `assumi:${conversa.id}`);
  } catch (err) {
    await marcar(null, String(err));
    return { ok: false, vendedor: null, erro: "falha ao avisar o vendedor" };
  }
  await admin.from("pa_vendedores").update({ ultimo_lead_em: agora }).eq("id", vend.id);
  await marcar(vend.id);
  await admin.from("pa_mensagens").insert({ conversa_id: conversa.id, autor: "sistema", texto: `encaminhado para ${vend.nome} (${e.motivo})${veioDaFila ? ", vindo da fila" : ""}` });
  return { ok: true, vendedor: primeiroNome(vend.nome) };
}
