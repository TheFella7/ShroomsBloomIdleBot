// bot.js - Shrooms Bloom Idle Telegram Bot
// =============================================

const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// =============================================
// CONFIGURATION
// =============================================

const token = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL = process.env.SUPABASE_URL || "https://qeoaifwzriwerxzlzycp.supabase.co";
const SB_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlb2FpZnd6cml3ZXJ4emx6eWNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1ODA4ODIsImV4cCI6MjA4MzE1Njg4Mn0.pjzz8ssJsEEOa9_W5Z32aL-S2QBq55B3zQSTOLC4N4c";

// =============================================
// INITIALIZE SERVICES
// =============================================

const bot = new TelegramBot(token, { polling: true });
const supabase = createClient(SB_URL, SB_KEY);

console.log('🚀 Shrooms Bloom Idle Bot starting...');

// =============================================
// GAME STATE & CONSTANTS
// =============================================

// In-memory cache for active users (will sync with database)
const userCache = new Map();

// Game constants
const UPGRADES = [
    { id: 'u1', name: 'Spore Collector', base: 15, rate: 1, emoji: '🟢' },
    { id: 'u2', name: 'Fungal Patch', base: 150, rate: 10, emoji: '🍄' },
    { id: 'u3', name: 'Ancient Grove', base: 2000, rate: 85, emoji: '🌳' },
    { id: 'u4', name: 'Spirit Tapper', base: 18000, rate: 450, emoji: '👻' },
    { id: 'u5', name: 'Void Mycelium', base: 150000, rate: 2200, emoji: '⚫' },
    { id: 'u6', name: 'Cosmic Cloud', base: 1200000, rate: 15000, emoji: '☁️' }
];

// =============================================
// HELPER FUNCTIONS
// =============================================

