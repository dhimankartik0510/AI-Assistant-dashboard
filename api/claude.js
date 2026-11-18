export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const apiKey = req.headers['x-api-key'] || body.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(400).json({
      error: 'Claude API key is required. Please add your Anthropic API key in the AI Assistant settings or set ANTHROPIC_API_KEY in Vercel environment variables.'
    });
  }

  const {
    prompt,
    model = 'claude-3-5-sonnet-20241022',
    messages = [],
    context = {}
  } = body;

  let chatMessages = [];
  if (Array.isArray(messages) && messages.length > 0) {
    chatMessages = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: String(m.content || '')
    }));
  } else if (prompt) {
    chatMessages = [{ role: 'user', content: String(prompt) }];
  } else {
    return res.status(400).json({ error: 'Prompt or messages required.' });
  }

  const systemPrompt = `You are an elite Meta Ads strategist, media buyer, and performance marketing auditor with deep technical expertise in Meta Ads algorithms (auction mechanics, Learning Phase, CPM drivers, CTR optimization, creative fatigue, pixel/CAPI attribution, audience overlap, bidding strategies).
You analyze the provided live campaign data and give actionable, direct, and high-impact advice.
Always be specific, citing exact campaign names, numbers (spend, CTR, CPR, CPM, reach), and explain the ROOT CAUSE of any issues followed by step-by-step remediation instructions.
Keep your analysis organized with clear sections, bullet points, and specific action items.

CURRENT DASHBOARD CONTEXT:
Ad Account: ${context.accountName || 'Unknown'} (${context.currency || '₹'})
Date Preset: ${context.datePreset || 'last_30d'}
Total Spend: ${context.totalSpend || '—'}
Total Results: ${context.totalResults || '—'}
Average CPR: ${context.avgCpr || '—'}
Active Goal Filter: ${context.goalFilter || 'All'}

LIVE CAMPAIGNS BREAKDOWN:
${JSON.stringify(context.campaigns || [], null, 2)}
`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'claude-3-5-sonnet-20241022',
        max_tokens: 2500,
        system: systemPrompt,
        messages: chatMessages
      })
    });

    const text = await claudeRes.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: { message: text } };
    }

    if (!claudeRes.ok || data.error) {
      const errDetail = data.error?.message || data.error || `Anthropic returned HTTP ${claudeRes.status}`;
      return res.status(claudeRes.status || 400).json({ error: errDetail });
    }

    const replyText = data.content?.[0]?.text || '';
    return res.status(200).json({
      success: true,
      text: replyText,
      usage: data.usage
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error while contacting Claude API' });
  }
}
