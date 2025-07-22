
const fs = require('fs');
const { Client } = require('discord.js-selfbot-v13');
const { joinVoiceChannel, VoiceConnectionStatus, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const { Worker, isMainThread, workerData } = require('worker_threads');
const express = require('express');

// Anti-rate limiting system
class RateLimitManager {
  constructor() {
    this.requestQueue = [];
    this.isProcessing = false;
    this.lastRequestTime = 0;
    this.requestDelay = 1000; // 1 second between requests
    this.maxRetries = 3;
  }

  async queueRequest(requestFunction, retries = 0) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        function: requestFunction,
        resolve,
        reject,
        retries
      });
      
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  async processQueue() {
    if (this.requestQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const request = this.requestQueue.shift();
    
    try {
      // Ensure minimum delay between requests
      const timeSinceLastRequest = Date.now() - this.lastRequestTime;
      if (timeSinceLastRequest < this.requestDelay) {
        await new Promise(resolve => setTimeout(resolve, this.requestDelay - timeSinceLastRequest));
      }
      
      const result = await request.function();
      this.lastRequestTime = Date.now();
      request.resolve(result);
      
    } catch (error) {
      if (error.code === 429 && request.retries < this.maxRetries) {
        // Rate limited, retry with exponential backoff
        const retryDelay = Math.pow(2, request.retries) * 1000;
        console.log(`Rate limited, retrying in ${retryDelay}ms...`);
        
        setTimeout(() => {
          this.requestQueue.unshift({
            ...request,
            retries: request.retries + 1
          });
        }, retryDelay);
      } else {
        request.reject(error);
      }
    }
    
    // Process next request after a small delay
    setTimeout(() => this.processQueue(), 100);
  }
}

const rateLimitManager = new RateLimitManager();

let config;

// Load configuration
try {
  const configFile = fs.readFileSync('config.json', 'utf8');
  config = JSON.parse(configFile);
  config.port = config.port || process.env.PORT || 3000;
  
  console.log('🚀 Discord Multi-Bot Manager loaded successfully!');
} catch (error) {
  console.error('❌ Error loading configuration:', error.message);
  process.exit(1);
}