function formatNumber(n) {
    if (n === null || n === undefined || isNaN(n) || n < 0) return "0";
    if (n < 1000) return Math.floor(n).toLocaleString();
    
    const abbrevs = ["k", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
    let tier = Math.floor(Math.log10(n) / 3);
    
    if (tier < abbrevs.length + 1 && tier > 0) {
        return (n / Math.pow(10, tier * 3)).toFixed(2) + abbrevs[tier - 1];
    }
    return n.toExponential(2);
}

function getCurrentWeekId() {
    return Math.floor((Date.now() + 345600000) / 604800000);
}

function generateUserId(telegramId) {
    return `tg_${telegramId}`;
}

async function getUserState(userId, telegramUser) {
    // Check cache first
    if (userCache.has(userId)) {
        const cached = userCache.get(userId);
        const now = Date.now();
        const offlineTime = (now - cached.lastActive) / 1000;
        
        // Calculate offline gains
        if (offlineTime > 10) {
            const sps = calculateSPS(cached);
            const offlineGain = Math.floor(sps * Math.min(offlineTime, 259200)); // Max 3 days
            cached.spores += offlineGain;
            if (cached.joinedEvent && cached.savedEventWeekId === getCurrentWeekId()) {
                cached.eventSpores += offlineGain;
            }
            cached.lastActive = now;
        }
        return cached;
    }
    
    // Load from database
    try {
        const { data, error } = await supabase
            .from('leaderboard')
            .select('*')
            .eq('player_id', userId)
            .single();
        
        if (error || !data) {
            // New user
            const newUser = {
                player_id: userId,
                username: telegramUser.username || telegramUser.first_name || `User_${userId}`,
                spores: 0,
                mushrooms: 0,
                ascensions: 0,
                level: 1,
                playerXP: 0,
                event_boost: 0,
                premium_boost: 0,
                upgrades: { u1: 0, u2: 0, u3: 0, u4: 0, u5: 0, u6: 0 },
                frenzyClicks: 0,
                frenzyCooldown: 0,
                frenzyTimer: 0,
                joinedEvent: false,
                eventSpores: 0,
                savedEventWeekId: 0,
                totalMultiplier: 1.00,
                lastActive: Date.now(),
                platform: 'telegram',
                chat_id: telegramUser.id,
                created_at: new Date().toISOString()
            };
            
            // Save to database
            await supabase.from('leaderboard').insert(newUser);
            userCache.set(userId, newUser);
            return newUser;
        }
        
        // Existing user - convert database data to game state
        const userState = {
            player_id: data.player_id,
            username: data.username,
            spores: Number(data.spores) || 0,
            mushrooms: Number(data.mushrooms) || 0,
            ascensions: Number(data.ascensions) || 0,
            level: Number(data.level) || 1,
            playerXP: Number(data.playerXP) || 0,
            event_boost: Number(data.event_boost) || 0,
            premium_boost: Number(data.premium_boost) || 0,
            upgrades: data.upgrades || { u1: 0, u2: 0, u3: 0, u4: 0, u5: 0, u6: 0 },
            frenzyClicks: Number(data.frenzyClicks) || 0,
            frenzyCooldown: Number(data.frenzyCooldown) || 0,
            frenzyTimer: Number(data.frenzyTimer) || 0,
            joinedEvent: Boolean(data.joinedEvent) || false,
            eventSpores: Number(data.eventSpores) || 0,
            savedEventWeekId: Number(data.savedEventWeekId) || 0,
            totalMultiplier: Number(data.totalMultiplier) || 1.00,
            lastActive: Date.now(),
            platform: data.platform || 'telegram',
            chat_id: data.chat_id || telegramUser.id
        };
        
        // Calculate offline gains
        const now = Date.now();
        const lastSeen = new Date(data.last_seen || data.created_at).getTime();
        const offlineTime = (now - lastSeen) / 1000;
        
        if (offlineTime > 10) {
            const sps = calculateSPS(userState);
            const offlineGain = Math.floor(sps * Math.min(offlineTime, 259200));
            userState.spores += offlineGain;
            if (userState.joinedEvent && userState.savedEventWeekId === getCurrentWeekId()) {
                userState.eventSpores += offlineGain;
            }
        }
        
        userCache.set(userId, userState);
        return userState;
        
    } catch (error) {
        console.error('Error loading user state:', error);
        // Return default state
        return {
            player_id: userId,
            username: telegramUser.username || telegramUser.first_name || `User_${userId}`,
            spores: 0,
            mushrooms: 0,
            ascensions: 0,
            level: 1,
            playerXP: 0,
            event_boost: 0,
            premium_boost: 0,
            upgrades: { u1: 0, u2: 0, u3: 0, u4: 0, u5: 0, u6: 0 },
            frenzyClicks: 0,
            frenzyCooldown: 0,
            frenzyTimer: 0,
            joinedEvent: false,
            eventSpores: 0,
            savedEventWeekId: 0,
            totalMultiplier: 1.00,
            lastActive: Date.now(),
            platform: 'telegram',
            chat_id: telegramUser.id
        };
    }
}

async function saveUserState(userState) {
    try {
        const userId = userState.player_id;
        userCache.set(userId, { ...userState, lastActive: Date.now() });
        
        await supabase.from('leaderboard').upsert({
            player_id: userId,
            username: userState.username,
            spores: Math.floor(userState.spores),
            mushrooms: Math.floor(userState.mushrooms),
            ascensions: userState.ascensions,
            level: userState.level,
            playerXP: userState.playerXP,
            event_boost: userState.event_boost,
            premium_boost: userState.premium_boost,
            upgrades: userState.upgrades,
            frenzyClicks: userState.frenzyClicks,
            frenzyCooldown: userState.frenzyCooldown,
            frenzyTimer: userState.frenzyTimer,
            joinedEvent: userState.joinedEvent,
            eventSpores: Math.floor(userState.eventSpores),
            savedEventWeekId: userState.savedEventWeekId,
            totalMultiplier: calculateTotalMultiplier(userState),
            last_seen: new Date().toISOString(),
            platform: 'telegram',
            chat_id: userState.chat_id
        }, { onConflict: 'player_id' });
        
        // Update weekly leaderboard if in event
        if (userState.joinedEvent && userState.savedEventWeekId === getCurrentWeekId()) {
            await supabase.from('weekly_leaderboard').upsert({
                week_id: userState.savedEventWeekId,
                player_id: userId,
                username: userState.username,
                spores: Math.floor(userState.eventSpores)
            }, { onConflict: 'week_id,player_id' });
        }
        
    } catch (error) {
        console.error('Error saving user state:', error);
    }
}

function calculateSPS(userState) {
    let sps = 0;
    for (let i = 0; i < UPGRADES.length; i++) {
        const upgrade = UPGRADES[i];
        const qty = userState.upgrades[upgrade.id] || 0;
        sps += qty * upgrade.rate;
    }
    return sps * calculateTotalMultiplier(userState);
}

function calculateTotalMultiplier(userState) {
    return (1 + (userState.premium_boost || 0) + (userState.event_boost || 0) + (userState.ascensions * 1.0));
}

function getNextXP(userState) {
    return Math.floor(100 * Math.pow(1.5, Math.max(0, userState.level - 1)));
}

function addXP(userState, amount) {
    userState.playerXP += amount;
    let next = getNextXP(userState);
    let safety = 0;
    
    while (userState.playerXP >= next && userState.level < 1000000 && safety < 100) {
        userState.playerXP -= next;
        userState.level++;
        next = getNextXP(userState);
        safety++;
    }
}

// =============================================
// COMMAND HANDLERS
// =============================================

// /start command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = generateUserId(msg.from.id);
    const user = await getUserState(userId, msg.from);
    
    const keyboard = {
        reply_markup: {
            keyboard: [
                ['🍄 Click Mushroom', '📊 My Stats'],
                ['🛒 Buy Upgrades', '🏆 Leaderboard'],
                ['💬 Global Chat', '🎯 Weekly Event'],
                ['💾 Save Game', '❓ Help']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    };
    
    const welcomeMessage = `
🍄 *WELCOME TO SHROOMS BLOOM IDLE!* 🍄

*Your fungal empire awaits!*

*Commands:*
🍄 /click - Tap the mushroom
📊 /stats - View your progress
🛒 /upgrades - Buy automation upgrades
🏆 /leaderboard - Global rankings
🎯 /event - Weekly event info
💬 /chat - Send global message
💾 /save - Manual save
❓ /help - Show all commands

*Quick Stats:*
Spores: *${formatNumber(user.spores)}*
Level: *${user.level}*
Spores/sec: *${formatNumber(calculateSPS(user))}*
Multiplier: *x${calculateTotalMultiplier(user).toFixed(2)}*

Tap "🍄 Click Mushroom" to begin!
    `;
    
    bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        ...keyboard
    });
    
    saveUserState(user);
});

