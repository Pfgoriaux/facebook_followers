const express = require('express');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch');
const app = express();

app.use(express.json());

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:106.0) Gecko/20100101 Firefox/106.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/112.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.75 Safari/537.36 Edg/100.0.1185.39",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.5481.100 Safari/537.36 OPR/90.0.1234.567",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_2_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:97.0) Gecko/20100101 Firefox/97.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_2_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.99 Safari/537.36 Edg/97.0.1072.62",
  "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.110 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/115.0",
  "Mozilla/5.0 (X11; Linux i686; rv:68.0) Gecko/20100101 Firefox/68.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko",
  "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.85 Safari/537.36"
];

const PROXIES = [
  'http://pf1:aohO1vFtktPqpxrZMF4j@core-residential.evomi.com:1000',
  'http://hp_default_user_9d2ab612:HyPEqCFtcvjB57IubfvNY@hdc2.hypeproxy.host:7823',
  'http://hp_default_user_58fab94e:HYpeRRzxm6wswJlDtlKIn@lte.hypeproxy.host:7216'
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
        if (!rawData) {
          throw new Error("No 'data' field found in the input JSON.");
        }
        
        const matches = [];
        let match;
        const primaryRegex = /"text":"([\d.,]+(?:\u00a0)?[KM]?)\s*(?:followers?|(?:j'aime|J\u2019aime|likes?))"/gi;
        const dataString = typeof rawData === "string" ? rawData : JSON.stringify(rawData);
        
        while ((match = primaryRegex.exec(dataString)) !== null) {
          const isLike = /j'aime|J\u2019aime|likes?/i.test(match[0]);
          const type = isLike ? "like" : "follower";
          
          let value = match[1];
          const hasK = value.includes('K');
          const hasM = value.includes('M');
          
          value = value.replace('\u00a0', '').replace(/[KM]/, '');
          
          if (value.includes(',') && value.includes('.')) {
            value = value.replace(',', '');
          } else if (value.includes(',')) {
            value = value.replace(',', '.');
          }
          
          value = parseFloat(value);
          
          if (hasK) {
            value = value * 1000;
          } else if (hasM) {
            value = value * 1000000;
          }

          matches.push({
            sentence: match[0],
            value: value,
            type: type
          });
        }
        
        return {
          json: {
            matches: matches
          }
        };
      } catch (error) {
        return {
          json: {
            error: error.message,
            matches: []
          }
        };
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
  const mainProxy = PROXIES[0];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let currentProxy;
    if (attempt === 1) {
      currentProxy = mainProxy;
    } else if (attempt === 2) {
      currentProxy = mainProxy;
    } else if (attempt === 3) {
      currentProxy = PROXIES[1];
    } else if (attempt === 4) {
      currentProxy = PROXIES[2];
    }
    
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

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const html = await response.text();
      const pageIdCount = countPageIds(html);
      console.log(`[FETCH] Found ${pageIdCount} page_ids on attempt ${attempt}`);

      if (pageIdCount <= 2 && attempt < maxAttempts) {
        console.log(`[FETCH] Too few page_ids, trying next proxy`);
        const delay = 1000;
        await sleep(delay);
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
        const delay = 1000;
        console.log(`[FETCH] Waiting ${delay}ms before next attempt...`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

app.get('/scrape', async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

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

    // Check for unavailable content
    const contentUnavailable = (
      html.includes("This content isn't available at the moment") ||
      html.includes('"title":"This content isn\'t available at the moment"')
    );

    if (contentUnavailable) {
      console.warn(`[SCRAPE] Content unavailable for ${query}`);
      return res.status(404).json({
        error: 'Content not available',
        timestamp: new Date().toISOString()
      });
    }

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
