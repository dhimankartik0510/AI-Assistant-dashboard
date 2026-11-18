export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.META_ACCESS_TOKEN;

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const {
    action = 'campaigns',
    account_id,
    date_preset = 'last_30d',
    campaign_id,
    adset_id
  } = req.query;

  const BASE = 'https://graph.facebook.com/v20.0';

  try {
    let url;

    // ── Claude AI Assistant Action ───────────────────────────────────────────
    if (action === 'claude' || action === 'ai') {
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
      try { data = JSON.parse(text); } catch { data = { error: { message: text } }; }

      if (!claudeRes.ok || data.error) {
        const errDetail = data.error?.message || data.error || `Anthropic returned HTTP ${claudeRes.status}`;
        return res.status(claudeRes.status || 400).json({ error: errDetail });
      }

      return res.status(200).json({
        success: true,
        text: data.content?.[0]?.text || '',
        usage: data.usage
      });
    }

    // ── Meta Ads Actions ─────────────────────────────────────────────────────
    if (!token) {
      return res.status(500).json({
        error: 'META_ACCESS_TOKEN environment variable is not set in Vercel.'
      });
    }

    // ── Accounts ──
    if (action === 'accounts') {
      url = `${BASE}/me/adaccounts?fields=name,account_id,currency,account_status&limit=50&access_token=${token}`;
    }

    // ── Account-Level Insights ──
    else if (action === 'insights') {
      if (!account_id) return res.status(400).json({ error: 'account_id required' });
      const fields = [
        'spend', 'impressions', 'clicks', 'cpm', 'ctr',
        'reach', 'frequency', 'actions', 'cost_per_action_type',
        'date_start', 'date_stop'
      ].join(',');
      url = `${BASE}/act_${account_id}/insights?fields=${fields}&date_preset=${date_preset}&access_token=${token}`;
    }

    // ── Daily Breakdown ──
    else if (action === 'daily') {
      if (!account_id) return res.status(400).json({ error: 'account_id required' });
      url = `${BASE}/act_${account_id}/insights?fields=spend,impressions,clicks,date_start&date_preset=${date_preset}&time_increment=1&access_token=${token}`;
    }

    // ── Campaigns ──
    else if (action === 'campaigns') {
      if (!account_id) return res.status(400).json({ error: 'account_id required' });
      const fields        = 'name,status,objective';
      const insight_fields = 'spend,impressions,clicks,cpm,ctr,actions,reach,cost_per_action_type';
      url = `${BASE}/act_${account_id}/campaigns?fields=${fields},insights.date_preset(${date_preset}){${insight_fields}}&limit=100&access_token=${token}`;
    }

    // ── Ad Sets ──
    else if (action === 'adsets') {
      if (!campaign_id) return res.status(400).json({ error: 'campaign_id required' });
      const fields        = 'name,status,targeting,optimization_goal,billing_event,daily_budget,lifetime_budget';
      const insight_fields = 'spend,impressions,clicks,cpm,ctr,actions,reach,frequency,cost_per_action_type';
      url = `${BASE}/${campaign_id}/adsets?fields=${fields},insights.date_preset(${date_preset}){${insight_fields}}&limit=50&access_token=${token}`;
    }

    // ── Ads (Creatives) ──
    else if (action === 'ads') {
      if (!adset_id) return res.status(400).json({ error: 'adset_id required' });
      const fields        = 'name,status,creative{name,thumbnail_url,object_story_spec,title,body,call_to_action_type}';
      const insight_fields = 'spend,impressions,clicks,cpm,ctr,actions';
      url = `${BASE}/${adset_id}/ads?fields=${fields},insights.date_preset(${date_preset}){${insight_fields}}&limit=50&access_token=${token}`;
    }

    else {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      const msg = parsed?.error?.message || parsed?.error || `Meta API returned HTTP ${response.status}`;
      return res.status(response.status).json({ error: msg });
    }

    const data = await response.json();

    if (data.error) {
      const msg = data.error.message || data.error.error_user_msg || JSON.stringify(data.error);
      return res.status(400).json({ error: msg });
    }

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
