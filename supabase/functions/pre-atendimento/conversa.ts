// Um turno do robô com a Claude: monta as mensagens, chama o modelo, executa o encaminhamento se ele pedir e
// devolve o texto a enviar. É o mesmo código no atendimento real (index.ts) e no simulador (simulador.ts):
// o que o simulador mostra é o que o lead vai receber.
import Anthropic from "npm:@anthropic-ai/sdk";

/* USD por token. Cache de 1 hora: escrita a 2x, leitura a 0,1x da entrada. */
export const PRECOS: Record<string, { in: number; out: number }> = {
  "claude-sonnet-5": { in: 2 / 1_000_000, out: 10 / 1_000_000 },
  "claude-haiku-4-5": { in: 1 / 1_000_000, out: 5 / 1_000_000 },
};

/* a única ação que o robô toma no mundo */
export const ENCAMINHAR: Anthropic.Tool = {
  name: "encaminhar_ao_vendedor",
  description: "Passa o atendimento ao time de vendas: o consultor da vez recebe o resumo e continua a conversa neste mesmo número. Depois disso você não responde mais este lead: escreva só a mensagem de despedida.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["motivo", "consultor", "veiculo", "troca", "pagamento", "visita", "pendencias", "resumo"],
    properties: {
      motivo: { type: "string", enum: ["qualificado", "pediu_pessoa", "negociacao", "fora_do_escopo", "midia"] },
      consultor: { type: "string", description: "Primeiro nome da pessoa do time que o cliente chamou, pediu ou disse que o indicou, se for alguém da lista do time (apelido e nome completo contam). \"nenhum\" nos outros casos (o nome da loja não conta)." },
      veiculo: { type: "string", description: "Carro de interesse como a pessoa ou o anúncio disse. \"não identificado\" se não souber." },
      troca: { type: "string", description: "Carro da troca (modelo, ano, km) como a pessoa disse, ou \"não tem\" / \"não perguntado\" / \"não respondeu\"." },
      pagamento: { type: "string", description: "À vista, financiamento, cartão, entrada, ou \"não perguntado\" / \"não respondeu\"." },
      visita: { type: "string", description: "O que disse sobre ir à loja (quer ir, quando, não pode). \"convidado, sem resposta\" só se você mandou o endereço nesta conversa; senão \"não convidado\"." },
      pendencias: { type: "string", description: "Perguntas que ficaram para o consultor responder, ou \"nenhuma\"." },
      resumo: { type: "string", description: "Uma frase para o consultor sobre o que a pessoa quer." },
    },
  },
};

export type Encaminhamento = { motivo: string; consultor?: string; veiculo: string; troca: string; pagamento: string; visita: string; pendencias: string; resumo: string };
export type Resultado = { ok: boolean; vendedor: string | null; nomeado?: boolean; fila?: boolean; abre?: string | null; erro?: string };

/* lead vira user, robô vira assistant; mensagens seguidas do mesmo lado viram um turno só.
   O contexto do momento (hora, origem, carro) vai junto da última mensagem do lead. */
export function montarMensagens(historico: { autor: string; texto: string }[], contexto: string): Anthropic.MessageParam[] | null {
  const messages: Anthropic.MessageParam[] = [];
  for (const m of historico) {
    if (m.autor !== "lead" && m.autor !== "robo") continue;
    const role = m.autor === "lead" ? "user" : "assistant";
    const ult = messages[messages.length - 1];
    if (ult?.role === role) ult.content = `${ult.content}\n${m.texto}`;
    else if (messages.length || role === "user") messages.push({ role, content: m.texto });
  }
  const ultimo = messages[messages.length - 1];
  if (ultimo?.role !== "user") return null;
  ultimo.content = [{ type: "text", text: ultimo.content as string }, { type: "text", text: contexto }];
  return messages;
}

const resultadoParaModelo = (r: Resultado) =>
  r.nomeado && r.vendedor
    ? `${r.vendedor} recebeu o resumo e continua a conversa aqui mesmo, neste número, ${r.fila ? `quando a loja abrir, ${r.abre ?? "no próximo horário de funcionamento"}` : "em instantes"}. Escreva só a despedida, dizendo que é ${r.vendedor} quem continua.`
    : r.fila
    ? `A loja está fechada. O atendimento ficou anotado e um consultor continua a conversa aqui mesmo, neste número, quando a loja abrir, ${r.abre ?? "no próximo horário de funcionamento"}. Diga isso ao lead e despeça-se.`
    : r.ok
      ? "O consultor da vez recebeu o resumo e continua a conversa aqui mesmo, neste número. Escreva só a despedida, sem citar nome."
      : `Não foi possível avisar o consultor da vez agora (${r.erro}). Diga que um consultor continua a conversa aqui mesmo em instantes e despeça-se.`;