// /click command
bot.onText(/\/click|🍄 Click Mushroom/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = generateUserId(msg.from.id);
    const user = await getUserState(userId, msg.from);
    
    // Calculate gain
    const gain = 1 * calculateTotalMultiplier(user);
    user.spores += gain;
    
    // Add XP
    addXP(user, 1);
    
    // Handle frenzy
    if (user.frenzyTimer > 0) {
        user.frenzyTimer = 15;
    } else if (user.frenzyCooldown <= 0) {
        user.frenzyClicks++;
        if (user.frenzyClicks >= 50) {
            user.frenzyTimer = 15;
            user.frenzyClicks = 0;
        }
    }
    
    // Update event spores if joined
    if (user.joinedEvent && user.savedEventWeekId === getCurrentWeekId()) {
        user.eventSpores += gain;
    }
    
    // Save and respond
    await saveUserState(user);
    
    const frenzyText = user.frenzyTimer > 0 ? '🔥 *FRENZY ACTIVE!* 🔥\n' : '';
    const frenzyProgress = user.frenzyTimer <= 0 && user.frenzyCooldown <= 0 ? 
        `Frenzy: ${user.frenzyClicks}/50 clicks\n` : '';
    
    bot.sendMessage(chatId, `
${frenzyText}🍄 *MUSHROOM CLICKED!* 🍄

*+${formatNumber(gain)}* spores collected!

*Current Stats:*
Total Spores: *${formatNumber(user.spores)}*
Spores/sec: *${formatNumber(calculateSPS(user))}*
Multiplier: *x${calculateTotalMultiplier(user).toFixed(2)}*
Level: *${user.level}*
${frenzyProgress}
*Need more?*
• Buy upgrades: /upgrades
• Check leaderboard: /leaderboard
• Join event: /event
    `.trim(), { parse_mode: 'Markdown' });
});

