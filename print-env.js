require('dotenv').config();
console.log((process.env.OPENROUTER_API_KEY||'').slice(0,16));
