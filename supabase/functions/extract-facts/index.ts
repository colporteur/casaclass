// Supabase Edge Function - POST /functions/v1/extract-facts
// Accepts { transcript } and returns { facts: string[] }.
// Pulls atomic, verifiable factual claims out of a discussion-group transcript.
//
// Deploy:
//   supabase functions deploy extract-facts --no-verify-jwt
// (ANTHROPIC_API_KEY is already set from when the summarize function was deployed.)

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
  try { body = await req.json() }
  catch { return json({ error: 'Invalid JSON' }, { status: 400 }) }

  const transcript: string = (body?.transcript ?? '').toString()
  if (!transcript || transcript.length < 50) {
    return json({ error: 'Transcript is too short.' }, { status: 400 })
  }
  if (transcript.length > MAX_TRANSCRIPT) {
    return json({ error: `Transcript is too long (${transcript.length} chars). Trim it under ${MAX_TRANSCRIPT}.` }, { status: 413 })
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set in Supabase secrets.' }, { status: 500 })

  const systemPrompt =
    "You extract verifiable factual claims from a discussion-group transcript.\n\n" +
    "A \"fact\" here is a specific, checkable claim about the world -- something that " +
    "could in principle be looked up and shown to be true or false. Examples:\n" +
    "  - \"The Battle of Hastings was in 1066.\"\n" +
    "  - \"Lincoln signed the Emancipation Proclamation in 1863.\"\n" +
    "  - \"Coffee contains caffeine.\"\n\n" +
    "NOT facts (skip these):\n" +
    "  - Pure opinions or aesthetic judgments (\"this is beautiful\")\n" +
    "  - Questions (\"what if...\")\n" +
    "  - Hedged statements (\"maybe X is true\")\n" +
    "  - Statements about the speaker's own feelings (\"I think\", \"I love\")\n" +
    "  - Pure storytelling without factual claims\n\n" +
    "Break compound statements into atomic claims (one fact per item). State each " +
    "fact in clear, declarative prose -- not as a quote. If the transcript contains " +
    "no checkable factual claims, return an empty array.\n\n" +
    "Respond with ONLY valid JSON in this exact shape (no markdown fence, no prose):\n" +
    "{\n  \"facts\": [\"Statement 1.\", \"Statement 2.\"]\n}"

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
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Transcript:\n${transcript}` }]
      })
    })
  } catch (e) {
    return json({ error: `Failed to reach Anthropic: ${(e as Error).message}` }, { status: 502 })
  }

  if (!aRes.ok) {
    const txt = await aRes.text()
    return json({ error: `Anthropic returned ${aRes.status}: ${txt}` }, { status: 502 })
  }

  const data = await aRes.json()
  const text: string = (data?.content ?? [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim()

  // Pull JSON out even if Claude wraps it in markdown.
  let parsed: any
  try {
    const m = text.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(m ? m[0] : text)
  } catch {
    return json({ error: `Could not parse Claude response: ${text.slice(0, 300)}` }, { status: 502 })
  }

  const facts: string[] = Array.isArray(parsed?.facts)
    ? parsed.facts.filter((f: any) => typeof f === 'string' && f.trim()).map((f: string) => f.trim())
    : []

  return json({ facts })
})
