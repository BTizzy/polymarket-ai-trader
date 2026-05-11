// Polymarket AI Trading Game

// Config
const MODEL_NAME = 'llama-3.1-70b-versatile'; // Change this to swap models easily

const GAME_CONFIG = {
    startingBankroll: 1000,
    redZoneThreshold: -100, // -10%
    aiWinThreshold: 75, // Min AI prediction %
    safetyWinThreshold: 51, // Min win rate on timeout
    buyPriceRange: [1, 10], // $1-$10 per trade
    timerOptions: [10, 15, 20, 30], // seconds
    maxLossPerTrade: 'buyPrice', // Cap losses
    refreshInterval: 1000, // 1 second for live updates
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

// DOM elements - moved inside initGame to ensure DOM is loaded
let bankrollElement, marketGrid, startSessionBtn, endSessionBtn, sessionReport, reportContent, apiKeySection, groqApiKeyInput, saveApiKeyBtn, tradeModal, tradeQuestion, timerElement, currentPnl, entryPriceElement, currentPriceElement, timerSelect, sellNowBtn, cancelTradeBtn;

// Initialize the game
async function initGame() {
    // Initialize DOM elements after DOM is loaded
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

    // Add event listeners
    startSessionBtn.addEventListener('click', startSession);
    endSessionBtn.addEventListener('click', endSession);
    saveApiKeyBtn.addEventListener('click', saveApiKey);
    sellNowBtn.addEventListener('click', () => endTrade(false));
    cancelTradeBtn.addEventListener('click', cancelTrade);

    updateBankrollDisplay();

    // Always show mock markets initially for testing
    displayMockMarkets();

    // Check for Groq API key
    if (!groqApiKey) {
        apiKeySection.style.display = 'block';
    } else {
        apiKeySection.style.display = 'none';
        // Try to load real markets, but don't wait for it
        loadMarkets().catch(() => {
            // If API fails, mock markets are already shown
            console.log('Using mock markets due to API issues');
        });
    }
}

// Load markets from Polymarket API
async function loadMarkets() {
    try {
        const response = await fetch('https://clob.polymarket.com/markets?limit=20');
        const data = await response.json();
        // Filter and process markets
        markets = await filterMarketsWithAI(data);

        // If no markets passed the AI filter (or API not available), show mock markets to avoid empty UI
        if (!markets || markets.length === 0) {
            console.log('No markets from API/AI filter — showing mock markets for local dev');
            displayMockMarkets();
        } else {
            // Display markets
            displayMarkets(markets);
        }
    } catch (error) {
        console.error('Error loading markets:', error);
        // For now, show some mock markets
        displayMockMarkets();
    }
}

// Filter markets using Groq AI predictions
async function filterMarketsWithAI(marketsData) {
    const filteredMarkets = [];

    for (const market of marketsData) {
        if (market.closed || !market.question || !market.active) continue;

        // Get yes price
        const yesToken = market.tokens.find(token => token.outcome === 'Yes');
        if (!yesToken) continue;
        market.yesPrice = yesToken.price;

        try {
            const aiPrediction = await getGroqPrediction(market.question);
            if (aiPrediction >= GAME_CONFIG.aiWinThreshold) {
                market.aiPrediction = aiPrediction;
                market.volatilityColor = getVolatilityColor(market);
                market.buyPrice = calculateBuyPrice(market);
                filteredMarkets.push(market);
            }
        } catch (error) {
            console.error('Error getting AI prediction:', error);
        }
    }

    return filteredMarkets;
}

// Get AI prediction from Groq
async function getGroqPrediction(question) {
    // Local/dev fallback: if no API key is provided, return a mock prediction so the UI remains functional
    if (!groqApiKey) {
        // Return a deterministic-ish mock prediction in the 76-90 range so markets show up locally
        const mock = 76 + Math.floor(Math.random() * 15);
        console.log('No Groq API key set — returning mock prediction for:', question, mock);
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
                // Use configurable model name
                model: MODEL_NAME,
                messages: [{
                    role: 'user',
                    content: `What is the probability (0-100) that: ${question}? Respond with only a number.`
                }],
                max_tokens: 10
            })
        });

        if (!response.ok) {
            const txt = await response.text();
            console.error('Groq API returned non-OK:', response.status, txt);
            return 0;
        }

        const data = await response.json();
        // Defensive parsing — some responses can include extra whitespace/newlines
        const raw = data?.choices?.[0]?.message?.content || '';
        const prediction = parseFloat(String(raw).trim());
        if (isNaN(prediction)) {
            console.error('Could not parse Groq prediction:', raw);
            return 0;
        }
        return prediction;
    } catch (err) {
        console.error('Error calling Groq API:', err);
        // On any error, return 0 so the filter won't accidentally accept risky markets
        return 0;
    }
}