// /stats command
bot.onText(/\/stats|📊 My Stats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = generateUserId(msg.from.id);
    const user = await getUserState(userId, msg.from);
    
    const xpPercent = Math.floor((user.playerXP / getNextXP(user)) * 100);
    const progressBar = `[${'█'.repeat(Math.floor(xpPercent / 10))}${'░'.repeat(10 - Math.floor(xpPercent / 10))}]`;
    
    const message = `
📊 *YOUR STATS* 📊

*Resources:*
Spores: *${formatNumber(user.spores)}*
Mushrooms: *${formatNumber(user.mushrooms)}*

*Progress:*
Level: *${user.level}* ${progressBar} ${xpPercent}%
Ascensions: *${user.ascensions}*
Total XP: *${formatNumber(user.playerXP)}*

*Production:*
Spores/sec: *${formatNumber(calculateSPS(user))}*
Total Multiplier: *x${calculateTotalMultiplier(user).toFixed(2)}*
  Base: x1.00
  Event Bonus: +${user.event_boost || 0}
  Premium: +${user.premium_boost || 0}
  Ascensions: +${user.ascensions}

*Upgrades Owned:*
${UPGRADES.map(u => `${u.emoji} ${u.name}: ${user.upgrades[u.id] || 0}`).join('\n')}

*Event Status:* ${user.joinedEvent ? '✅ Joined' : '❌ Not Joined'}
${user.joinedEvent ? `Event Spores: *${formatNumber(user.eventSpores)}*` : ''}
    `.trim();
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// /upgrades command
bot.onText(/\/upgrades|🛒 Buy Upgrades/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = generateUserId(msg.from.id);
    const user = await getUserState(userId, msg.from);
    
    let message = `🛒 *UPGRADES SHOP* 🛒\n\n`;
    message += `Your spores: *${formatNumber(user.spores)}*\n`;
    message += `Spores/sec: *${formatNumber(calculateSPS(user))}*\n\n`;
    
    UPGRADES.forEach((upgrade, index) => {
        const owned = user.upgrades[upgrade.id] || 0;
        const cost = Math.floor(upgrade.base * Math.pow(1.15, owned));
        const canAfford = user.spores >= cost;
        const emoji = canAfford ? '🟢' : '🔴';
        
        message += `${index + 1}. ${upgrade.emoji} *${upgrade.name}*\n`;
        message += `   Owned: ${owned}\n`;
        message += `   ${emoji} Cost: ${formatNumber(cost)} spores\n`;
        message += `   Rate: ${formatNumber(upgrade.rate)}/sec each\n`;
        message += `   Total: ${formatNumber(upgrade.rate * owned)}/sec\n\n`;
    });
    
    message += `*How to buy:*\n`;
    message += `Send /buy1 through /buy6\n`;
    message += `Or /buymax to buy as many as possible`;
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Buy #1', callback_data: 'buy_1' },
                    { text: 'Buy #2', callback_data: 'buy_2' },
                    { text: 'Buy #3', callback_data: 'buy_3' }
                ],
                [
                    { text: 'Buy #4', callback_data: 'buy_4' },
                    { text: 'Buy #5', callback_data: 'buy_5' },
                    { text: 'Buy #6', callback_data: 'buy_6' }
                ],
                [
                    { text: 'Buy MAX All', callback_data: 'buy_max_all' }
                ]
            ]
        }
    };
    
    bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        ...keyboard 
    });
});

// /buy commands
for (let i = 1; i <= 6; i++) {
    bot.onText(new RegExp(`\\/buy${i}`), async (msg) => {
        await handleBuyUpgrade(msg, i - 1, false);
    });
}

bot.onText(/\/buymax/, async (msg) => {
    await handleBuyUpgrade(msg, 0, true); // 0 index for all
});

// Callback queries for inline buttons
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    
    if (data.startsWith('buy_')) {
        const parts = data.split('_');
        const upgradeIndex = parseInt(parts[1]) - 1;
        const isMax = parts[1] === 'max_all';
        
        if (isMax) {
            await handleBuyUpgrade(msg, 0, true);
        } else if (upgradeIndex >= 0 && upgradeIndex < 6) {
            await handleBuyUpgrade(msg, upgradeIndex, false);
        }
        
        bot.answerCallbackQuery(callbackQuery.id);
    }
});

