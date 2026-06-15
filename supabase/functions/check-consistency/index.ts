// Supabase Edge Function - POST /functions/v1/check-consistency
// Accepts { transcript, facts: string[] } and returns { issues: { description, fact_a, fact_b, severity }[] }.
// Layer 5: Scans for internal contradictions across the talk.

// deno-lint-ignore-file no-explicit-any

const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const MAX_FACTS       = 60
const MAX_TRANSCRIPT  = 200_000
const VALID_SEVERITIES = ['minor', 'moderate', 'serious']

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
  const facts: string[] = Array.isArray(body?.facts)
    ? body.facts.filter((f: any) => typeof f === 'string' && f.trim()).slice(0, MAX_FACTS)
    : []

  if (!transcript || transcript.length < 50) return json({ error: 'Transcript required.' }, { status: 400 })
  if (transcript.length > MAX_TRANSCRIPT)   return json({ error: 'Transcript too long.' }, { status: 413 })
  if (facts.length === 0)                   return json({ error: 'No facts provided.' }, { status: 400 })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set.' }, { status: 500 })

  const systemPrompt =
    "You scan a transcript for INTERNAL CONTRADICTIONS -- places where the speaker " +
    "asserts something that conflicts with something else they said in the same talk. " +
    "Use the supplied list of facts as a guide to what the speaker claimed, but feel " +
    "free to draw on the full transcript for context.\n\n" +
    "Flag ONLY clear internal contradictions, not nuanced positions or evolving views. " +
    "It is fine -- even common -- to find zero contradictions.\n\n" +
    "For each contradiction:\n" +
    "  - \"description\": one or two sentences naming the contradiction in plain English\n" +
    "  - \"fact_a\":      a brief quote or paraphrase of one side\n" +
    "  - \"fact_b\":      a brief quote or paraphrase of the conflicting side\n" +
    "  - \"severity\":    \"minor\" | \"moderate\" | \"serious\" (judged by how central the contradiction is)\n\n" +
    "Respond with ONLY valid JSON:\n" +
    "{\n  \"issues\": [ { \"description\": \"...\", \"fact_a\": \"...\", \"fact_b\": \"...\", \"severity\": \"moderate\" } ]\n}\n\n" +
    "Return { \"issues\": [] } if none found."

  const factList = facts.map((f, i) => `${i + 1}. ${f}`).join('\n')
  const userContent = `Transcript:\n${transcript}\n\nExtracted facts for reference:\n${factList}`

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
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
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

  const raw: any[] = Array.isArray(parsed?.issues) ? parsed.issues : []
  const issues = raw
    .filter(x => x && typeof x.description === 'string')
    .map(x => ({
      description: String(x.description).trim(),
      fact_a:      typeof x.fact_a === 'string' ? x.fact_a.trim() : '',
      fact_b:      typeof x.fact_b === 'string' ? x.fact_b.trim() : '',
      severity:    VALID_SEVERITIES.includes(x.severity) ? x.severity : 'moderate'
    }))

  return json({ issues })
})
