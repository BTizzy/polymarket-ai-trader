// Polymarket AI Trading Game

// Config
const MODEL_NAME = 'llama-3.1-70b-versatile';

const GAME_CONFIG = {
    startingBankroll: 1000,
    redZoneThreshold: -100,
    aiWinThreshold: 75,
    safetyWinThreshold: 51,
    buyPriceRange: [1, 10],
    timerOptions: [10, 15, 20, 30],
    maxLossPerTrade: 'buyPrice',
    refreshInterval: 1000,
};

let currentBankroll = GAME_CONFIG.startingBankroll;
let sessionActive = false;
let markets = [];
let groqApiKey = localStorage.getItem('groqApiKey') || '';
let currentTrade = null;
let tradeTimer = null;
let priceUpdateInterval = null;
let sessionTrades = [];
let sessionStartBankroll = GAME_CONFIG.startingBankroll;

let balanceHistory = [];
let marketPriceListeners = new Map();

// DOM elements
let bankrollElement, marketGrid, startSessionBtn, endSessionBtn, sessionReport, reportContent, apiKeySection, groqApiKeyInput, saveApiKeyBtn, tradeModal, tradeQuestion, timerElement, currentPnl, entryPriceElement, currentPriceElement, timerSelect, sellNowBtn, cancelTradeBtn, balanceChart, marketCountEl, winRateChart;

// Initialize the game
async function initGame() {
    bankrollElement = document.getElementById('bankroll');
    marketGrid = document.getElementById('marketGrid');
    startSessionBtn = document.getElementById('startSession');
    endSessionBtn = document.getElementById('endSession');
    sessionReport = document.getElementById('sessionReport');
    reportContent = document.getElementById('reportContent');
    apiKeySection = document.getElementById('apiKeySection');
    groqApiKeyInput = document.getElementById('groqApiKey');
    saveApiKeyBtn = document.getElementById('saveApiKey');
    tradeModal = document.getElementById('tradeModal');
    tradeQuestion = document.getElementById('tradeQuestion');
    timerElement = document.getElementById('timer');
    currentPnl = document.getElementById('currentPnl');
    entryPriceElement = document.getElementById('entryPrice');
    currentPriceElement = document.getElementById('currentPrice');
    timerSelect = document.getElementById('timerSelect');
    sellNowBtn = document.getElementById('sellNowBtn');
    cancelTradeBtn = document.getElementById('cancelTradeBtn');
    balanceChart = document.getElementById('balanceChart');
    marketCountEl = document.getElementById('marketCount');
    winRateChart = document.getElementById('winRateChart');

    // Add event listeners
    startSessionBtn.addEventListener('click', startSession);
    endSessionBtn.addEventListener('click', endSession);
    saveApiKeyBtn.addEventListener('click', saveApiKey);
    sellNowBtn.addEventListener('click', () => endTrade(false));
    cancelTradeBtn.addEventListener('click', cancelTrade);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && currentTrade) {
            e.preventDefault();
            endTrade(false);
        }
        if (e.code === 'Escape' && currentTrade) {
            cancelTrade();
        }
        if (e.code === 'Enter' && currentTrade) {
            e.preventDefault();
            endTrade(false);
        }
    });

    updateBankrollDisplay();

    if (!groqApiKey) {
        apiKeySection.style.display = 'block';
    } else {
        apiKeySection.style.display = 'none';
        loadMarkets();
    }
}

// Fetch with timeout
function fetchWithTimeout(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        fetch(url, { signal: controller.signal })
            .then(response => { clearTimeout(timeout); resolve(response); })
            .catch(err => { clearTimeout(timeout); reject(err); });
    });
}

// Load markets from Polymarket API with retry
async function loadMarkets(retryCount) {
    retryCount = retryCount || 0;
    const maxRetries = 3;
    try {
        const response = await fetchWithTimeout('https://clob.polymarket.com/markets?limit=100', 8000);
        const json = await response.json();
        const data = json.data || json;
        if (!Array.isArray(data)) throw new Error('Invalid API response');
        activeEndpoint = 'primary';
        markets = await filterMarketsWithAI(data);
        if (markets.length === 0) throw new Error('No markets passed AI filter');
        displayMarkets(markets);
        const statusEl = document.getElementById('apiStatus');
        if (statusEl) { statusEl.textContent = '🟢 Live'; statusEl.className = 'status-live'; }
    } catch (error) {
        console.error(`Load attempt ${retryCount + 1} failed:`, error.message);
        if (retryCount < maxRetries) {
            const delay = Math.pow(2, retryCount) * 1000;
            await new Promise(r => setTimeout(r, delay));
            return loadMarkets(retryCount + 1);
        }
        console.log('All retries failed — showing mock markets');
        displayMockMarkets();
        const statusEl = document.getElementById('apiStatus');
        if (statusEl) { statusEl.textContent = '🔴 Offline'; statusEl.className = 'status-offline'; }
    }
}