// Calculate volatility color
function getVolatilityColor(market) {
    // For now, use a simple heuristic based on market data
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

    markets.forEach(market => {
        const square = createMarketSquare(market);
        marketGrid.appendChild(square);
    });
}

// Create a market square element
function createMarketSquare(market) {
    const square = document.createElement('div');
    square.className = `market-square ${market.volatilityColor}`;
    square.innerHTML = `
        <div class="market-question">${market.question}</div>
        <div class="market-price">Buy: $${market.buyPrice}</div>
        <div class="market-volatility">AI: ${market.aiPrediction}% | Vol: ${market.volatilityColor}</div>
    `;

    square.addEventListener('click', () => handleMarketClick(market));
    return square;
}

// Handle market square click
function handleMarketClick(market) {
    if (!sessionActive) {
        alert('Please start a session first!');
        return;
    }

    // Start trade
    startTrade(market);
}

// Display mock markets for testing
function displayMockMarkets() {
    const mockMarkets = [
        {
            question: 'Will Bitcoin reach $100k by end of 2024?',
            aiPrediction: 85,
            volatilityColor: 'green',
            buyPrice: 3
        },
        {
            question: 'Will it rain in New York tomorrow?',
            aiPrediction: 78,
            volatilityColor: 'yellow',
            buyPrice: 5
        },
        {
            question: 'Will Tesla stock go up 10% next week?',
            aiPrediction: 82,
            volatilityColor: 'red',
            buyPrice: 8
        }
    ];

    displayMarkets(mockMarkets);
}

// Update bankroll display
function updateBankrollDisplay() {
    bankrollElement.textContent = currentBankroll;
}

// Event listeners - moved to initGame function
// startSessionBtn.addEventListener('click', startSession);
// endSessionBtn.addEventListener('click', endSession);
// saveApiKeyBtn.addEventListener('click', saveApiKey);
// sellNowBtn.addEventListener('click', () => endTrade(false));
// cancelTradeBtn.addEventListener('click', cancelTrade);

// Start new session
function startSession() {
    sessionActive = true;
    currentBankroll = GAME_CONFIG.startingBankroll;
    sessionStartBankroll = currentBankroll;
    sessionTrades = [];
    updateBankrollDisplay();
    startSessionBtn.disabled = true;
    endSessionBtn.disabled = false;
    sessionReport.style.display = 'none';

    // Reload markets for new session
    loadMarkets();
}

// End current session
function endSession() {
    sessionActive = false;
    startSessionBtn.disabled = false;
    endSessionBtn.disabled = true;

    // Show session report
    showSessionReport();
}

// Show session report
function showSessionReport() {
    const totalTrades = sessionTrades.length;
    const winningTrades = sessionTrades.filter(trade => trade.pnl > 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades * 100).toFixed(1) : 0;
    const totalPnl = sessionTrades.reduce((sum, trade) => sum + trade.pnl, 0);
    const avgHoldTime = totalTrades > 0 ? (sessionTrades.reduce((sum, trade) => sum + trade.duration, 0) / totalTrades).toFixed(1) : 0;

    // Find best and worst trades
    const sortedTrades = [...sessionTrades].sort((a, b) => b.pnl - a.pnl);
    const bestTrade = sortedTrades[0];
    const worstTrade = sortedTrades[sortedTrades.length - 1];

    reportContent.innerHTML = `
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
        </div>

        ${totalTrades > 0 ? `
        <div class="best-worst-trades">
            <h4>Best Trade</h4>
            <p>${bestTrade.market}</p>
            <p class="positive">+$${bestTrade.pnl.toFixed(2)} (${bestTrade.duration.toFixed(1)}s)</p>

            <h4>Worst Trade</h4>
            <p>${worstTrade.market}</p>
            <p class="${worstTrade.pnl >= 0 ? 'positive' : 'negative'}">${worstTrade.pnl >= 0 ? '+' : ''}$${worstTrade.pnl.toFixed(2)} (${worstTrade.duration.toFixed(1)}s)</p>
        </div>
        ` : ''}

        <div class="session-actions">
            <button onclick="startSession()">Start New Session</button>
        </div>
    `;
    sessionReport.style.display = 'block';
}

