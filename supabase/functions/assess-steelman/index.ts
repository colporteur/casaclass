// Supabase Edge Function - POST /functions/v1/assess-steelman
// Accepts { transcript } and returns { score, summary, engaged_views, omitted_views }.
// Layer 6: Did the speaker engage the strongest version of opposing views, or only weak ones?

// deno-lint-ignore-file no-explicit-any

const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const MAX_TRANSCRIPT  = 200_000

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...(init.headers ?? {}) }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')    return json({ error: 'Use POST' }, { status: 405 })

  let body: any
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, { status: 400 }) }

  const transcript: string = (body?.transcript ?? '').toString()
  if (!transcript || transcript.length < 50) return json({ error: 'Transcript required.' }, { status: 400 })
  if (transcript.length > MAX_TRANSCRIPT) return json({ error: 'Transcript too long.' }, { status: 413 })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set.' }, { status: 500 })

  const systemPrompt =
    "You assess whether a speaker STEELMANNED opposing views in their talk -- that is, " +
    "whether they engaged the strongest, most charitable version of views they disagreed " +
    "with, or only weak/easy versions (\"strawmen\").\n\n" +
    "Score on a 0.0 -- 1.0 scale:\n" +
    "  - 1.0: speaker presented the strongest opposing case before responding\n" +
    "  - 0.7: opposing views were acknowledged fairly\n" +
    "  - 0.5: opposing views were noted but not really engaged\n" +
    "  - 0.3: only weak versions of opposing views appeared\n" +
    "  - 0.0: no opposing views appeared, or only caricatures were attacked\n" +
    "  - If the talk doesn't really argue for a position, use 0.5 (not applicable but neutral)\n\n" +
    "Return ONLY valid JSON (no markdown, no prose):\n" +
    "{\n" +
    "  \"score\":         <number 0..1>,\n" +
    "  \"summary\":       \"<one short paragraph judging the speaker's engagement with opposing views>\",\n" +
    "  \"engaged_views\": \"<one to three short lines noting opposing views the speaker did engage; empty string if none>\",\n" +
    "  \"omitted_views\": \"<one to three short lines noting strong opposing views the speaker missed; empty string if none>\"\n" +
    "}"

  let aRes: Response
  try {
    aRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type':       'application/json',
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Transcript:\n${transcript}` }]
      })
    })
  } catch (e) {
    return json({ error: `Failed to reach Anthropic: ${(e as Error).message}` }, { status: 502 })
  }

  if (!aRes.ok) return json({ error: `Anthropic returned ${aRes.status}: ${await aRes.text()}` }, { status: 502 })

  const data = await aRes.json()
  const text: string = (data?.content ?? [])
    .filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n').trim()

  let parsed: any
  try {
    const m = text.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(m ? m[0] : text)
  } catch {
    return json({ error: `Could not parse Claude response: ${text.slice(0, 300)}` }, { status: 502 })
  }

  let score = Number(parsed?.score)
  if (!Number.isFinite(score)) score = 0.5
  if (score < 0) score = 0
  if (score > 1) score = 1

  return json({
    score,
    summary:       typeof parsed?.summary       === 'string' ? parsed.summary.trim()       : '',
    engaged_views: typeof parsed?.engaged_views === 'string' ? parsed.engaged_views.trim() : '',
    omitted_views: typeof parsed?.omitted_views === 'string' ? parsed.omitted_views.trim() : ''
  })
})
