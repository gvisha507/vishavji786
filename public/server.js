const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const https = require('https');
const { v4: uuid } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function checkTopUpPlans(response) {
  return response.planCategories.some(plan => plan.type === "Top-up");
}

async function register(mobileNumber, id) {
  const options = {
    httpsAgent: new https.Agent({
      secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
    }),
  };

  const response = await axios.get(`https://www.jio.com/api/jio-recharge-service/recharge/mobility/number/${mobileNumber}`, {
    ...options,
    headers: {
      'Host': 'www.jio.com',
      'Cookie': `JioSessionID=${id}; ssjsid=${id};`,
    }
  });

  let auth = "";
  for (let header of response.headers['set-cookie'] || []) {
    const [key, value] = header.split("=");
    if (key?.toLowerCase() === 'authorization') {
      auth = value.split(';')[0];
      break;
    }
  }

  if (!auth) throw new Error('Authorization failed');

  return await getRechargePlans(mobileNumber, auth, id);
}

async function getRechargePlans(mobileNumber, auth, id) {
  const options = {
    httpsAgent: new https.Agent({
      secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
    }),
  };

  const response = await axios.get(`https://www.jio.com/api/jio-recharge-service/recharge/plans/serviceId/${mobileNumber}`, {
    ...options,
    headers: {
      'Host': 'www.jio.com',
      'Cookie': `JioSessionID=${id}; ssjsid=${id}; Authorization=${auth};`,
    }
  });

  return checkTopUpPlans(response.data);
}

async function processInBatches(numbers, batchSize = 20, delay = 1000) {
  const results = [];

  for (let i = 0; i < numbers.length; i += batchSize) {
    const batch = numbers.slice(i, i + batchSize);

    const batchResults = await Promise.all(batch.map(async (mobileNumber) => {
      try {
        const id = uuid();
        const isTopUpAvailable = await register(mobileNumber, id);
        return { mobileNumber, isTopUpAvailable };
      } catch (err) {
        return { mobileNumber, isTopUpAvailable: false, error: err.message };
      }
    }));

    results.push(...batchResults);

    if (i + batchSize < numbers.length) {
      await sleep(delay);
    }
  }

  return results;
}

app.post('/check-topup-bulk', async (req, res) => {
  const { mobileNumbers } = req.body;

  try {
    const results = await processInBatches(mobileNumbers, 20, 1000);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
