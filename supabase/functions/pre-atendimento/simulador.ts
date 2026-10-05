// Simulador: roda conversas inteiras com o prompt e o código reais (conversa.ts), sem WhatsApp e sem banco.
// O encaminhamento é de mentira, mas segue a regra real do horário: loja aberta avisa, loja fechada vai para a fila.
// Serve para calibrar o robô antes de ligar a loja e depois de cada ajuste de prompt.
import type Anthropic from "npm:@anthropic-ai/sdk";
import { AVISO_PADRAO, despedidaPadrao, type Encaminhamento, montarMensagens, rodarTurno } from "./conversa.ts";
import { agoraSP, contextoTurno, type Loja, promptSistema, situacaoHorario, type Veiculo } from "./prompt.ts";

export type Cenario = {
  nome: string;
  agora?: string;               // ISO; padrão: agora
  canal?: string;               // origem lida do link ou do anúncio
  veiculo_texto?: string | null; // o que o link do portal diz do carro
  ficha_id?: string | null;     // carro do estoque amarrado ao anúncio
  mensagens: string[];          // uma entrada por turno do lead (várias linhas = várias mensagens seguidas)
};

type Linha = { autor: "lead" | "robo"; texto: string };

export async function simular(
  cliente: Anthropic,
  // deno-lint-ignore no-explicit-any
  loja: Record<string, any>,
  pedido: { cenarios?: Cenario[]; estoque?: Veiculo[] },
) {
  const estoque = pedido.estoque ?? [];
  const sistema = promptSistema(loja as Loja, estoque);
  const rodar = async (c: Cenario) => {
    const quando = c.agora ? new Date(c.agora) : new Date();
    const historico: Linha[] = [];
    const ficha = estoque.find((v) => v.id === c.ficha_id) ?? null;
    let custo = 0, encaminhamento: Encaminhamento | null = null, erro: string | null = null;
    for (const [i, msg] of c.mensagens.entries()) {
      historico.push({ autor: "lead", texto: msg });
      const horario = situacaoHorario(loja.horario ?? {}, quando);
      const messages = montarMensagens(historico, contextoTurno({
        agora: agoraSP(quando), horario: horario.texto, canal: c.canal ?? "Não identificado",
        veiculoAnuncio: c.veiculo_texto ?? null, ficha, primeiroTurno: i === 0,
      }));
      if (!messages) break;
      try {
        const t = await rodarTurno({
          cliente, modelo: loja.modelo, sistema, messages,
          aoEncaminhar: async (e) => horario.aberta
            ? { ok: true, vendedor: "consultor da vez" }
            : { ok: true, vendedor: null, fila: true, abre: horario.abre },
        });
        custo += t.custo;
        let texto = (t.textos.length ? t.textos : t.encaminhado ? [despedidaPadrao(t.encaminhado)] : []).join("\n\n");
        if (i === 0 && texto) texto += `\n\n${loja.aviso_inicial || AVISO_PADRAO(loja.nome)}`;
        historico.push({ autor: "robo", texto: texto || "[o robô não respondeu]" });
        if (t.encaminhamento) { encaminhamento = t.encaminhamento; break; }
      } catch (e) {
        erro = String((e as Error)?.message ?? e);
        break;
      }
    }
    return { nome: c.nome, agora: agoraSP(quando), canal: c.canal ?? "Não identificado", historico, encaminhamento, custo_usd: Number(custo.toFixed(5)), erro };
  };
  /* em paralelo: a função tem limite de tempo por chamada */
  const resultados = await Promise.all((pedido.cenarios ?? []).map(rodar));
  return { modelo: loja.modelo, custo_total_usd: Number(resultados.reduce((s, r) => s + r.custo_usd, 0).toFixed(4)), resultados };
}
