const express = require('express');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch');
const app = express();

app.use(express.json());

const USER_AGENTS = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.196 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 12; Samsung Galaxy S21) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.5672.132 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.5615.137 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.5563.58 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 9; Mi 9T Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.5414.117 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 13_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.2 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 8.1.0; Moto G6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.128 Mobile Safari/537.36"
];

const PROXIES = [
  'http://pf1:aohO1vFtktPqpxrZMF4j:core-residential.evomi.com:1000'
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function countPageIds(html) {
  const matches = html.match(/page_id/g);
  return matches ? matches.length : 0;
}

function extractSocialMetrics(html) {
  try {
    const input = {
      all: () => [{
        json: {
          data: html
        }
      }]
    };

    const results = input.all().map(item => {
      try {
        const rawData = item?.json?.data;
        if (!rawData) throw new Error("No 'data' field found in the input JSON.");
        
        const matches = [];
        let match;
        const primaryRegex = /"text":"([\d.,]+(?:\u00a0)?[KM]?)\s*(?:followers?|(?:j'aime|J\u2019aime|likes?))"/gi;
        const dataString = typeof rawData === "string" ? rawData : JSON.stringify(rawData);
        
        while ((match = primaryRegex.exec(dataString)) !== null) {
          const isLike = /j'aime|J\u2019aime|likes?/i.test(match[0]);
          const type = isLike ? "like" : "follower";
          let value = match[1].replace('\u00a0', '').replace(/[KM]/, '');
          if (value.includes(',') && value.includes('.')) value = value.replace(',', '');
          else if (value.includes(',')) value = value.replace(',', '.');
          value = parseFloat(value);
          if (match[1].includes('K')) value *= 1000;
          if (match[1].includes('M')) value *= 1000000;

          matches.push({ sentence: match[0], value, type });
        }
        return { json: { matches } };
      } catch (error) {
        return { json: { error: error.message, matches: [] } };
      }
    });

    const metrics = results[0]?.json?.matches || [];
    const likes = metrics.find(m => m.type === 'like')?.value || null;
    const followers = metrics.find(m => m.type === 'follower')?.value || null;

    return { likes, followers };

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error extracting social metrics:`, error);
    return { likes: null, followers: null };
  }
}

async function fetchWithSequentialProxies(url, options, maxAttempts = 4) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const currentProxy = PROXIES[0];
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    console.log(`[FETCH] Attempt ${attempt}/${maxAttempts} using proxy: ${currentProxy}`);

    try {
      const proxyAgent = new HttpsProxyAgent(currentProxy);
      const response = await fetch(url, {
        ...options,
        agent: proxyAgent,
        headers: {
          ...options.headers,
          'User-Agent': randomUserAgent
        }
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const html = await response.text();
      const pageIdCount = countPageIds(html);
      console.log(`[FETCH] Found ${pageIdCount} page_ids on attempt ${attempt}`);

      if (pageIdCount <= 2 && attempt < maxAttempts) {
        console.log(`[FETCH] Too few page_ids, trying again...`);
        await sleep(1000);
        continue;
      }

      return { response, html };

    } catch (error) {
      lastError = error;
      console.error(`[FETCH] Attempt ${attempt} failed:`, {
        error: error.message,
        proxy: currentProxy
      });

      if (attempt < maxAttempts) {
        console.log(`[FETCH] Waiting 1000ms before next attempt...`);
        await sleep(1000);
      }
    }
  }

  throw lastError;
}

app.get('/', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

app.get('/scrape', async (req, res) => {
  const query = req.query.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });

  try {
    const { html } = await fetchWithSequentialProxies(query, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1'
      },
      timeout: 10000
    });

    const { likes, followers } = extractSocialMetrics(html);
    const pageIdCount = countPageIds(html);

    res.json({ 
      url: query,
      likes,
      followers,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Final error for ${query}:`, {
      message: error.message,
      name: error.name
    });

    res.status(500).json({ 
      error: 'Scraping failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Server started on port ${PORT}`);
});