export type Turno = {
  textos: string[]; custo: number;
  encaminhado: Resultado | null; encaminhamento: Encaminhamento | null;
  interrompido: boolean; // a conversa saiu do robô enquanto a Claude pensava
};

/* aoEncaminhar devolve null quando a conversa já não é do robô (o time ou o cron levaram): o turno para ali */
export async function rodarTurno(p: {
  cliente: Anthropic; modelo: string; sistema: string; messages: Anthropic.MessageParam[];
  aoEncaminhar: (e: Encaminhamento) => Promise<Resultado | null>;
  /* devolve uma instrução quando o encaminhamento ainda não pode acontecer (o modelo recebe e segue a conversa) */
  validar?: (e: Encaminhamento) => string | null;
}): Promise<Turno> {
  let recusas = 0;
  const precos = PRECOS[p.modelo] ?? PRECOS["claude-sonnet-5"];
  const t: Turno = { textos: [], custo: 0, encaminhado: null, encaminhamento: null, interrompido: false };
  for (let volta = 0; volta < 3; volta++) {
    const resp = await p.cliente.messages.create({
      model: p.modelo,
      max_tokens: 2048,
      /* triagem de roteiro fechado: esforço baixo responde rápido e custa menos. Haiku 4.5 não aceita effort. */
      ...(p.modelo.startsWith("claude-haiku") ? {} : { output_config: { effort: "low" as const } }),
      system: [{ type: "text", text: p.sistema, cache_control: { type: "ephemeral", ttl: "1h" } }],
      tools: [ENCAMINHAR],
      messages: p.messages,
    });
    const u = resp.usage;
    t.custo += u.input_tokens * precos.in + u.output_tokens * precos.out +
      (u.cache_creation_input_tokens ?? 0) * precos.in * 2 + (u.cache_read_input_tokens ?? 0) * precos.in * 0.1;
    if (resp.stop_reason === "refusal") throw new Error("resposta recusada pelo modelo");

    for (const b of resp.content) if (b.type === "text" && b.text.trim()) t.textos.push(b.text.trim());
    const chamada = resp.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (resp.stop_reason !== "tool_use" || !chamada) break;

    const e = chamada.input as Encaminhamento;
    const objecao = recusas === 0 ? p.validar?.(e) ?? null : null;
    if (objecao) {
      recusas++;
      p.messages.push({ role: "assistant", content: resp.content });
      p.messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: chamada.id, is_error: true, content: objecao }] });
      t.textos.length = 0;
      continue;
    }
    const resultado = await p.aoEncaminhar(e);
    if (!resultado) { t.interrompido = true; return t; }
    t.encaminhado = resultado; t.encaminhamento = e;
    p.messages.push({ role: "assistant", content: resp.content });
    p.messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: chamada.id, is_error: !resultado.ok, content: resultadoParaModelo(resultado) }] });
    t.textos.length = 0; // o que veio antes da chamada era preâmbulo; vale a despedida
  }
  return t;
}

/* Abertura da primeira resposta, em texto fixo (pa_lojas.aviso_inicial manda, se existir). Tom de consultoria, com o nome da
   assistente, sem falar em robô ou assistente virtual (Kauan, 07/10/2026); diz para que servem os dados e que dá para pedir
   um consultor. Cumprimento pela hora de São Paulo e pelo primeiro nome do perfil, se parecer nome.
   Atenção: o item 8.5 do contrato pede dizer na primeira mensagem que a conversa é automatizada; o Kauan decidiu tirar. */
export function abertura(p: { loja: string; assistente?: string | null; nomeDoLead?: string | null; quando?: Date }) {
  const hora = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(p.quando ?? new Date()));
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const primeiro = (p.nomeDoLead ?? "").trim().split(/\s+/)[0] ?? "";
  /* perfil com número ou com cara de empresa ("AUTO PEÇAS 123", "Loja do Zé") não vira nome de gente */
  const empresa = /\d|\b(ltda|me|eireli|auto|autos|pe[cç]as|ve[ií]culos|loja|motors?|multimarcas|oficial|store|com[eé]rcio|servi[cç]os|distribuidora)\b/i.test(p.nomeDoLead ?? "");
  const nome = !empresa && /^[A-Za-zÀ-ÿ]{2,15}$/.test(primeiro) ? primeiro[0].toUpperCase() + primeiro.slice(1).toLowerCase() : "";
  const quem = p.assistente ? `Sou a ${p.assistente}, assistente da ${p.loja}` : `Sou a assistente da ${p.loja}`;
  return `${saudacao}${nome ? `, ${nome}` : ""}! ${quem}. Vou iniciar o seu atendimento e fazer uma triagem rápida para encontrar o carro ideal para você. ` +
    "Seus dados ficam só com a loja, e se preferir falar direto com um consultor é só pedir.";
}

