// Función de Vercel para Montaje: transcribe un layout (imagen) a mesas y elementos.
// Variables en Vercel → Settings → Environments → Production:
//   ANTHROPIC_API_KEY  = clave de Anthropic (sk-ant-…)
//   MONTAJE_CODIGO     = código que pide la app la primera vez (para que nadie más gaste tu saldo)
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const FORMAS = ['rectangular', 'redonda', 'cuadrada', 'ovalada', 'serpentina', 'periquera'];
const ZONAS = ['pista','escenario','dj','barra','pastel','postres','regalos','bienvenida','photobooth','lounge','arco','entrada','banos','cocina','columna','muro','planta','pantalla','sillas_ceremonia','arbol','palmera','arbusto','seto','fuente','pergola','carpa','guirnalda','farola','sombrilla','fogata','otro'];
const PISOS = ['pasto','arena','adoquin','deck','marmolpiso','concreto','grava','piedra','tierra','agua','mar'];
const PT = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[x, y] en porcentaje de la imagen, 0 a 100' };

const TOOL = {
  name: 'registrar_layout',
  description: 'Registra las mesas y los elementos de un layout de evento visto desde arriba.',
  input_schema: {
    type: 'object',
    properties: {
      salon: { type: 'object', description: 'Rectángulo del área del evento en porcentaje (0 a 100) y medidas en metros si están escritas.', properties: {
        x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' },
        ancho_m: { type: ['number', 'null'] }, largo_m: { type: ['number', 'null'] } } },
      mesas: { type: 'array', description: 'Una entrada por mesa numerada. Si una mesa está hecha de varias mesas unidas con un solo número, es UNA mesa.', items: { type: 'object', properties: {
        forma: { type: 'string', enum: FORMAS },
        etiqueta: { type: ['string', 'null'], description: 'Número o nombre escrito en la mesa' },
        principal: { type: 'boolean', description: 'true si es mesa de novios o de honor' },
        centro: PT,
        extremo_1: { ...PT, description: 'Para mesas alargadas: centro de uno de los lados cortos (cabecera), en porcentaje' },
        extremo_2: { ...PT, description: 'Centro de la otra cabecera' },
        ancho_pct: { type: ['number', 'null'], description: 'Ancho de la mesa (lado corto, sin sillas) en porcentaje del ANCHO de la imagen' },
        diametro_pct: { type: ['number', 'null'], description: 'Solo mesas redondas: diámetro sin sillas en porcentaje del ANCHO de la imagen' },
        sillas_lado_1: { type: 'integer', description: 'Sillas a lo largo de un lado largo' },
        sillas_lado_2: { type: 'integer', description: 'Sillas a lo largo del otro lado largo' },
        sillas_cabeceras: { type: 'integer', description: 'Sillas en las cabeceras (0, 1 o 2)' },
        sillas_total: { type: 'integer' },
        punto_sillas: { ...PT, description: 'Si solo hay sillas de un lado: posición de una de esas sillas' }
      }, required: ['forma', 'centro', 'sillas_total'] } },
      elementos: { type: 'array', description: 'Pista, escenario, barra, DJ, entrada, etc. Rectángulo que ocupan, en porcentaje.', items: { type: 'object', properties: {
        tipo: { type: 'string', enum: ZONAS }, x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' }, etiqueta: { type: ['string', 'null'] } }, required: ['tipo', 'x0', 'y0', 'x1', 'y1'] } },
      zonas_piso: { type: 'array', description: 'Áreas de piso distintas dibujadas o coloreadas: jardín o pasto, alberca o agua, playa o arena, deck, adoquín, etc. Rectángulo que ocupan en porcentaje.', items: { type: 'object', properties: {
        material: { type: 'string', enum: PISOS }, forma: { type: 'string', enum: ['rectangular', 'redondeada', 'ovalada'] }, x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } }, required: ['material', 'x0', 'y0', 'x1', 'y1'] } },
      piso_general: { type: ['string', 'null'], enum: [...PISOS, null], description: 'Material del área principal del evento si se distingue (por ejemplo, un jardín = pasto). null si es un salón o no se sabe.' },
      invitados: { type: ['integer', 'null'], description: 'Total de invitados si aparece escrito' },
      dudosos: { type: 'array', items: { type: 'string' } }
    },
    required: ['mesas', 'elementos', 'dudosos']
  }
};

const PROMPT = `Eres asistente de una wedding planner en México. La imagen es un layout de montaje de un evento visto desde arriba. Encima le dibujé una cuadrícula roja tenue con números de 0 a 100 en los bordes: úsala para dar posiciones en porcentaje (x de izquierda a derecha, y de arriba abajo).

Registra con la herramienta:
1. Cada MESA numerada. Si una mesa está formada por varias mesas pegadas que comparten un solo número, regístrala como UNA sola mesa con su largo total.
   - Para mesas alargadas da extremo_1 y extremo_2: el centro de cada cabecera (lado corto). Así queda claro hacia dónde está girada. Si la mesa está en diagonal, los extremos también.
   - Cuenta las sillas dibujadas: sillas_lado_1 y sillas_lado_2 en los lados largos, sillas_cabeceras en las puntas, y sillas_total. Cuenta con cuidado, silla por silla. Si hay números junto a las sillas, úsalos para confirmar.
   - Si una mesa tiene sillas de un solo lado, da punto_sillas con la posición de una de esas sillas.
   - ancho_pct es el lado corto de la mesa sin sillas, en porcentaje del ancho de la imagen.
2. Los ELEMENTOS que no son mesas (pista, escenario, barra, DJ, entrada, lounge, árboles, palmeras, setos, fuentes, pérgolas, carpas, guirnaldas de luces, farolas, sombrillas, fogatas) con el rectángulo que ocupan. No registres paredes ni la arquitectura del lugar.
   Las ÁREAS DE PISO (jardín o pasto, alberca, playa, deck, adoquín) van en zonas_piso con su rectángulo y forma. Una alberca o área de agua aunque sea de forma irregular: usa el rectángulo que la contiene y forma ovalada o redondeada. Si todo el evento es en jardín, pon piso_general = pasto.
3. Si hay medidas escritas del salón, ponlas en salon. Si dice cuántas personas son, ponlo en invitados.
No inventes nada que no esté dibujado. Pon en dudosos lo que no se distinga bien.
Responde únicamente llamando a la herramienta registrar_layout.`;

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = []; for await (const ch of req) chunks.push(ch);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

module.exports = async (req, res) => {
  const send = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST') return send(405, { error: 'Método no permitido' });
  const key = process.env.ANTHROPIC_API_KEY, code = process.env.MONTAJE_CODIGO;
  if (!key || !code) return send(500, { error: 'Falta configurar ANTHROPIC_API_KEY y MONTAJE_CODIGO en Vercel y volver a publicar (Redeploy).' });
  const body = await readJson(req);
  if (String(body.codigo || '').trim() !== String(code).trim()) return send(401, { error: 'Código incorrecto.', needCode: true });
  if (!body.b64 || !/^image\/(jpeg|png|webp)$/.test(body.mime || '')) return send(400, { error: 'No llegó la imagen del layout.' });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 12000, tools: [TOOL], tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: body.mime, data: body.b64 } }, { type: 'text', text: PROMPT }] }] })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || ('Error ' + r.status);
    if (/credit|billing/i.test(msg)) return send(402, { error: 'Tu cuenta de Anthropic no tiene saldo. Agrega crédito en console.anthropic.com.' });
    return send(502, { error: 'La IA no pudo leer el layout: ' + msg });
  }
  let out = (j.content || []).find(b => b.type === 'tool_use');
  if (!out) { const txt = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n'); const m = txt.match(/\{[\s\S]*\}/); if (m) { try { out = { input: JSON.parse(m[0]) }; } catch (e) {} } }
  if (!out) return send(502, { error: 'La IA no devolvió datos. Intenta de nuevo.' });
  return send(200, { data: out.input, v: 2 });
};