// Filter markets using Groq AI predictions
async function filterMarketsWithAI(marketsData) {
    const filteredMarkets = [];

    for (const market of marketsData) {
        if (market.closed || market.archived || !market.active || !market.question) continue;

        const tokens = market.tokens || [];
        const hasYesNo = tokens.some(t => t.outcome && t.outcome.toLowerCase() === 'yes') &&
                         tokens.some(t => t.outcome && t.outcome.toLowerCase() === 'no');
        if (!hasYesNo) continue;

        const yesToken = tokens.find(t => t.outcome.toLowerCase() === 'yes');
        market.yesPrice = parseFloat(yesToken.price) || 0;

        try {
            const aiPrediction = await getGroqPrediction(market.question);
            if (aiPrediction >= GAME_CONFIG.aiWinThreshold) {
                market.aiPrediction = aiPrediction;
                market.volatilityColor = getVolatilityColor(market);
                market.buyPrice = calculateBuyPrice(market);
                filteredMarkets.push(market);
            }
        } catch (error) {
            console.error('AI prediction error:', error);
        }
    }

    return filteredMarkets;
}

// Get AI prediction from Groq
async function getGroqPrediction(question) {
    if (!groqApiKey) {
        const mock = 76 + Math.floor(Math.random() * 15);
        return mock;
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${groqApiKey}`
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [{
                    role: 'user',
                    content: `What is the probability (0-100) that this event resolves YES/TRUE? "${question}" Respond with only a number.`
                }],
                max_tokens: 10,
                temperature: 0.1
            })
        });

        if (!response.ok) {
            const txt = await response.text();
            console.error('Groq API error:', response.status, txt);
            return 0;
        }

        const data = await response.json();
        const raw = data?.choices?.[0]?.message?.content || '';
        const prediction = parseFloat(String(raw).trim());
        if (isNaN(prediction)) {
            console.error('Could not parse Groq prediction:', raw);
            return 0;
        }
        return Math.max(0, Math.min(100, prediction));
    } catch (err) {
        console.error('Error calling Groq API:', err);
        return 0;
    }
}

// Calculate volatility color
function getVolatilityColor(market) {
    const volume = market.volume || 0;
    if (volume < 10000) return 'green';
    if (volume < 50000) return 'yellow';
    return 'red';
}

// Calculate buy price based on volatility
function calculateBuyPrice(market) {
    const basePrice = GAME_CONFIG.buyPriceRange[0];
    const maxPrice = GAME_CONFIG.buyPriceRange[1];
    const volatilityMultiplier = market.volatilityColor === 'red' ? 1 :
                                market.volatilityColor === 'yellow' ? 0.7 : 0.4;
    return Math.round(basePrice + (maxPrice - basePrice) * volatilityMultiplier);
}

// Display markets in the grid
function displayMarkets(markets) {
    marketGrid.innerHTML = '';
    if (marketCountEl) marketCountEl.textContent = markets.length;

    markets.forEach(market => {
        const square = createMarketSquare(market);
        marketGrid.appendChild(square);
    });
}

// Create a market square element
function createMarketSquare(market) {
    const square = document.createElement('div');
    square.className = `market-square ${market.volatilityColor}`;
    const pct = ((market.yesPrice || 0) * 100).toFixed(1);
    square.innerHTML = `
        <div class="market-question">${escapeHtml(market.question.substring(0, 100))}</div>
        <div class="market-price">Buy: $${market.buyPrice} | Current: ${pct}%</div>
        <div class="market-volatility">AI: ${market.aiPrediction}% | Vol: ${market.volatilityColor}</div>
    `;

    square.addEventListener('click', () => handleMarketClick(market));
    return square;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Handle market square click
function handleMarketClick(market) {
    if (!sessionActive) {
        alert('Please start a session first!');
        return;
    }
    startTrade(market);
}

// Display mock markets for testing
function displayMockMarkets() {
    const mockMarkets = [
        { question: 'Will Bitcoin reach $100k by end of 2024?', aiPrediction: 85, volatilityColor: 'green', buyPrice: 3, yesPrice: 0.85 },
        { question: 'Will it rain in New York tomorrow?', aiPrediction: 78, volatilityColor: 'yellow', buyPrice: 5, yesPrice: 0.78 },
        { question: 'Will Tesla stock go up 10% next week?', aiPrediction: 82, volatilityColor: 'red', buyPrice: 8, yesPrice: 0.82 }
    ];
    displayMarkets(mockMarkets);
}

// Update bankroll display
function updateBankrollDisplay() {
    bankrollElement.textContent = currentBankroll.toFixed(2);
}

// Start new session
function startSession() {
    sessionActive = true;
    currentBankroll = GAME_CONFIG.startingBankroll;
    balanceHistory = [currentBankroll];
    sessionStartBankroll = currentBankroll;
    sessionTrades = [];
    updateBankrollDisplay();
    startSessionBtn.disabled = true;
    endSessionBtn.disabled = false;
    sessionReport.style.display = 'none';
    loadMarkets();
}

// End current session
function endSession() {
    sessionActive = false;
    startSessionBtn.disabled = false;
    endSessionBtn.disabled = true;
    showSessionReport();
}

// Show session report
function showSessionReport() {
    const totalTrades = sessionTrades.length;
    const winningTrades = sessionTrades.filter(t => t.pnl > 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades * 100).toFixed(1) : 0;
    const totalPnl = sessionTrades.reduce((sum, t) => sum + t.pnl, 0);
    const avgHoldTime = totalTrades > 0 ? (sessionTrades.reduce((sum, t) => sum + t.duration, 0) / totalTrades).toFixed(1) : 0;

    const sortedTrades = [...sessionTrades].sort((a, b) => b.pnl - a.pnl);
    const bestTrade = sortedTrades[0];
    const worstTrade = sortedTrades[sortedTrades.length - 1];

    let html = `
        <div class="report-stats">
            <div class="stat-item">
                <span class="stat-label">Win Rate:</span>
                <span class="stat-value">${winRate}%</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Total P&L:</span>
                <span class="stat-value ${totalPnl >= 0 ? 'positive' : 'negative'}">${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Total Trades:</span>
                <span class="stat-value">${totalTrades}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Avg Hold Time:</span>
                <span class="stat-value">${avgHoldTime}s</span>
            </div>
        </div>`;

    if (totalTrades > 0) {
        html += `<div class="best-worst-trades">
            <h4>Best Trade</h4>
            <p>${bestTrade.market.substring(0, 80)}</p>
            <p class="positive">+$${bestTrade.pnl.toFixed(2)} (${bestTrade.duration.toFixed(1)}s)</p>
            <h4>Worst Trade</h4>
            <p>${worstTrade.market.substring(0, 80)}</p>
            <p class="${worstTrade.pnl >= 0 ? 'positive' : 'negative'}">${worstTrade.pnl >= 0 ? '+' : ''}$${worstTrade.pnl.toFixed(2)} (${worstTrade.duration.toFixed(1)}s)</p>
        </div>`;
    }

    // Session balance chart (simple ASCII sparkline)
    if (balanceHistory.length > 1) {
        const min = Math.min(...balanceHistory);
        const max = Math.max(...balanceHistory);
        const range = max - min || 1;
        const height = 5;
        const width = Math.min(balanceHistory.length, 60);
        const recent = balanceHistory.slice(-width);
        let chart = '\nBalance History:\n';
        for (let row = height; row >= 0; row--) {
            let line = '';
            const threshold = min + (range * row / height);
            for (let i = 0; i < recent.length; i++) {
                line += recent[i] >= threshold ? '█' : ' ';
            }
            chart += line + '\n';
        }
        html += `<pre class="balance-chart">${chart}</pre>`;
    }

    html += `<div class="session-actions"><button onclick="startSession()">Start New Session</button></div>`;
    reportContent.innerHTML = html;
    sessionReport.style.display = 'block';
}

// Save API key
function saveApiKey() {
    const key = groqApiKeyInput.value.trim();
    if (key) {
        groqApiKey = key;
        localStorage.setItem('groqApiKey', groqApiKey);
        apiKeySection.style.display = 'none';
        loadMarkets();
    } else {
        alert('Please enter a valid API key.');
    }
}

// Start a trade
function startTrade(market) {
    currentTrade = {
        market: market,
        entryPrice: market.yesPrice,
        currentPrice: market.yesPrice,
        startTime: Date.now(),
        timerDuration: parseInt(timerSelect.value),
        timerRemaining: parseInt(timerSelect.value)
    };

    tradeQuestion.textContent = market.question.substring(0, 120);
    entryPriceElement.textContent = market.yesPrice.toFixed(4);
    currentPriceElement.textContent = market.yesPrice.toFixed(4);
    updatePnlDisplay();

    tradeModal.style.display = 'flex';
    startTimer();
    startPriceUpdates();
}

// Start countdown timer
function startTimer() {
    timerElement.textContent = currentTrade.timerRemaining;
    tradeTimer = setInterval(() => {
        currentTrade.timerRemaining--;
        timerElement.textContent = currentTrade.timerRemaining;
        if (currentTrade.timerRemaining <= 5 && currentTrade.timerRemaining > 0) {
            timerElement.parentElement.classList.add('timer-warning');
        }
        if (currentTrade.timerRemaining <= 0) {
            endTrade(true);
        }
    }, 1000);
}

// Start simulated price updates
function startPriceUpdates() {
    priceUpdateInterval = setInterval(() => {
        if (!currentTrade) return;
        const volatility = currentTrade.market.volatilityColor;
        let change = 0;
        if (volatility === 'green') {
            change = (Math.random() - 0.5) * 0.005;
        } else if (volatility === 'yellow') {
            change = (Math.random() - 0.5) * 0.02;
        } else {
            change = (Math.random() - 0.5) * 0.05;
        }

        currentTrade.currentPrice = Math.max(0, Math.min(1, currentTrade.currentPrice + change));
        currentPriceElement.textContent = currentTrade.currentPrice.toFixed(4);
        updatePnlDisplay();

        const pnl = (currentTrade.currentPrice - currentTrade.entryPrice);
        if (pnl <= -currentTrade.market.buyPrice) {
            endTrade(true);
        }
    }, 1000);
}

// Update P&L display
function updatePnlDisplay() {
    if (!currentTrade) return;
    const pnl = (currentTrade.currentPrice - currentTrade.entryPrice);
    const pnlFormatted = pnl >= 0 ? `+$${pnl.toFixed(4)}` : `-$${Math.abs(pnl).toFixed(4)}`;
    currentPnl.textContent = pnlFormatted;
    currentPnl.className = 'pnl-value ' + (pnl >= 0 ? 'positive' : 'negative');
}

// End trade
function endTrade(autoExit = false) {
    if (tradeTimer) { clearInterval(tradeTimer); tradeTimer = null; }
    if (priceUpdateInterval) { clearInterval(priceUpdateInterval); priceUpdateInterval = null; }

    const finalPnl = currentTrade.currentPrice - currentTrade.entryPrice;
    const actualPnl = Math.max(-currentTrade.market.buyPrice, finalPnl);

    currentBankroll += actualPnl;
    balanceHistory.push(currentBankroll);
    updateBankrollDisplay();

    sessionTrades.push({
        market: currentTrade.market.question.substring(0, 120),
        entryPrice: currentTrade.entryPrice,
        exitPrice: currentTrade.currentPrice,
        pnl: actualPnl,
        duration: (Date.now() - currentTrade.startTime) / 1000,
        timerDuration: currentTrade.timerDuration,
        autoExit: autoExit
    });

    if (currentBankroll <= sessionStartBankroll - GAME_CONFIG.redZoneThreshold) {
        endSession();
        return;
    }

    tradeModal.style.display = 'none';
    currentTrade = null;

    const result = actualPnl >= 0 ? 'WIN' : 'LOSS';
    const emoji = actualPnl >= 0 ? '🎉' : '😬';
    showToast(`${emoji} ${result}: ${actualPnl >= 0 ? '+' : ''}$${actualPnl.toFixed(4)}`);
}

// Cancel trade
function cancelTrade() {
    if (currentTrade) endTrade(false);
}

// Toast notification (replaces annoying alert)
function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

document.addEventListener('DOMContentLoaded', initGame);