/* A abertura já cumprimenta e apresenta a assistente. Se o modelo cumprimentar ou se apresentar de novo, sai:
   o cliente leria "boa tarde" e a apresentação duas vezes. A apresentação fica quando o cliente perguntou se é robô. */
export function semAvisoRepetido(texto: string, mensagemDoLead: string) {
  /* cumprimento solto no começo ("Boa tarde, Gustavo!", "Oi!") sai sempre: a abertura já cumprimentou */
  const semOi = texto.replace(/^\s*(oi|ol[aá]|bom dia|boa tarde|boa noite)\b[^.!?\n]{0,30}[!.]\s*/i, "").trim();
  texto = semOi.length >= 12 ? semOi[0].toUpperCase() + semOi.slice(1) : texto;
  /* marcações do sistema ("[a pessoa mandou um áudio…]") não contam como pergunta do cliente */
  if (/rob[oô]|autom[aá]tic|virtual|pessoa|humano|atendente|quem (é|e) voc/i.test(mensagemDoLead.replace(/\[[^\]]*\]/g, ""))) return texto;
  /* "Sou a Bia, assistente da loja" de novo: a frase sai */
  texto = texto.split(/(?<=[.!?])\s+/).filter((f) => !/assistente (virtual )?d[ae]|assistente virtual|^(eu )?sou (a|o) [A-ZÀ-Ú]\p{L}+[,.!]|^aqui (é|e) (a|o) [A-ZÀ-Ú]\p{L}+[,.!]|^me chamo /u.test(f)).join(" ") || texto;
  /* tira só o trecho em que ele se anuncia; a frase some inteira apenas se não sobrar conteúdo */
  const trecho = /(,\s*)?((este|esse|aqui)\s+)?(é\s+)?(?<![\p{L}])(o\s+)?atendimento\s+(é\s+)?autom[aá]tico(\s+da\s+(?:(?!\s+e\s+)[^,.!?])*)?(\s+e\s+|\s*,\s*|\s*[.!]\s*)?/iu;
  const frases = texto.split(/(?<=[.!?])\s+/).map((f) => {
    /* o robô comentando o aviso ("Esse aviso aqui é automático, já te explico"): sai, ou fica só o que vem depois dos dois-pontos */
    if (/\baviso\b/i.test(f)) {
      const depois = f.includes(":") ? f.slice(f.indexOf(":") + 1).trim() : "";
      return depois.length < 12 ? "" : depois[0].toUpperCase() + depois.slice(1);
    }
    if (!trecho.test(f)) return f;
    /* "Oi! Esse é o atendimento automático, e infelizmente..." não pode virar "E infelizmente..." */
    const resto = f.replace(trecho, " ").replace(/^\W+/, "").replace(/^(e|por isso|ent[aã]o|mas)\s+/i, "").replace(/\s{2,}/g, " ").trim();
    return resto.length < 12 ? "" : resto[0].toUpperCase() + resto.slice(1);
  }).filter(Boolean);
  return (frases.length ? frases.join(" ") : texto).trim();
}

/* regra da casa: nunca travessão. Hífen ou travessão soltos entre espaços viram vírgula */
export const semTravessao = (t: string) => t.replace(/\s+[—–-]\s+/g, ", ");

/* ===== memória da conversa: o código lê o histórico e diz ao robô o que já foi feito, para ele não repetir ===== */
const TEMAS: Record<string, { pergunta: RegExp; resposta: RegExp; nome: string }> = {
  troca: { pergunta: /troca/i, resposta: /troca|tenho um|tenho uma|n[aã]o tenho|meu carro|minha moto|\b(19|20)\d{2}\b/i, nome: "carro na troca" },
  pagamento: { pergunta: /[àa] vista|financ|cart[aã]o|pagar|pagamento/i, resposta: /[àa] vista|financ|cart[aã]o|entrada|parcel/i, nome: "forma de pagamento" },
  visita: { pergunta: /passar na loja|de perto|visita|vir at[ée] a loja/i, resposta: /passo|passar|vou a[ií]|amanh[aã]|hoje|s[aá]bado|semana|n[aã]o (posso|consigo)/i, nome: "visita à loja" },
};
type Msg = { autor: string; texto: string };

