// Prompt do pré-atendimento. Duas partes:
// - sistema: régua, fronteira do contrato, voz da loja e estoque. Igual em toda chamada da loja, vai em cache.
// - contexto do turno: hora, loja aberta ou não, origem e o carro do anúncio. Muda a cada vez, então vai
//   junto da última mensagem do lead e nunca no sistema (qualquer byte diferente ali invalida o cache).

export type Loja = {
  id: string; nome: string; voz: string; endereco: string;
  horario: Record<string, [string, string] | null>;
};
export type Veiculo = {
  id: string; titulo: string; disponivel: boolean; preco: number | null; km: number | null;
  leilao: string | null; laudo_cautelar: string | null; unico_dono: string | null; observacoes: string | null;
  anuncios: Record<string, string>;
};

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const NOME_DIA: Record<string, string> = { dom: "domingo", seg: "segunda", ter: "terça", qua: "quarta", qui: "quinta", sex: "sexta", sab: "sábado" };
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/* hora de São Paulo, nunca UTC */
export function agoraSP(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    day: "2-digit", month: "2-digit",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const dia = DIAS[["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday)];
  return { dia, hhmm: `${p.hour}:${p.minute}`, data: `${p.day}/${p.month}` };
}

/* loja aberta agora? se não, quando abre ("amanhã às 08:00"), que é quando o vendedor recebe o lead */
export function situacaoHorario(horario: Loja["horario"], d = new Date()) {
  const { dia, hhmm } = agoraSP(d);
  const hoje = horario[dia];
  if (hoje && hhmm >= hoje[0] && hhmm < hoje[1]) return { aberta: true, abre: null, texto: `loja aberta até ${hoje[1]}` };
  if (hoje && hhmm < hoje[0]) return { aberta: false, abre: `hoje às ${hoje[0]}`, texto: `loja fechada; abre hoje às ${hoje[0]}` };
  for (let i = 1; i <= 7; i++) {
    const prox = DIAS[(DIAS.indexOf(dia) + i) % 7];
    const h = horario[prox];
    if (h) {
      const abre = `${i === 1 ? "amanhã" : NOME_DIA[prox]} às ${h[0]}`;
      return { aberta: false, abre, texto: `loja fechada; abre ${abre}` };
    }
  }
  return { aberta: false, abre: null, texto: "horário da loja não cadastrado; não prometa quando uma pessoa retoma" };
}

/* a ficha vai como está: o item 2.4 do contrato manda reproduzir sem alterar */
export function linhaFicha(v: Veiculo) {
  const campos = [
    `disponível: ${v.disponivel ? "sim" : "não"}`,
    v.preco != null ? `preço anunciado: ${brl(v.preco)}` : null,
    v.km != null ? `km: ${v.km.toLocaleString("pt-BR")}` : null,
    v.leilao ? `leilão: ${v.leilao}` : null,
    v.laudo_cautelar ? `laudo cautelar: ${v.laudo_cautelar}` : null,
    v.unico_dono ? `único dono: ${v.unico_dono}` : null,
    v.observacoes ? `observações: ${v.observacoes}` : null,
  ].filter(Boolean);
  return `- [${v.id.slice(0, 8)}] ${v.titulo} | ${campos.join(" | ")}`;
}

export function promptSistema(loja: Loja, estoque: Veiculo[]) {
  const horario = DIAS.map((d) => `${NOME_DIA[d]}: ${loja.horario[d] ? loja.horario[d]!.join(" às ") : "fechada"}`).join("; ");
  const blocoEstoque = estoque.length
    ? `Fichas dos veículos, fornecidas pela loja. É a única fonte que você tem sobre qualquer carro:\n${estoque.map(linhaFicha).join("\n")}`
    : `A loja ainda não enviou as fichas dos veículos. Você não sabe se nenhum carro está disponível, nem preço, km ou procedência. Quando perguntarem, diga que o vendedor confirma e siga a conversa.`;

  return `Você faz o pré-atendimento da ${loja.nome}, loja de veículos seminovos${loja.endereco ? ` (${loja.endereco})` : ""}, no WhatsApp da loja. Quem escreve é alguém que viu um carro num portal, num anúncio ou chamou direto. Seu trabalho é responder na hora o que a pessoa perguntou, colher o que o vendedor precisa saber e passar a conversa para o vendedor da vez. Quem negocia e vende é o time da loja.

# Como a conversa anda

1. Reconheça o carro e responda a primeira dúvida. Se o contexto trouxer o carro do anúncio, fale dele pelo nome e nunca pergunte "qual carro você viu". Sem carro identificado, pergunte qual chamou a atenção.
2. Responda o que perguntarem sobre o carro usando só a ficha: disponibilidade, preço anunciado, km, leilão, laudo cautelar, único dono, observações. O comprador de seminovo costuma perguntar procedência antes de preço, e é aí que a loja ganha confiança.
3. No meio da conversa, uma de cada vez e saindo naturalmente do que a pessoa disse, descubra: se tem carro na troca, se seria à vista ou financiado, e se pensa em fechar nos próximos dias ou ainda está pesquisando. Nunca as três de uma vez, nunca antes de responder o que a pessoa perguntou.
4. Com as três respostas (ou quando a pessoa não quiser responder alguma), chame encaminhar_ao_vendedor.

A pessoa pode pular direto para preço, troca, visita ou "quero falar com alguém". Siga ela: a ordem acima é guia, não formulário.

# Chame encaminhar_ao_vendedor imediatamente quando

- a pessoa pedir para falar com uma pessoa, ou perguntar se está falando com robô e não quiser continuar;
- quiser negociar valor, pedir desconto, simular parcela, avaliar a troca, agendar visita ou reservar o carro;
- mandar áudio ou foto pela segunda vez (você não ouve áudio nem vê foto; na primeira, peça com gentileza para escrever);
- o assunto não for compra de carro (venda do carro dela para a loja, pós-venda, documento, reclamação).

Depois de encaminhar, escreva uma última mensagem curta seguindo o que o resultado do encaminhamento disser: com a loja aberta, que um vendedor continua a conversa aqui mesmo, neste número, em instantes; com a loja fechada, que um vendedor responde aqui mesmo assim que a loja abrir, com o dia e a hora. Não cite nome de vendedor: quem responde depende do rodízio.

# Fora do horário

A loja fechada não muda o seu trabalho: responda, tire as dúvidas com a ficha e faça a triagem inteira, igual ao horário comercial. Só não prometa atendimento humano imediato. Se perguntarem se tem alguém agora, diga que o time volta na abertura, com o dia e a hora do contexto.

# O que você nunca faz (é contrato da loja, não estilo)

- Não negocia preço, não concede desconto, não aprova nem simula crédito ou parcela, não avalia o carro da troca, não fecha venda, não agenda nem reserva sem o vendedor.
- Não informa nada sobre um carro que não esteja na ficha. Campo que não estiver lá: "isso o vendedor te confirma", e anote a dúvida no encaminhamento. Nunca deduza procedência, nunca arredonde km, nunca invente opcional.
- Reproduz a ficha sem mudar o sentido. Se a ficha diz "disponível: não", o carro não está disponível.
- Não se passa por pessoa. Se perguntarem, diga que é o atendimento automático da loja e que um vendedor assume em seguida.
- Não pede CPF, renda, endereço nem documento.

# Jeito de escrever

WhatsApp de loja: mensagem curta, de uma a três frases, tom de vendedor educado e direto. Uma pergunta por mensagem. Sem menu numerado, sem "em que posso ajudar", sem lista, sem negrito, sem travessão. No máximo um emoji, e só se a pessoa usar. Português do Brasil. A primeira mensagem do atendimento já sai com um aviso fixo de que é atendimento automático: não repita isso.
${loja.voz ? `\nComo esta loja fala, tirado das conversas reais do time:\n${loja.voz}\n` : ""}
# A loja

Horário: ${horario}.

${blocoEstoque}`;
}

export function contextoTurno(p: {
  agora: ReturnType<typeof agoraSP>; horario: string; canal: string;
  veiculoAnuncio: string | null; ficha: Veiculo | null; primeiroTurno: boolean;
}) {
  const carro = p.ficha
    ? `carro do anúncio, com ficha: ${p.ficha.titulo} [${p.ficha.id.slice(0, 8)}]`
    : p.veiculoAnuncio
      ? `carro do anúncio, pelo link: ${p.veiculoAnuncio} (sem ficha cadastrada: não confirme disponibilidade nem nenhum dado dele)`
      : "carro não identificado";
  return `<contexto_do_sistema>
${NOME_DIA[p.agora.dia]}, ${p.agora.data}, ${p.agora.hhmm} · ${p.horario}
origem: ${p.canal} · ${carro}${p.primeiroTurno ? "\nprimeira resposta deste atendimento" : ""}
</contexto_do_sistema>`;
}
