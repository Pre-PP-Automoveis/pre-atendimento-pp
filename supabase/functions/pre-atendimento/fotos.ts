// Fotos do carro como imagem na conversa (24/11/2026). Nenhum link sai para o cliente (Kauan): nem do BNDV, nem nosso.
// A rotina das 9h guarda cada foto em JPEG no armazenamento privado fotos-veiculos, em <código BNDV>/<foto>.jpg, e
// pa_veiculos.fotos lista esses caminhos. A Bia pede as fotos pela ferramenta enviar_fotos; a função sobe cada uma
// para o WhatsApp e manda como imagem, antes do texto da Bia. Regras puras aqui, iguais no atendimento e no simulador.
import { soConsultor, type Veiculo } from "./prompt.ts";

export const BALDE_FOTOS = "fotos-veiculos";
/* quantas vão por pedido: o que um consultor mandaria de uma vez; "manda mais" segue de onde parou */
export const LOTE_FOTOS = 8;

/* só caminho do armazenamento conta (o link antigo do BNDV, de antes de 24/11, não vai a lugar nenhum) */
export const fotosDoCarro = (v: Pick<Veiculo, "fotos">) => (v.fotos ?? []).filter((f) => /^\d+\/[\w.-]+\.jpg$/.test(f));

export type Lote = { veiculoId: string; titulo: string; codigo: string; caminhos: string[]; de: number; total: number };
export type AnexoFotos = { codigo: string; de: number; ate: number; total: number };

/* o código entre colchetes da ficha é o começo do id do carro */
export function carroDoPedido(estoque: Veiculo[], carro: string) {
  const c = (carro ?? "").replace(/[\[\]\s]/g, "").toLowerCase();
  if (c.length < 6) return null;
  return estoque.find((v) => v.id.toLowerCase().startsWith(c) && !soConsultor(v) && v.disponivel) ?? null;
}

/* O que a ferramenta faz com um pedido: o lote a mandar (ou nada) e o que o modelo lê de volta.
   enviadas: por código do carro, quantas fotos já foram nesta conversa (inclui as já separadas neste turno). */
export function pedirFotos(estoque: Veiculo[], carro: string, enviadas: Map<string, number>, tamanho = LOTE_FOTOS):
  { lote: Lote | null; paraModelo: string } {
  const v = carroDoPedido(estoque, carro);
  const fotos = v ? fotosDoCarro(v) : [];
  const codigo = v?.anuncios?.bndv;
  if (!v || !fotos.length || !codigo) {
    return { lote: null, paraModelo: "Esse carro não tem fotos para enviar. Diga só que as fotos dele o consultor te manda, sem falar em cadastro." };
  }
  const de = Math.min(enviadas.get(codigo) ?? 0, fotos.length);
  const caminhos = fotos.slice(de, de + tamanho);
  if (!caminhos.length) {
    return { lote: null, paraModelo: `Todas as ${fotos.length} fotos do ${v.titulo} já foram enviadas nesta conversa. Diga que mais fotos ou vídeo dele o consultor te manda.` };
  }
  enviadas.set(codigo, de + caminhos.length);
  const faltam = fotos.length - (de + caminhos.length);
  return {
    lote: { veiculoId: v.id, titulo: v.titulo, codigo, caminhos, de, total: fotos.length },
    paraModelo: `${caminhos.length} fotos do ${v.titulo} vão para a pessoa, como imagens, logo antes da sua mensagem` +
      (faltam > 0 ? ` (ficam mais ${faltam}; se ela pedir mais, chame enviar_fotos de novo).` : " (são todas as fotos dele).") +
      " Escreva só a continuação da conversa: pode dizer em poucas palavras que são as fotos dele, mas não diga que vai mandar, não mande link e não descreva as fotos. Siga a triagem.",
  };
}

/* o que fica gravado na conversa (o time vê no painel; a Bia lê no histórico) */
/* diz quantas o carro tem: sem isso, no "manda mais" a Bia respondia que eram todas (simulação de 24/11/2026) */
export const rotuloFotos = (titulo: string, n: number, ate: number, total: number) =>
  `[${n} ${n === 1 ? "foto" : "fotos"} do ${titulo} enviadas, ${ate} de ${total}${ate < total ? "; dá para mandar mais" : ""}]`;

/* quantas fotos de cada carro já foram nesta conversa, pelo anexo gravado */
export function fotosJaEnviadas(anexos: (AnexoFotos | null | undefined)[]) {
  const m = new Map<string, number>();
  for (const a of anexos) if (a?.codigo) m.set(a.codigo, Math.max(m.get(a.codigo) ?? 0, a.ate));
  return m;
}