export function notasDaConversa(historico: Msg[], endereco: string | null, primeiroNome: string | null): string[] {
  const notas: string[] = [];
  const robo = historico.filter((m) => m.autor === "robo");
  const lead = historico.filter((m) => m.autor === "lead");
  const falasDoLead = lead.map((m) => m.texto.replace(/\[[^\]]*\]/g, "")).join(" \n ");
  for (const [chave, tema] of Object.entries(TEMAS)) {
    const disse = lead.map((m) => m.texto).find((t) => tema.resposta.test(t) && (chave !== "troca" || /troca|tenho|n[aã]o tenho/i.test(t)));
    if (disse) { notas.push(`A pessoa já falou de ${tema.nome}: "${disse.slice(0, 80)}". Use isso e não pergunte de novo.`); continue; }
    /* perguntou nas duas últimas mensagens e a resposta não veio: não insistir agora */
    const perguntou = robo.slice(-2).some((m) => (m.texto.match(/[^.!?]*\?/g) ?? []).some((q) => tema.pergunta.test(q)));
    if (perguntou && !tema.resposta.test(falasDoLead)) notas.push(`Você já perguntou sobre ${tema.nome} e a pessoa não respondeu. Não pergunte de novo agora; responda o que ela perguntou.`);
  }
  const rua = (endereco ?? "").split(",")[0];
  if (rua && robo.some((m) => m.texto.includes(rua))) notas.push("O endereço já foi enviado nesta conversa. Não mande de novo, a não ser que a pessoa peça.");
  const ultima = robo[robo.length - 1]?.texto ?? "";
  if (primeiroNome && new RegExp(`\\b${primeiroNome}\\b`, "i").test(ultima)) notas.push(`Você usou o nome ${primeiroNome} na mensagem anterior. Não use nesta.`);
  return notas;
}

/* o resumo ao consultor não pode dizer "convidado" se o endereço nunca foi enviado */
export function visitaReal(visita: string, historico: Msg[], endereco: string | null) {
  const rua = (endereco ?? "").split(",")[0];
  const enviado = !!rua && historico.some((m) => m.autor === "robo" && m.texto.includes(rua));
  return !enviado && /convidad/i.test(visita) ? "não convidado" : visita;
}

/* lead qualificado só vai ao consultor depois do convite com o endereço (o que mais leva a visita, nas conversas reais) */
export function exigirConvite(historico: Msg[], endereco: string | null) {
  return (e: Encaminhamento) => {
    if (e.motivo !== "qualificado" || !endereco) return null;
    if (e.consultor && !/^nenhum/i.test(e.consultor.trim())) return null; // pediu alguém pelo nome: vai direto para essa pessoa
    if (/hoje|amanh[aã]|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|\d+\s*h/i.test(e.visita)) return null; // já disse quando vem
    const rua = endereco.split(",")[0];
    if (historico.some((m) => m.autor === "robo" && m.texto.includes(rua))) return null;
    return `Não encaminhe ainda. Responda à última mensagem da pessoa como uma mensagem normal da conversa e, nela, convide para ver o carro na loja com o endereço: ${endereco}. Não diga que já mandou o endereço, não fale de encaminhamento, de consultor esperando nem desta instrução.`;
  };
}

/* frases-padrão de atendimento que soam robóticas: saem, se sobrar texto */
const ABERTURA_FEITA = /^(show|perfeito|[oó]timo|legal|entendido)\b[,!.]?\s*/i;
export function semFrasesFeitas(texto: string) {
  /* bastidor nunca chega ao cliente, nem quando é o que sobra: o resto é acabamento e volta se apagar tudo */
  const frases = texto.split(/(?<=[.!?])\s+/)
    .filter((f) => !/antes de encaminhar|aguardar a resposta d|vou aguardar|instru[cç][aã]o|encaminhamento|^j[aá] (te )?aviso antes/i.test(f));
  const limpas = frases.filter((f) => !/posso te ajudar com (mais|outras?)|posso ajudar em mais|qualquer coisa,? (estou|t[ôo]) por aqui|em que (mais )?posso ajudar/i.test(f))
    /* pedir licença para passar ao consultor: o roteiro manda passar, não perguntar */
    .filter((f) => !/quer que eu (j[aá] )?(te )?(encaminhe|passe|coloque)|prefere que eu (te )?(encaminhe|passe|coloque)|posso (j[aá] )?te (colocar em contato|passar para|passar pr[oa])/i.test(f))
    .filter((f) => !/^at[ée] j[aá]!?$/i.test(f.trim()))
    .map((f) => f.replace(/,\s*show([.!])$/i, "$1"))
    /* opinião sobre o modelo que não está na ficha */
    .map((f) => f.replace(/,?\s*mas [^.?!]*\b(costuma|geralmente|normalmente)\b[^.?!]*/i, ""))
    .filter((f) => !/\b(costuma|geralmente|normalmente) (ser|vir|ter)\b/i.test(f))
    /* "Perfeito, Carla." sozinho cai; "Show, Marcos, já anotei" vira "Marcos, já anotei" */
    .map((f, i) => {
      if (i > 0 || !ABERTURA_FEITA.test(f)) return f;
      const resto = f.replace(ABERTURA_FEITA, "").trim();
      if (!resto || /^[\p{L}]+(\s[\p{L}]+){0,2}[.!]?$/u.test(resto)) return ""; // sobrou só o nome da pessoa
      return resto[0].toUpperCase() + resto.slice(1);
    })
    .filter(Boolean);
  return (limpas.length ? limpas : frases).join(" ").trim();
}

