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
    required: ["motivo", "veiculo", "troca", "pagamento", "visita", "pendencias", "resumo"],
    properties: {
      motivo: { type: "string", enum: ["qualificado", "pediu_pessoa", "negociacao", "fora_do_escopo", "midia"] },
      veiculo: { type: "string", description: "Carro de interesse como a pessoa ou o anúncio disse. \"não identificado\" se não souber." },
      troca: { type: "string", description: "Carro da troca (modelo, ano, km) como a pessoa disse, ou \"não tem\" / \"não perguntado\" / \"não respondeu\"." },
      pagamento: { type: "string", description: "À vista, financiamento, cartão, entrada, ou \"não perguntado\" / \"não respondeu\"." },
      visita: { type: "string", description: "O que disse sobre ir à loja (quer ir, quando, não pode), ou \"não perguntado\" / \"não respondeu\"." },
      pendencias: { type: "string", description: "Perguntas que ficaram para o consultor responder, ou \"nenhuma\"." },
      resumo: { type: "string", description: "Uma frase para o consultor sobre o que a pessoa quer." },
    },
  },
};

export type Encaminhamento = { motivo: string; veiculo: string; troca: string; pagamento: string; visita: string; pendencias: string; resumo: string };
export type Resultado = { ok: boolean; vendedor: string | null; fila?: boolean; abre?: string | null; erro?: string };

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
  r.fila
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
}): Promise<Turno> {
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
    const resultado = await p.aoEncaminhar(e);
    if (!resultado) { t.interrompido = true; return t; }
    t.encaminhado = resultado; t.encaminhamento = e;
    p.messages.push({ role: "assistant", content: resp.content });
    p.messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: chamada.id, is_error: !resultado.ok, content: resultadoParaModelo(resultado) }] });
    t.textos.length = 0; // o que veio antes da chamada era preâmbulo; vale a despedida
  }
  return t;
}

/* aviso do item 8.5 do contrato, anexado em texto fixo à primeira resposta (pa_lojas.aviso_inicial manda, se existir) */
export const AVISO_PADRAO = (nome: string) =>
  `Este é o atendimento automático da ${nome}. Seus dados são usados só para o atendimento comercial da loja, e se preferir falar com uma pessoa do time é só pedir.`;

/* despedida de reserva, quando o modelo encaminhou e não escreveu nada */
export const despedidaPadrao = (r: Resultado) =>
  r.fila
    ? `Anotei tudo. Um consultor continua a conversa aqui mesmo assim que a loja abrir${r.abre ? `, ${r.abre}` : ""}.`
    : "Anotei tudo. Um consultor continua a conversa aqui mesmo em instantes.";