if (isMainThread) {
  const app = express();
  const tokens = config.tokens.filter(tokenConfig => {
    if (!tokenConfig.token) return false;
    if (tokenConfig.token.startsWith("YOUR_TOKEN")) return false;
    if (tokenConfig.token.includes("FAKE")) return false;
    if (tokenConfig.token.includes("TEST")) return false;
    if (tokenConfig.token.includes("PLACEHOLDER")) return false;
    if (tokenConfig.token.length < 50) return false; // Discord tokens are typically 59+ chars
    
    // Basic Discord token format validation (starts with user ID base64)
    try {
      const parts = tokenConfig.token.split('.');
      if (parts.length !== 3) return false;
      // First part should be base64 encoded user ID
      const userId = Buffer.from(parts[0], 'base64').toString();
      if (!/^\d+$/.test(userId)) return false;
      return true;
    } catch (error) {
      return false;
    }
  });
  
  if (tokens.length > 0) {
    // Start web server
    app.listen(config.port, '0.0.0.0', () => {
      console.log('╔══════════════════════════════════════╗');
      console.log('║     Discord Multi-Bot Manager        ║');
      console.log('╠══════════════════════════════════════╣');
      console.log(`║ Port: ${config.port.toString().padEnd(30)} ║`);
      console.log(`║ Tokens: ${tokens.length.toString().padEnd(28)} ║`);
      console.log(`║ Guild: ${config.guildId.padEnd(29)} ║`);
      console.log('╚══════════════════════════════════════╝');
      
      startWorkers(tokens);
    });

    // Status endpoint
    app.get('/status', (req, res) => {
      res.json({
        status: 'online',
        clients: tokens.length,
        timestamp: new Date()
      });
    });

    // Start worker processes with staggered startup
    function startWorkers(tokens) {
      console.log(`\n🔄 Starting ${tokens.length} bot workers with anti-rate limiting...\n`);
      
      const workers = [];
      
      // Start workers with delays to prevent rate limiting
      tokens.forEach((tokenConfig, index) => {
        setTimeout(() => {
          const workerData = {
            ...config,
            tokenConfig,
            index: index + 1,
            startDelay: index * 2000 // 2 second delay between each worker
          };
          
          const worker = new Worker(__filename, { workerData });
          workers.push(worker);
        
        worker.on('message', ({ type, content, token }) => {
            const timestamp = new Date().toLocaleTimeString();
            const tokenShort = token.slice(-4);
            console.log(`[${timestamp}] [Bot-${tokenShort}] ${type}: ${content}`);
          });
          
          worker.on('error', (error) => {
            const tokenShort = tokenConfig.token.slice(-4);
            console.error(`[Bot-${tokenShort}] Worker error:`, error.message);
          });
          
          worker.on('exit', (code) => {
            const tokenShort = tokenConfig.token.slice(-4);
            console.log(`[Bot-${tokenShort}] Worker exited with code ${code}`);
            
            if (code !== 0 && !isShuttingDown) {
              // Exponential backoff for restart delays
              const restartDelay = Math.min(30000, 5000 * Math.pow(2, Math.floor(Math.random() * 3)));
              console.log(`[Bot-${tokenShort}] Restarting worker in ${restartDelay/1000} seconds...`);
              setTimeout(() => startWorkers([tokenConfig]), restartDelay);
            }
          });
          
        }, index * 2000); // 2 second stagger between workers
      });

      let isShuttingDown = false;
      
      // Handle shutdown
      process.on('SIGINT', () => {
        isShuttingDown = true;
        console.log('\n🛑 Shutting down all workers...');
        
        workers.forEach(worker => {
          try {
            worker.postMessage({ type: 'SHUTDOWN' });
          } catch (error) {
            console.error('Error sending shutdown message:', error.message);
          }
        });
        
        setTimeout(() => {
          console.log('💀 Force closing application...');
          process.exit(0);
        }, 10000);
      });
    }
  } else {
    console.log('❌ No valid tokens found in configuration!');
    console.log('Please edit config.json and replace placeholder tokens with actual Discord user tokens.');
    console.log('Valid tokens must be 50+ characters and follow Discord token format.');
    console.log(`Found ${config.tokens.length} total tokens, ${tokens.length} valid.`);
    process.exit(1);
  }

} else {
  // Worker thread code with anti-rate limiting
  const { tokenConfig, guildId, voiceChannelId, reconnect, index, startDelay } = workerData;
  const client = new Client({
    checkUpdate: false,
    readyStatus: false,
    autoCookie: false,
    patchVoice: true,
    dmChannelCreateEvent: false,
    autoRedeemNitro: false,
    captchaService: '',
    interactionTimeout: 15000,
    waitGuildTimeout: 15000,
    shardCount: 1,
    makeCache: require('discord.js-selfbot-v13').Options.cacheWithLimits({
      MessageManager: 0,
      RoleManager: 0,
      UserManager: 0,
      GuildMemberManager: 0,
      ThreadManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0
    }),
    intents: [] // Self-bots don't need intents
  });
  
  let voiceConnection = null;
  let reconnectAttempts = 0;
  let isShuttingDown = false;
  let loginRetries = 0;
  const maxLoginRetries = 5;

  function log(type, message) {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `${type}: ${message}`;
    
    // Send to main thread with rate limiting
    if (!isMainThread && process.send) {
      try {
        process.send({
          type,
          content: message,
          token: tokenConfig.token.slice(-4)
        });
      } catch (error) {
        // Ignore send errors to prevent crashes
      }
    }
    
    if (type === 'ERROR') {
      console.error(`[${timestamp}] [${tokenConfig.token.slice(-4)}] ${logMessage}`);
    } else {
      console.log(`[${timestamp}] [${tokenConfig.token.slice(-4)}] ${logMessage}`);
    }
  }

  // Anti-detection measures
  function randomDelay(min = 1000, max = 3000) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Voice connection handler with rate limiting
  async function handleVoiceConnection() {
    if (isShuttingDown) return;
    
    try {
      // Add random delay to avoid pattern detection
      await sleep(randomDelay(500, 2000));
      
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        log('ERROR', 'Guild not found in cache, fetching...');
        try {
          const fetchedGuild = await client.guilds.fetch(guildId);
          if (!fetchedGuild) {
            log('ERROR', 'Guild not found after fetch');
            await attemptReconnect();
            return;
          }
        } catch (fetchError) {
          log('ERROR', `Failed to fetch guild: ${fetchError.message}`);
          await attemptReconnect();
          return;
        }
      }
      
      await sleep(randomDelay(200, 800));
      
      const targetGuild = client.guilds.cache.get(guildId);
      const channel = targetGuild.channels.cache.get(voiceChannelId);
      if (!channel) {
        log('ERROR', 'Voice channel not found in cache, fetching...');
        try {
          const fetchedChannel = await targetGuild.channels.fetch(voiceChannelId);
          if (!fetchedChannel || fetchedChannel.type !== 2) { // 2 = GUILD_VOICE
            log('ERROR', 'Voice channel not found or not a voice channel');
            await attemptReconnect();
            return;
          }
        } catch (fetchError) {
          log('ERROR', `Failed to fetch channel: ${fetchError.message}`);
          await attemptReconnect();
          return;
        }
      }
      
      await sleep(randomDelay(300, 1000));
      
      // Use the guild's voice adapter creator for self-bots
      let adapterCreator;
      try {
        adapterCreator = targetGuild.voiceAdapterCreator;
        if (!adapterCreator) {
          // Fallback: create a custom adapter for self-bots
          adapterCreator = (methods) => {
            return {
              sendPayload: (payload) => {
                try {
                  if (client.ws?.readyState === 1) { // WebSocket.OPEN
                    client.ws.send(JSON.stringify(payload));
                    return true;
                  }
                  return false;
                } catch (error) {
                  log('ERROR', `Voice payload send failed: ${error.message}`);
                  return false;
                }
              },
              destroy: () => {
                log('INFO', 'Voice adapter destroyed');
              }
            };
          };
        }
      } catch (error) {
        log('ERROR', `Failed to get voice adapter: ${error.message}`);
        await attemptReconnect();
        return;
      }
      
      voiceConnection = joinVoiceChannel({
        channelId: voiceChannelId,
        guildId: guildId,
        adapterCreator: adapterCreator,
        selfMute: tokenConfig.selfMute,
        selfDeaf: tokenConfig.selfDeaf,
        debug: false
      });
      
      const targetChannel = targetGuild.channels.cache.get(voiceChannelId);
      log('INFO', `Connected to voice channel: ${targetChannel?.name || 'Unknown'}`);
      
      // Set up connection event handlers
      voiceConnection.on(VoiceConnectionStatus.Ready, () => {
        log('INFO', 'Voice connection ready');
      });
      
      voiceConnection.on(VoiceConnectionStatus.Connecting, () => {
        log('INFO', 'Voice connection connecting...');
      });
      
      voiceConnection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
        if (!isShuttingDown) {
          log('WARN', `Voice connection lost (${oldState.status} -> ${newState.status}), attempting reconnect...`);
          await sleep(randomDelay(2000, 5000)); // Random delay before reconnect
          await attemptReconnect();
        }
      });
      
      voiceConnection.on(VoiceConnectionStatus.Destroyed, () => {
        if (!isShuttingDown) {
          log('WARN', 'Voice connection destroyed');
        }
      });
      
      voiceConnection.on('error', (error) => {
        if (error.message.includes('rate limit')) {
          log('WARN', 'Voice rate limit detected, backing off...');
        } else {
          log('ERROR', `Voice connection error: ${error.message}`);
        }
      });
      
      voiceConnection.on('stateChange', (oldState, newState) => {
        log('INFO', `Voice state: ${oldState.status} -> ${newState.status}`);
      });
      
      reconnectAttempts = 0;
      
    } catch (error) {
      if (error.message.includes('rate limit') || error.code === 429) {
        log('WARN', 'Rate limit detected, backing off...');
        await sleep(randomDelay(5000, 10000));
      } else {
        log('ERROR', `Voice connection failed: ${error.message}`);
      }
      await attemptReconnect();
    }
  }

  // Enhanced reconnection logic with exponential backoff
  async function attemptReconnect() {
    if (isShuttingDown) return;
    
    reconnectAttempts++;
    
    if (voiceConnection) {
      try {
        voiceConnection.destroy();
      } catch (error) {
        log('ERROR', `Error destroying connection: ${error.message}`);
      }
      voiceConnection = null;
    }
    
    if (reconnectAttempts >= reconnect.maxAttempts) {
      log('ERROR', 'Max reconnection attempts reached, giving up');
      return;
    }
    
    // Exponential backoff with jitter
    const baseDelay = reconnect.delay;
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, reconnectAttempts - 1), 300000); // Max 5 minutes
    const jitter = Math.random() * 1000; // Add up to 1 second jitter
    const totalDelay = exponentialDelay + jitter;
    
    log('INFO', `Reconnecting attempt ${reconnectAttempts}/${reconnect.maxAttempts} in ${Math.round(totalDelay/1000)}s`);
    
    await sleep(totalDelay);
    await handleVoiceConnection();
  }

  // Message handler for shutdown
  process.on('message', (message) => {
    if (message.type === 'SHUTDOWN') {
      shutdown();
    }
  });

  // Shutdown handler
  async function shutdown() {
    isShuttingDown = true;
    log('INFO', 'Shutting down bot instance...');
    
    try {
      if (voiceConnection) {
        voiceConnection.destroy();
        log('INFO', 'Voice connection destroyed');
      }
      
      await client.destroy();
      log('INFO', 'Client destroyed successfully');
      
    } catch (error) {
      log('ERROR', `Shutdown error: ${error.message}`);
    } finally {
      process.exit(0);
    }
  }

  // Bot ready event
  client.on('ready', async () => {
    log('INFO', `Logged in as ${client.user.tag}`);
    
    try {
      // Set presence
      await client.user.setPresence({
        status: tokenConfig.status,
        activities: [{
          name: 'Voice Channel Manager',
          type: 'WATCHING'
        }]
      });
      
      log('INFO', `Status set to: ${tokenConfig.status}`);
      log('INFO', `Voice settings - Mute: ${tokenConfig.selfMute}, Deaf: ${tokenConfig.selfDeaf}`);
      
      // Wait a bit for client to be fully ready
      await sleep(3000);
      
      // Ensure we have the guild and channel in cache
      try {
        log('INFO', `Attempting to fetch guild: ${guildId}`);
        const guild = await client.guilds.fetch(guildId);
        log('INFO', `Guild fetched: ${guild.name}`);
        
        log('INFO', `Attempting to fetch voice channel: ${voiceChannelId}`);
        const channel = await guild.channels.fetch(voiceChannelId);
        log('INFO', `Channel fetched: ${channel.name} (Type: ${channel.type})`);
        
        if (channel.type !== 2 && channel.type !== 'GUILD_VOICE') { // Support both numeric and string types
          log('ERROR', `Channel is not a voice channel! Type: ${channel.type}`);
          return;
        }
        
        log('INFO', `Guild and channel cached successfully`);
      } catch (cacheError) {
        log('ERROR', `Failed to cache guild/channel: ${cacheError.message}`);
        return;
      }
      
      // Connect to voice channel with delay
      await sleep(2000);
      log('INFO', `Starting voice connection attempt...`);
      await handleVoiceConnection();
      
    } catch (error) {
      log('ERROR', `Setup error: ${error.message}`);
    }
  });

  // Error handlers
  client.on('error', error => {
    log('ERROR', `Client error: ${error.message}`);
  });

  client.on('warn', warning => {
    log('WARN', `Client warning: ${warning}`);
  });

  // Enhanced login with retry mechanism and staggered startup
  async function attemptLogin() {
    try {
      // Apply startup delay to stagger logins
      if (startDelay) {
        log('INFO', `Waiting ${startDelay/1000}s before login to prevent rate limiting...`);
        await sleep(startDelay);
      }
      
      // Add random delay before login attempt
      await sleep(randomDelay(1000, 3000));
      
      await client.login(tokenConfig.token);
      log('INFO', 'Login successful');
      loginRetries = 0;
      
    } catch (error) {
      loginRetries++;
      
      if (error.message.includes('rate limit') || error.code === 429) {
        const retryDelay = Math.min(60000 * Math.pow(2, loginRetries), 600000); // Max 10 minutes
        log('WARN', `Login rate limited. Retrying in ${retryDelay/1000}s... (${loginRetries}/${maxLoginRetries})`);
        
        if (loginRetries < maxLoginRetries) {
          setTimeout(attemptLogin, retryDelay);
        } else {
          log('ERROR', 'Max login retries reached');
          process.exit(1);
        }
      } else if (error.message.includes('invalid') || error.message.includes('token')) {
        log('ERROR', `Login failed: ${error.message}`);
        process.exit(1);
      } else {
        const retryDelay = Math.min(5000 * loginRetries, 30000); // Max 30 seconds
        log('WARN', `Login failed: ${error.message}. Retrying in ${retryDelay/1000}s... (${loginRetries}/${maxLoginRetries})`);
        
        if (loginRetries < maxLoginRetries) {
          setTimeout(attemptLogin, retryDelay);
        } else {
          log('ERROR', 'Max login retries reached');
          process.exit(1);
        }
      }
    }
  }

  // Start login process
  attemptLogin();
}
