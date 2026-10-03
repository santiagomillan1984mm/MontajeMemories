// Función de Vercel para Montaje: transcribe un layout (imagen) a mesas y elementos.
// Variables en Vercel → Settings → Environments → Production:
//   ANTHROPIC_API_KEY  = clave de Anthropic (sk-ant-…)
//   MONTAJE_CODIGO     = código que pide la app la primera vez (para que nadie más gaste tu saldo)
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const TIPOS = ['mesa_redonda','mesa_ovalada','mesa_rectangular','mesa_cuadrada','mesa_serpentina','mesa_novios','mesa_honor','periquera','pista','escenario','dj','barra','pastel','postres','regalos','bienvenida','photobooth','lounge','arco','entrada','banos','cocina','columna','muro','planta','pantalla','sillas_ceremonia','otro'];

const TOOL = {
  name: 'registrar_layout',
  description: 'Registra los elementos de un layout de evento visto desde arriba.',
  input_schema: {
    type: 'object',
    properties: {
      salon: { type: 'object', description: 'Contorno del salón o área del evento, en fracciones de la imagen (0 a 1). Si hay cotas o medidas escritas, ponlas en metros.', properties: {
        x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' },
        ancho_m: { type: ['number', 'null'] }, largo_m: { type: ['number', 'null'] } } },
      elementos: { type: 'array', items: { type: 'object', properties: {
        tipo: { type: 'string', enum: TIPOS },
        cx: { type: 'number', description: 'Centro horizontal, fracción del ancho de la imagen (0 izquierda, 1 derecha)' },
        cy: { type: 'number', description: 'Centro vertical, fracción del alto de la imagen (0 arriba, 1 abajo)' },
        w: { type: 'number', description: 'Ancho de la mesa o elemento SIN sillas, fracción del ancho de la imagen' },
        h: { type: 'number', description: 'Alto de la mesa o elemento SIN sillas, fracción del alto de la imagen' },
        rotacion: { type: 'number', description: 'Grados, 0 si está horizontal' },
        sillas: { type: ['integer', 'null'], description: 'Número de sillas dibujadas alrededor' },
        etiqueta: { type: ['string', 'null'], description: 'Número o nombre escrito en la mesa' } }, required: ['tipo', 'cx', 'cy', 'w', 'h'] } },
      invitados: { type: ['integer', 'null'], description: 'Total de invitados si aparece escrito' },
      dudosos: { type: 'array', items: { type: 'string' } },
      nota: { type: ['string', 'null'] }
    },
    required: ['elementos', 'dudosos']
  }
};

const PROMPT = `Eres asistente de una wedding planner en México. La imagen es un layout o plano de montaje de un evento visto desde arriba (render, plano de computadora, PDF o boceto).
Registra CADA mesa y cada elemento importante (pista, barra, DJ, escenario, entrada, mesa de pastel, lounge, photobooth, columnas, muros sueltos) con su centro y tamaño como fracción de la imagen completa.
Reglas:
- Cuenta todas las mesas, aunque sean muchas. No inventes elementos que no estén dibujados.
- El tamaño w/h es el de la mesa sin las sillas.
- Mesa larga (más de 3 veces su ancho) con sillas de los dos lados: mesa_rectangular. Mesa larga frente a todos con sillas de un solo lado: mesa_novios (2 a 4 lugares) o mesa_honor.
- Si hay medidas escritas del salón (cotas), ponlas en salon.ancho_m / largo_m.
- Pon en "dudosos" lo que no se distinga bien.`;

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
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: body.mime, data: body.b64 } }, { type: 'text', text: PROMPT }] }] })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || ('Error ' + r.status);
    if (/credit|billing/i.test(msg)) return send(402, { error: 'Tu cuenta de Anthropic no tiene saldo. Agrega crédito en console.anthropic.com.' });
    return send(502, { error: 'La IA no pudo leer el layout: ' + msg });
  }
  const out = (j.content || []).find(b => b.type === 'tool_use');
  if (!out) return send(502, { error: 'La IA no devolvió datos. Intenta de nuevo.' });
  return send(200, { data: out.input });
};