async function handleBuyUpgrade(msg, upgradeIndex, isMax) {
    const chatId = msg.chat.id;
    const userId = generateUserId(msg.from ? msg.from.id : msg.chat.id);
    const user = await getUserState(userId, msg.from || { id: msg.chat.id });
    
    if (isMax) {
        // Buy max for all upgrades
        let totalBought = 0;
        let totalSpent = 0;
        
        for (let i = 0; i < UPGRADES.length; i++) {
            const upgrade = UPGRADES[i];
            const owned = user.upgrades[upgrade.id] || 0;
            let cost = upgrade.base * Math.pow(1.15, owned);
            let bought = 0;
            
            while (user.spores >= cost && bought < 1000) {
                user.spores -= cost;
                user.upgrades[upgrade.id] = (user.upgrades[upgrade.id] || 0) + 1;
                totalSpent += cost;
                totalBought++;
                bought++;
                
                owned++;
                cost = upgrade.base * Math.pow(1.15, owned);
            }
        }
        
        if (totalBought > 0) {
            addXP(user, totalBought * 5);
            await saveUserState(user);
            
            bot.sendMessage(chatId, `
✅ *MAX UPGRADES PURCHASED!*

Bought *${totalBought}* upgrades
Spent *${formatNumber(totalSpent)}* spores
New SPS: *${formatNumber(calculateSPS(user))}*/sec
Remaining spores: *${formatNumber(user.spores)}*
            `.trim(), { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, '❌ Not enough spores to buy any upgrades!');
        }
        
    } else {
        // Buy single upgrade
        const upgrade = UPGRADES[upgradeIndex];
        if (!upgrade) {
            bot.sendMessage(chatId, '❌ Invalid upgrade selection.');
            return;
        }
        
        const owned = user.upgrades[upgrade.id] || 0;
        const cost = Math.floor(upgrade.base * Math.pow(1.15, owned));
        
        if (user.spores >= cost) {
            user.spores -= cost;
            user.upgrades[upgrade.id] = (user.upgrades[upgrade.id] || 0) + 1;
            addXP(user, 5);
            await saveUserState(user);
            
            bot.sendMessage(chatId, `
✅ *UPGRADE PURCHASED!*

${upgrade.emoji} *${upgrade.name}*
Cost: *${formatNumber(cost)}* spores
Now owned: *${user.upgrades[upgrade.id]}*
Production: *${formatNumber(upgrade.rate)}*/sec each
Total: *${formatNumber(upgrade.rate * user.upgrades[upgrade.id])}*/sec
New SPS: *${formatNumber(calculateSPS(user))}*/sec
Remaining spores: *${formatNumber(user.spores)}*
            `.trim(), { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `
❌ *CANNOT AFFORD!*

${upgrade.emoji} ${upgrade.name}
Need: *${formatNumber(cost)}* spores
Have: *${formatNumber(user.spores)}* spores
You need *${formatNumber(cost - user.spores)}* more!
            `.trim(), { parse_mode: 'Markdown' });
        }
    }
}

// /leaderboard command
bot.onText(/\/leaderboard|🏆 Leaderboard/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        const { data, error } = await supabase
            .from('leaderboard')
            .select('username, spores, ascensions, level')
            .order('spores', { ascending: false })
            .limit(10);
        
        if (error) throw error;
        
        let message = `🏆 *GLOBAL LEADERBOARD* 🏆\n\n`;
        
        if (data && data.length > 0) {
            data.forEach((player, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                message += `${medal} *${player.username}*\n`;
                message += `   Spores: ${formatNumber(player.spores)}\n`;
                message += `   Level: ${player.level} | Ascensions: ${player.ascensions}\n\n`;
            });
        } else {
            message += 'No players yet! Be the first to join!';
        }
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('Leaderboard error:', error);
        bot.sendMessage(chatId, '❌ Error loading leaderboard. Please try again.');
    }
});

