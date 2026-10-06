// Painel de leads: o que cada consultor vê no link pessoal dele, e o que o gerente vê no link da loja.
// Função pura sobre as linhas do banco, testada em painel_test.ts. A ordem é a da urgência: quem espera há mais
// tempo vem primeiro, e o tempo até o repasse aparece em minutos.
import { foneLegivel, proximoVendedor, type Vendedor } from "./rodizio.ts";

// deno-lint-ignore no-explicit-any
type Linha = Record<string, any>;

export type LeadPainel = {
  id: string; nome: string; telefone: string; whatsapp_link: string;
  carro: string; origem: string; troca: string; pagamento: string; visita: string; pendencias: string; resumo: string;
  chegou_em: string; avisado_em: string | null; atendido_em: string | null;
  consultor: string | null; consultor_id: string | null; fixado_por: "lead" | "gerente" | null; minutos_esperando: number | null; minutos_para_repasse: number | null;
  situacao: "sua_vez" | "sem_resposta" | "atendido" | "passou_adiante" | "com_robo" | "fila_noite";
  escalado: boolean;
};

/* esperando a pessoa da vez: ninguém escreveu ao lead ainda, ou o gerente passou o lead e ninguém escreveu depois */
export const aguardando = (c: Linha) =>
  c.estado === "encaminhada" &&
  (!c.primeira_acao_humana_em || (!!c.transferido_em && !(c.ultima_acao_humana_em && c.ultima_acao_humana_em >= c.transferido_em)));

const min = (de: string | null, agora: number) => (de ? Math.max(0, Math.floor((agora - new Date(de).getTime()) / 60_000)) : null);

function lead(c: Linha, vendedores: Map<string, string>, prazo: number, agora: number, situacao: LeadPainel["situacao"]): LeadPainel {
  const r = c.resumo ?? {};
  const esperando = situacao === "sua_vez" || situacao === "sem_resposta" ? min(c.avisado_em, agora) : null;
  return {
    id: c.id, nome: c.lead_nome || "Cliente sem nome", telefone: foneLegivel(c.lead_wa), whatsapp_link: `https://wa.me/${c.lead_wa}`,
    carro: r.veiculo ?? c.origem_detalhe?.veiculo_texto ?? "não identificado", origem: c.origem,
    troca: r.troca ?? "", pagamento: r.pagamento ?? "", visita: r.visita ?? "", pendencias: r.pendencias ?? "", resumo: r.resumo ?? "",
    chegou_em: c.iniciada_em, avisado_em: c.avisado_em ?? null, atendido_em: c.primeira_acao_humana_em ?? null,
    consultor: c.vendedor_id ? vendedores.get(c.vendedor_id) ?? null : null, consultor_id: c.vendedor_id ?? null,
    fixado_por: c.fixado_por ?? null,
    /* lead com dono fixo (pedido pelo nome ou passado pelo gerente) não repassa sozinho */
    minutos_esperando: esperando, minutos_para_repasse: esperando === null || c.fixado_por ? null : Math.max(0, prazo - esperando),
    situacao, escalado: !!c.escalado_em,
  };
}

const porChegada = (a: LeadPainel, b: LeadPainel) => (a.avisado_em ?? a.chegou_em).localeCompare(b.avisado_em ?? b.chegou_em);
const maisRecente = (a: LeadPainel, b: LeadPainel) => (b.atendido_em ?? b.chegou_em).localeCompare(a.atendido_em ?? a.chegou_em);

/* visão do consultor: a vez dele (mais antigo primeiro), os que ele atendeu, e os que passaram adiante sem resposta */
export function painelConsultor(conversas: Linha[], vendedorId: string, vendedores: Map<string, string>, prazo: number, agora = Date.now()) {
  const minhas = conversas.filter((c) => c.vendedor_id === vendedorId || (c.tentativas ?? []).includes(vendedorId));
  const sua_vez = minhas.filter((c) => c.vendedor_id === vendedorId && aguardando(c))
    .map((c) => lead(c, vendedores, prazo, agora, "sua_vez")).sort(porChegada);
  const atendidos = minhas.filter((c) => c.vendedor_id === vendedorId && c.primeira_acao_humana_em && !aguardando(c))
    .map((c) => lead(c, vendedores, prazo, agora, "atendido")).sort(maisRecente);
  const passaram = minhas.filter((c) => c.vendedor_id !== vendedorId && (c.tentativas ?? []).includes(vendedorId))
    .map((c) => lead(c, vendedores, prazo, agora, "passou_adiante")).sort(maisRecente);
  return { sua_vez, atendidos, passaram };
}

/* visão do gerente: o que está sem resposta (com quem e há quanto tempo), com o robô, na fila da noite, e o placar do dia */
export function painelGerente(conversas: Linha[], vendedores: Map<string, string>, prazo: number, agora = Date.now(), inicioDoDia?: string) {
  const sem_resposta = conversas.filter(aguardando)
    .map((c) => lead(c, vendedores, prazo, agora, "sem_resposta")).sort(porChegada);
  const com_robo = conversas.filter((c) => c.estado === "robo").map((c) => lead(c, vendedores, prazo, agora, "com_robo")).sort(porChegada);
  const fila_noite = conversas.filter((c) => c.estado === "fila").map((c) => lead(c, vendedores, prazo, agora, "fila_noite")).sort(porChegada);
  const atendidos = conversas.filter((c) => c.primeira_acao_humana_em && !aguardando(c) && (!inicioDoDia || c.primeira_acao_humana_em >= inicioDoDia))
    .map((c) => lead(c, vendedores, prazo, agora, "atendido")).sort(maisRecente);
  const placar = [...vendedores.entries()].map(([id, nome]) => {
    const doDia = conversas.filter((c) => (c.tentativas ?? []).includes(id) && (!inicioDoDia || (c.avisado_em ?? "") >= inicioDoDia || (c.encaminhado_em ?? "") >= inicioDoDia));
    const atendeu = doDia.filter((c) => c.vendedor_id === id && c.primeira_acao_humana_em);
    const tempos = atendeu.map((c) => (new Date(c.primeira_acao_humana_em).getTime() - new Date(c.encaminhado_em ?? c.avisado_em).getTime()) / 60_000)
      .filter((m) => m >= 0);
    return {
      consultor: nome, recebidos: doDia.length, atendidos: atendeu.length,
      passaram_adiante: doDia.filter((c) => c.vendedor_id !== id).length,
      minutos_ate_responder: tempos.length ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length) : null,
    };
  }).filter((p) => p.recebidos > 0);
  return { sem_resposta, com_robo, fila_noite, atendidos, placar };
}

/* a equipe no painel do gerente: quem está no rodízio, quem é o próximo da vez e quantos leads cada um tem esperando */
export function equipeDoPainel(equipe: (Vendedor & { nome: string; gerente?: boolean; usuario?: string | null })[], conversas: Linha[]) {
  const proximo = proximoVendedor(equipe, [])?.id ?? null;
  return equipe.filter((v) => v.ativo).sort((a, b) => a.ordem - b.ordem).map((v) => ({
    id: v.id, nome: v.nome, usuario: v.usuario ?? null, no_rodizio: v.no_rodizio !== false, gerente: !!v.gerente, proximo: v.id === proximo,
    esperando: conversas.filter((c) => c.vendedor_id === v.id && aguardando(c)).length,
  }));
}