// Save API key
function saveApiKey() {
    const key = groqApiKeyInput.value.trim();
    if (key) {
        groqApiKey = key;
        localStorage.setItem('groqApiKey', groqApiKey);
        apiKeySection.style.display = 'none';
        // Load markets now that we have the key
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

    // Update modal
    tradeQuestion.textContent = market.question;
    entryPriceElement.textContent = market.yesPrice.toFixed(2);
    currentPriceElement.textContent = market.yesPrice.toFixed(2);
    updatePnlDisplay();

    // Show modal
    tradeModal.style.display = 'flex';

    // Start timer
    startTimer();

    // Start price updates
    startPriceUpdates();
}

// Start countdown timer
function startTimer() {
    timerElement.textContent = currentTrade.timerRemaining;

    tradeTimer = setInterval(() => {
        currentTrade.timerRemaining--;
        timerElement.textContent = currentTrade.timerRemaining;

        if (currentTrade.timerRemaining <= 0) {
            // Auto-sell when timer expires
            endTrade(true);
        }
    }, 1000);
}

// Start real-time price updates
function startPriceUpdates() {
    // For now, simulate price changes. In real implementation, this would poll the API
    priceUpdateInterval = setInterval(() => {
        // Simulate price movement based on volatility
        const volatility = currentTrade.market.volatilityColor;
        let change = 0;

        if (volatility === 'green') {
            change = (Math.random() - 0.5) * 0.02; // Small changes
        } else if (volatility === 'yellow') {
            change = (Math.random() - 0.5) * 0.05; // Medium changes
        } else {
            change = (Math.random() - 0.5) * 0.1; // Large changes
        }

        currentTrade.currentPrice = Math.max(0, Math.min(1, currentTrade.currentPrice + change));
        currentPriceElement.textContent = currentTrade.currentPrice.toFixed(4);
        updatePnlDisplay();

        // Check loss cap
        const pnl = (currentTrade.currentPrice - currentTrade.entryPrice);
        if (pnl <= -currentTrade.market.buyPrice) {
            // Auto-exit on max loss
            endTrade(true);
        }
    }, 1000); // Update every second
}

// Update P&L display
function updatePnlDisplay() {
    const pnl = (currentTrade.currentPrice - currentTrade.entryPrice);
    const pnlFormatted = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;

    currentPnl.textContent = pnlFormatted;
    currentPnl.className = 'pnl-value ' + (pnl >= 0 ? 'positive' : 'negative');
}

// End trade
function endTrade(autoExit = false) {
    // Stop timer and price updates
    if (tradeTimer) {
        clearInterval(tradeTimer);
        tradeTimer = null;
    }
    if (priceUpdateInterval) {
        clearInterval(priceUpdateInterval);
        priceUpdateInterval = null;
    }

    // Calculate final P&L
    const finalPnl = currentTrade.currentPrice - currentTrade.entryPrice;
    const actualPnl = Math.max(-currentTrade.market.buyPrice, finalPnl); // Cap losses

    // Update bankroll
    currentBankroll += actualPnl;
    updateBankrollDisplay();

    // Record trade in session
    const tradeRecord = {
        market: currentTrade.market.question,
        entryPrice: currentTrade.entryPrice,
        exitPrice: currentTrade.currentPrice,
        pnl: actualPnl,
        duration: (Date.now() - currentTrade.startTime) / 1000, // seconds
        timerDuration: currentTrade.timerDuration,
        autoExit: autoExit
    };
    sessionTrades.push(tradeRecord);

    // Check if session should end (red zone)
    if (currentBankroll <= sessionStartBankroll - GAME_CONFIG.redZoneThreshold) {
        endSession();
        return;
    }

    // Hide modal
    tradeModal.style.display = 'none';

    // Reset trade
    currentTrade = null;

    // Show result
    const result = actualPnl >= 0 ? 'win' : 'loss';
    alert(`Trade ${result}! P&L: ${actualPnl >= 0 ? '+' : ''}$${actualPnl.toFixed(2)}`);
}

// Cancel trade (sell at current price)
function cancelTrade() {
    if (currentTrade) {
        endTrade(false);
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', initGame);