// /event command
bot.onText(/\/event|🎯 Weekly Event/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = generateUserId(msg.from.id);
    const user = await getUserState(userId, msg.from);
    
    const weekId = getCurrentWeekId();
    const nextWeekStart = (weekId + 1) * 604800000 - 345600000;
    const diff = nextWeekStart - Date.now();
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    
    try {
        const { data, error } = await supabase
            .from('weekly_leaderboard')
            .select('username, spores')
            .eq('week_id', weekId)
            .order('spores', { ascending: false })
            .limit(5);
        
        if (error) throw error;
        
        let message = `🎯 *WEEKLY EVENT* 🎯\n\n`;
        message += `*Time remaining:* ${days}d ${hours}h ${minutes}m\n\n`;
        message += `*Prizes:*\n`;
        message += `🥇 1st: x5 Permanent Multiplier\n`;
        message += `🥈 2nd: x4 Permanent Multiplier\n`;
        message += `🥉 3rd: x3 Permanent Multiplier\n`;
        message += `4th: x2 Permanent Multiplier\n`;
        message += `5th: x1 Permanent Multiplier\n\n`;
        
        message += `*Current Top 5:*\n`;
        if (data && data.length > 0) {
            data.forEach((player, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                message += `${medal} ${player.username}: ${formatNumber(player.spores)} spores\n`;
            });
        } else {
            message += 'No participants yet!\n';
        }
        
        message += `\n*Your Status:*\n`;
        if (user.joinedEvent && user.savedEventWeekId === weekId) {
            message += `✅ Joined this week\n`;
            message += `Your score: *${formatNumber(user.eventSpores)}* spores\n`;
            message += `Rank: Calculating...`;
        } else {
            message += `❌ Not joined\n`;
            message += `Join with: /joinevent`;
        }
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Join Event', callback_data: 'join_event' },
                        { text: 'Refresh', callback_data: 'refresh_event' }
                    ]
                ]
            }
        };
        
        bot.sendMessage(chatId, message, { 
            parse_mode: 'Markdown',
            ...(user.joinedEvent ? {} : keyboard)
        });
        
    } catch (error) {
        console.error('Event error:', error);
        bot.sendMessage(chatId, '❌ Error loading event data.');
    }
});

// Join event callback
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    
    if (data === 'join_event') {
        const chatId = msg.chat.id;
        const userId = generateUserId(callbackQuery.from.id);
        const user = await getUserState(userId, callbackQuery.from);
        
        const weekId = getCurrentWeekId();
        
        if (user.savedEventWeekId !== weekId) {
            user.savedEventWeekId = weekId;
            user.eventSpores = 0;
        }
        
        user.joinedEvent = true;
        await saveUserState(user);
        
        bot.sendMessage(chatId, `
✅ *JOINED WEEKLY EVENT!*

All spores earned now count toward the event!
Check your progress with /event
Good luck! 🍀
        `.trim(), { parse_mode: 'Markdown' });
        
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Joined event successfully!' });
    }
});

// /joinevent command
bot.onText(/\/joinevent/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = generateUserId(msg.from.id);
    const user = await getUserState(userId, msg.from);
    
    const weekId = getCurrentWeekId();
    
    if (user.savedEventWeekId !== weekId) {
        user.savedEventWeekId = weekId;
        user.eventSpores = 0;
    }
    
    user.joinedEvent = true;
    await saveUserState(user);
    
    bot.sendMessage(chatId, `
✅ *JOINED WEEKLY EVENT!*

All spores earned now count toward the event!
Check your progress with /event
Good luck! 🍀
    `.trim(), { parse_mode: 'Markdown' });
});

