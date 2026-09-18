import { loadEnv } from '../util/env.ts';

const cfg = loadEnv();
const prompt = 'Antworte ausschließlich mit dem JSON {"ok": true}.';

async function timeOne(model: string) {
  const t0 = Date.now();
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 100,
    }),
  });
  const dt = Date.now() - t0;
  const data = await res.json();
  return { model, ms: dt, status: res.status, content: data.choices?.[0]?.message?.content?.slice(0, 40), err: data.error?.message };
}

for (const model of ['deepseek-flash', 'deepseek-v4-pro']) {
  const r = await timeOne(model);
  console.log(JSON.stringify(r));
  await new Promise((r) => setTimeout(r, 500));
}
