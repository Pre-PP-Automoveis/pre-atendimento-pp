// Áudio e foto do cliente (23/11/2026). A Bia passou a ouvir e ver: o áudio vira texto e a foto vira uma descrição curta,
// gravados em pa_mensagens no lugar do aviso "[a pessoa mandou um áudio...]". O resto do sistema (a Bia, o resumo do
// consultor e o painel) continua lendo só texto. Qualquer falha volta ao aviso antigo: a conversa nunca para por mídia.
// - foto: a própria Claude da loja descreve (a API recebe imagem em base64);
// - áudio: a API da Claude não recebe áudio, então a transcrição vai para outro serviço, pela chave que existir no
//   ambiente: OPENAI_API_KEY (gpt-4o-mini-transcribe) ou GEMINI_API_KEY. Sem chave, fica o aviso antigo.
import Anthropic from "npm:@anthropic-ai/sdk";
import { GRAPH, tokenDo } from "./whatsapp.ts";
import { PRECOS } from "./conversa.ts";

const LIMITE_FOTO = 4_500_000; // a Claude recusa imagem acima de ~5 MB em base64
const LIMITE_AUDIO = 16_000_000; // teto do WhatsApp
const FOTO_ACEITA = ["image/jpeg", "image/png", "image/webp", "image/gif"];

import { rotuloAudio, rotuloFoto } from "./rotulos.ts";

/* baixa a mídia pela Graph API: primeiro o endereço temporário, depois o arquivo, os dois com a credencial da loja */
export async function baixarMidia(phoneNumberId: string, mediaId: string, limite: number) {
  const token = await tokenDo(phoneNumberId);
  const info = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  if (!info?.url) throw new Error(`mídia ${mediaId} sem endereço: ${JSON.stringify(info?.error?.message ?? info)}`);
  if (info.file_size && Number(info.file_size) > limite) throw new Error(`mídia grande demais (${info.file_size} bytes)`);
  const r = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`download da mídia ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer()) as Uint8Array<ArrayBuffer>;
  if (bytes.length > limite) throw new Error(`mídia grande demais (${bytes.length} bytes)`);
  return { bytes, mime: String(info.mime_type ?? r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() };
}

function base64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const SISTEMA_FOTO = `Você descreve, para a atendente virtual de uma loja de carros seminovos, a foto que um cliente mandou no WhatsApp. Responda em uma ou duas frases curtas, em português do Brasil, sem travessão, sem introdução:
- print de anúncio, de site ou de conversa: o carro (marca, modelo, versão, ano, cor) e o preço e a km que aparecem escritos;
- foto de um carro: marca e modelo prováveis, cor, e o que se vê do estado (amassado, risco, pintura gasta), sem avaliar preço;
- documento pessoal ou financeiro (CNH, RG, CPF, comprovante, holerite, extrato, proposta de banco): diga só o tipo de documento;
- outra coisa: diga o que é, em poucas palavras.
Nunca escreva placa, CPF, RG, telefone, endereço, e-mail nem nome de pessoa. Não invente o que não dá para ver; se estiver ilegível ou cortado, diga isso.`;

export async function descreverFoto(cliente: Anthropic, modelo: string, bytes: Uint8Array, mime: string) {
  const tipo = FOTO_ACEITA.includes(mime) ? mime : "image/jpeg";
  const resp = await cliente.messages.create({
    model: modelo, max_tokens: 400,
    ...(modelo.startsWith("claude-haiku") ? {} : { output_config: { effort: "low" as const } }),
    system: SISTEMA_FOTO,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: tipo as "image/jpeg", data: base64(bytes) } },
      { type: "text", text: "Descreva esta foto." },
    ] }],
  });
  if (resp.stop_reason === "refusal") throw new Error("descrição da foto recusada pelo modelo");
  const texto = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(" ").trim();
  if (!texto) throw new Error("descrição da foto vazia");
  const p = PRECOS[modelo] ?? PRECOS["claude-sonnet-5"];
  return { texto, custo: resp.usage.input_tokens * p.in + resp.usage.output_tokens * p.out };
}

const PEDIDO_TRANSCRICAO = "Transcreva este áudio de WhatsApp em português do Brasil, palavra por palavra, sem comentar, sem resumir e sem traduzir. Se não houver fala, responda só: [sem fala]";

/* qual serviço de transcrição está ligado (para a saúde do painel e para o teste) */
export const servicoDeAudio = () =>
  Deno.env.get("OPENAI_API_KEY") ? "openai" : Deno.env.get("GEMINI_API_KEY") ? "gemini" : null;

export async function transcreverAudio(bytes: Uint8Array, mime: string): Promise<{ texto: string; custo: number } | null> {
  const servico = servicoDeAudio();
  if (!servico) return null;
  const tipo = (mime || "audio/ogg").split(";")[0];
  if (servico === "openai") {
    const pedir = async (modelo: string) => {
      const f = new FormData();
      f.append("file", new Blob([bytes as Uint8Array<ArrayBuffer>], { type: tipo }), `audio.${tipo.includes("mpeg") ? "mp3" : tipo.includes("mp4") || tipo.includes("aac") ? "m4a" : "ogg"}`);
      f.append("model", modelo);
      f.append("language", "pt");
      return fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` }, body: f });
    };
    let r = await pedir(Deno.env.get("TRANSCRICAO_MODELO") || "gpt-4o-mini-transcribe");
    if (r.status === 404 || r.status === 400) r = await pedir("whisper-1");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`transcrição ${r.status}: ${JSON.stringify(j?.error?.message ?? j).slice(0, 200)}`);
    return { texto: String(j.text ?? "").trim(), custo: 0 };
  }
  const modelo = Deno.env.get("GEMINI_MODELO") || "gemini-3.8-flash";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": Deno.env.get("GEMINI_API_KEY")! },
    body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: tipo, data: base64(bytes) } }, { text: PEDIDO_TRANSCRICAO }] }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`transcrição ${r.status}: ${JSON.stringify(j?.error?.message ?? j).slice(0, 200)}`);
  const texto = (j?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join(" ").trim();
  return { texto, custo: 0 };
}

/* o texto que fica gravado para a mensagem de áudio ou foto; null quando não deu (quem chama usa o aviso antigo) */
// deno-lint-ignore no-explicit-any
export async function textoDaMidia(p: { cliente: Anthropic; modelo: string; phoneNumberId: string; msg: Record<string, any> }):
  Promise<{ texto: string; custo: number } | null> {
  const { msg } = p;
  if (msg.type === "image" && msg.image?.id) {
    const { bytes, mime } = await baixarMidia(p.phoneNumberId, msg.image.id, LIMITE_FOTO);
    const d = await descreverFoto(p.cliente, p.modelo, bytes, mime);
    return { texto: rotuloFoto(d.texto, msg.image.caption), custo: d.custo };
  }
  if (msg.type === "audio" && msg.audio?.id) {
    if (!servicoDeAudio()) return null;
    const { bytes, mime } = await baixarMidia(p.phoneNumberId, msg.audio.id, LIMITE_AUDIO);
    const t = await transcreverAudio(bytes, mime);
    if (!t?.texto || /^\[sem fala\]$/i.test(t.texto)) return null;
    return { texto: rotuloAudio(t.texto), custo: t.custo };
  }
  return null;
}