// /chat command
bot.onText(/\/chat (.+)|💬 Global Chat/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = generateUserId(msg.from.id);
    const user = await getUserState(userId, msg.from);
    
    if (match && match[1]) {
        // Send message
        const message = match[1];
        
        try {
            await supabase.from('chat').insert({
                username: user.username,
                message: message,
                platform: 'telegram'
            });
            
            bot.sendMessage(chatId, `💬 Message sent to global chat!`);
            
        } catch (error) {
            console.error('Chat error:', error);
            bot.sendMessage(chatId, '❌ Error sending message.');
        }
    } else {
        // Show recent chat
        try {
            const { data, error } = await supabase
                .from('chat')
                .select('username, message, created_at')
                .order('created_at', { ascending: false })
                .limit(10);
            
            if (error) throw error;
            
            let message = `💬 *GLOBAL CHAT* 💬\n\n`;
            
            if (data && data.length > 0) {
                data.reverse().forEach(msg => {
                    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    message += `*${msg.username}* (${time}):\n`;
                    message += `${msg.message}\n\n`;
                });
            } else {
                message += 'No messages yet. Be the first to chat!';
            }
            
            message += `\n*Send a message:*\n/chat [your message]`;
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            
        } catch (error) {
            console.error('Chat load error:', error);
            bot.sendMessage(chatId, '❌ Error loading chat.');
        }
    }
});

// /save command
bot.onText(/\/save|💾 Save Game/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = generateUserId(msg.from.id);
    const user = await getUserState(userId, msg.from);
    
    await saveUserState(user);
    
    bot.sendMessage(chatId, `💾 *GAME SAVED!*\n\nYour progress has been saved to the cloud.`, { parse_mode: 'Markdown' });
});

// /help command
bot.onText(/\/help|❓ Help/, (msg) => {
    const chatId = msg.chat.id;
    
    const helpMessage = `
❓ *SHROOMS BLOOM BOT - HELP* ❓

*Basic Commands:*
🍄 /click - Tap mushroom for spores
📊 /stats - View your progress
🛒 /upgrades - Buy automation upgrades
💾 /save - Manual save game

*Social Features:*
🏆 /leaderboard - Global rankings
🎯 /event - Weekly event info
💬 /chat - View/Send global messages

*Quick Actions:*
Use the keyboard buttons or send:
/buy1 to /buy6 - Buy specific upgrade
/buymax - Buy as many upgrades as possible
/joinevent - Join weekly competition

*How to Play:*
1. Tap mushrooms with /click to earn spores
2. Buy upgrades to automate spore production
3. Compete in weekly events for multipliers
4. Chat with other players globally
5. Check /leaderboard to see your rank

*Pro Tips:*
• Save regularly with /save
• Buy lower upgrades first for best value
• Join events early for maximum score
• Check /event for time remaining

*Support:*
For issues, contact the game admin.
    `.trim();
    
    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// Handle unknown commands
bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/')) {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, 
            `❓ Unknown command. Type /help for available commands.`,
            { parse_mode: 'Markdown' }
        );
    }
});

// =============================================
// AUTO-SAVE & CLEANUP
// =============================================

// Auto-save every 5 minutes
setInterval(() => {
    console.log('🔄 Auto-saving user states...');
    userCache.forEach(async (userState, userId) => {
        await saveUserState(userState);
    });
}, 5 * 60 * 1000);

// Clear inactive users from cache (1 hour)
setInterval(() => {
    const now = Date.now();
    let cleared = 0;
    
    userCache.forEach((userState, userId) => {
        if (now - userState.lastActive > 60 * 60 * 1000) { // 1 hour
            userCache.delete(userId);
            cleared++;
        }
    });
    
    if (cleared > 0) {
        console.log(`🧹 Cleared ${cleared} inactive users from cache`);
    }
}, 10 * 60 * 1000);

// =============================================
// ERROR HANDLING
// =============================================

bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

bot.on('webhook_error', (error) => {
    console.error('Webhook error:', error);
});

// =============================================
// STARTUP MESSAGE
// =============================================

console.log('✅ Bot is running!');
console.log('📱 Bot username: @ShroomsBloomBot');
console.log('📊 Database connected:', SB_URL);
console.log('⏰ Auto-save interval: 5 minutes');
console.log('💾 User cache enabled');

// Send startup notification to admin (optional)
if (process.env.ADMIN_CHAT_ID) {
    bot.sendMessage(process.env.ADMIN_CHAT_ID, 
        '🚀 Shrooms Bloom Bot is now online!\n' +
        `👥 Users in cache: ${userCache.size}\n` +
        `📅 Week ID: ${getCurrentWeekId()}\n` +
        `⏰ Server time: ${new Date().toLocaleString()}`
    );
}