/* "um consultor pode continuar por aqui" num turno em que ninguém foi chamado é promessa que não acontece */
export function semPromessaAntesDaHora(texto: string, encaminhado: boolean) {
  if (encaminhado) return texto;
  const frases = texto.split(/(?<=[.!?])\s+/);
  const limpas = frases.filter((f) => !/\bconsultor\b.{0,25}\b(pode continuar|continua (com voc[eê]|por aqui|a conversa|aqui))/i.test(f));
  return (limpas.length ? limpas : frases).join(" ").trim();
}

/* pergunta da triagem feita na mensagem anterior e ainda sem resposta não volta na mensagem seguinte */
export function semPerguntaRepetida(texto: string, historico: Msg[]) {
  const anterior = [...historico].reverse().find((m) => m.autor === "robo")?.texto ?? "";
  const falasDoLead = historico.filter((m) => m.autor === "lead").map((m) => m.texto).join(" \n ");
  const pendentes = Object.values(TEMAS).filter((t) =>
    (anterior.match(/[^.!?]*\?/g) ?? []).some((q) => t.pergunta.test(q)) && !t.resposta.test(falasDoLead));
  if (!pendentes.length) return texto;
  const frases = texto.split(/(?<=[.!?])\s+/);
  const limpas = frases.filter((f) => !(f.trim().endsWith("?") && pendentes.some((t) => t.pergunta.test(f))));
  return (limpas.length ? limpas : frases).join(" ").trim();
}

/* Robô, inteligência artificial, assistente virtual ou atendimento automático só aparecem se o cliente perguntou
   (Kauan, 07/10/2026). Perguntado de verdade, a assistente não nega: confirma que a triagem é automática e oferece o consultor. */
const PERGUNTOU_SE_E_ROBO = /rob[oô]|\bbot\b|autom[aá]tic|virtual|intelig[eê]ncia artificial|\bia\b|chatgpt|pessoa de verdade|humano|gente de verdade|quem (é|e|ta|tá) (voc|falando)/i;
export function semMencaoDeRobo(texto: string, historico: Msg[]) {
  const ultimaDoLead = [...historico].reverse().find((m) => m.autor === "lead")?.texto ?? "";
  if (PERGUNTOU_SE_E_ROBO.test(ultimaDoLead.replace(/\[[^\]]*\]/g, ""))) return texto;
  const frases = texto.split(/(?<=[.!?])\s+/);
  /* fronteira com \p{L}: o \b do JavaScript não enxerga "ô" como letra e deixava "robô" passar */
  const limpas = frases.filter((f) => !/(?<!\p{L})rob[oô](?!\p{L})|intelig[eê]ncia artificial|(?<!\p{L})IA(?!\p{L})|assistente virtual|autom[aá]tic[oa]|(?<!\p{L})sistema(?!\p{L})/u.test(f));
  return (limpas.length ? limpas : frases).join(" ").trim();
}

/* tudo o que passa pelo texto do robô antes de sair, igual no atendimento real e no simulador */
export const polir = (texto: string, historico: Msg[], encaminhado: boolean) =>
  semMencaoDeRobo(semPerguntaRepetida(semPromessaAntesDaHora(semFrasesFeitas(semTravessao(texto)), encaminhado), historico), historico);

/* despedida de reserva, quando o modelo encaminhou e não escreveu nada */
export const despedidaPadrao = (r: Resultado) => {
  const quem = r.nomeado && r.vendedor ? r.vendedor : "Um consultor";
  return r.fila
    ? `Anotei tudo. ${quem} continua a conversa aqui mesmo assim que a loja abrir${r.abre ? `, ${r.abre}` : ""}.`
    : `Anotei tudo. ${quem} continua a conversa aqui mesmo em instantes.`;
};
