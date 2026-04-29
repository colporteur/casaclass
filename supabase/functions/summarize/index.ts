// Supabase Edge Function — POST /functions/v1/summarize
// Accepts { transcript, topic_title?, presentation_id? } and returns { summary }.
// The Anthropic API key lives in Supabase secrets (ANTHROPIC_API_KEY) so it
// never reaches the browser.
//
// Deploy:
//   supabase functions deploy summarize --no-verify-jwt
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (We pass --no-verify-jwt because Casa Class has no logins; the function is
//  still rate-limited by Supabase and protected from raw browsing by the
//  anon-key requirement on the project.)

// Deno typings — fine to omit at deploy time.
// deno-lint-ignore-file no-explicit-any

const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const MAX_TRANSCRIPT  = 200_000  // characters — safety net

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
  const topic: string | null = body?.topic_title ?? null

  if (!transcript || transcript.length < 50) {
    return json({ error: 'Transcript is too short.' }, { status: 400 })
  }
  if (transcript.length > MAX_TRANSCRIPT) {
    return json({ error: `Transcript is too long (${transcript.length} chars). Trim it under ${MAX_TRANSCRIPT}.` }, { status: 413 })
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set in Supabase secrets.' }, { status: 500 })

  const systemPrompt =
    "You are a careful, plain-spoken assistant summarizing a transcript from " +
    "a weekly discussion group called Casa Class. Produce a clear, neutral " +
    "summary that members who missed the meeting could read in two minutes. " +
    "Use this structure (no markdown headers, just labeled paragraphs):\n\n" +
    "Overview: 2-3 sentences on the central theme.\n" +
    "Key points: 4-7 short bullet-style lines, each starting with '- '.\n" +
    "Notable quotes: 0-3 short verbatim lines if any stand out (omit if none).\n" +
    "Open questions: 0-3 questions raised that the group did not resolve.\n\n" +
    "Stay faithful to the transcript. Do not invent facts. If the transcript " +
    "is incomplete or unclear, say so briefly."

  const userContent =
    (topic ? `Topic: ${topic}\n\n` : '') +
    `Transcript:\n${transcript}`

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
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
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
  const summary: string =
    (data?.content ?? [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
      .trim()

  if (!summary) return json({ error: 'Anthropic returned no text.' }, { status: 502 })

  return json({ summary })
})
