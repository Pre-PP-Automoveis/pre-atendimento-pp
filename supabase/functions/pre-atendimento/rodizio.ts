// Rodízio da loja, no desenho da distribuição do BNDV: o lead vai para o vendedor da vez e, se ninguém
// responder no prazo, passa para o próximo. Com o número compartilhado, "responder" é qualquer mensagem
// escrita ao lead pelo aplicativo da loja (o eco que a Meta manda), não importa quem escreveu.
// Funções puras, testadas em rodizio_test.ts.

export type Vendedor = { id: string; ativo: boolean; ordem: number; ultimo_lead_em: string | null; no_rodizio?: boolean; nome?: string };

/* o da vez: ativo, no rodízio, ainda não avisado neste lead, há mais tempo sem receber (quem nunca recebeu vem primeiro) */
export function proximoVendedor<T extends Vendedor>(equipe: T[], jaAvisados: string[]): T | null {
  return equipe
    .filter((v) => v.ativo && v.no_rodizio !== false && !jaAvisados.includes(v.id))
    .sort((a, b) => (a.ultimo_lead_em ?? "").localeCompare(b.ultimo_lead_em ?? "") || a.ordem - b.ordem)[0] ?? null;
}

/* o lead pediu alguém do time pelo nome ("o Pedro me indicou", "quero falar com o Rafael"). Vale para quem está
   fora do rodízio também. "Rafa" acha "Rafael" e vice-versa; nome que não é do time não acha ninguém. */
export function pessoaPedida<T extends Vendedor>(equipe: T[], pedido: string | null | undefined): T | null {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().split(/\s+/)[0] ?? "";
  const quem = norm(pedido ?? "");
  if (quem.length < 3 || quem === "nenhum") return null;
  const achados = equipe.filter((v) => {
    const n = norm(v.nome ?? "");
    return v.ativo && n.length >= 3 && (n === quem || n.startsWith(quem) || quem.startsWith(n));
  });
  return achados.find((v) => norm(v.nome ?? "") === quem) ?? (achados.length === 1 ? achados[0] : null);
}

/* repassa quando o vendedor da vez foi avisado há mais que o prazo e ninguém escreveu ao lead */
export function venceuPrazo(
  c: { estado: string; primeira_acao_humana_em: string | null; avisado_em: string | null },
  prazoMin: number, agora = Date.now(),
) {
  return c.estado === "encaminhada" && !c.primeira_acao_humana_em && !!c.avisado_em &&
    agora - new Date(c.avisado_em).getTime() >= prazoMin * 60_000;
}

/* o lead fica no máximo prazoMin com o robô, contando da primeira mensagem dele */
export function passouDoRobo(
  c: { estado: string; primeira_acao_humana_em: string | null; iniciada_em: string },
  prazoMin: number, agora = Date.now(),
) {
  return c.estado === "robo" && !c.primeira_acao_humana_em && agora - new Date(c.iniciada_em).getTime() >= prazoMin * 60_000;
}

/* 5511987654321 vira (11) 98765-4321, para o vendedor achar a conversa no aplicativo */
export function foneLegivel(wa: string) {
  const d = wa.replace(/\D/g, "");
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : `+${d}`;
}
