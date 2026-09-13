const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;

// حماية عامة لمنع انهيار البوتات بسبب أخطاء التفاعلات المنتهية
process.on('unhandledRejection', error => {
    if (error.code === 10062 || error.code === 40060) return;
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (err) => {
    if (err.code === 10062 || err.code === 40060) return;
    console.error('Uncaught Exception:', err);
});

const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    AttachmentBuilder,
    ActivityType,
    ChannelType
} = require('discord.js');

const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');
const play = require('play-dl');
const path = require('path');
const fs = require('fs');
const dns = require('dns');

// 🔒 قراءة التوكنات بشكل آمن ومشفر من متغيرات البيئة في Railway
const tokensEnv = process.env.BOT_TOKENS || '';
const TOKENS = tokensEnv.split(',').map(t => t.trim()).filter(Boolean);

if (TOKENS.length === 0) {
    console.error('❌ Error: No bot tokens found! Please set BOT_TOKENS in your environment variables.');
    process.exit(1);
}

const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);

// نظام تخزين المفضلة محلياً في ملف JSON
const favoritesFile = path.join(__dirname, 'favorites.json');
let userFavorites = {};
if (fs.existsSync(favoritesFile)) {
    try {
        userFavorites = JSON.parse(fs.readFileSync(favoritesFile, 'utf8'));
    } catch (e) {
        userFavorites = {};
    }
}

function saveFavorites() {
    try {
        fs.writeFileSync(favoritesFile, JSON.stringify(userFavorites, null, 2));
    } catch (e) {}
}

const slashCommands = [
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('🎵 Play a song or audio track')
        .addStringOption(opt => opt.setName('query').setDescription('YouTube link or song name').setRequired(true)),
    new SlashCommandBuilder().setName('skip').setDescription('⏭️ Skip the current song'),
    new SlashCommandBuilder().setName('previous').setDescription('⏮️ Play the previous song'),
    new SlashCommandBuilder().setName('queue').setDescription('📋 Show the current music queue'),
    new SlashCommandBuilder().setName('download').setDescription('📥 Download the currently playing song MP3'),
    new SlashCommandBuilder().setName('favorites').setDescription('⭐ Show your personal favorite songs list'),
    new SlashCommandBuilder()
        .setName('filter')
        .setDescription('🎚️ Apply audio effects (Bass Boost, Nightcore, Normal)')
        .addStringOption(opt => 
            opt.setName('type')
               .setDescription('Choose audio effect')
               .setRequired(true)
               .addChoices(
                   { name: 'Bass Boost (رفع البيس القوي)', value: 'bass' },
                   { name: 'Nightcore (السرعة والنغمة الحماسية العالية)', value: 'nightcore' },
                   { name: 'Normal (إلغاء الفلتر)', value: 'normal' }
               )
        ),
    new SlashCommandBuilder().setName('pause').setDescription('⏸️ Pause playback'),
    new SlashCommandBuilder().setName('resume').setDescription('▶️ Resume playback'),
    new SlashCommandBuilder().setName('loop').setDescription('🔁 Toggle repeat mode'),
    new SlashCommandBuilder()
        .setName('volume')
        .setDescription('🔊 Adjust the playback volume')
        .addNumberOption(opt => opt.setName('level').setDescription('Volume level from 0.1 to 2').setRequired(true)),
    new SlashCommandBuilder().setName('stop').setDescription('⏹️ Stop music and disconnect the bot')
].map(cmd => cmd.toJSON());

function checkNetworkStatus(callback) {
    const startTime = Date.now();
    dns.resolve('google.com', (err) => {
        const ping = Date.now() - startTime;
        let status = err ? '❌ Offline' : `🟢 Excellent (${ping}ms)`;
        if (!err && ping >= 150 && ping < 350) status = `🟡 Good (${ping}ms)`;
        if (!err && ping >= 350) status = `🟠 Slow (${ping}ms)`;
        callback(status);
    });
}

function cleanupFile(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        try { 
            fs.unlinkSync(filePath); 
        } catch (e) {}
    }
}

function createMusicPanel(songTitle, loopStatus, volumeStatus, currentFilter) {
    const volPercent = Math.round(volumeStatus * 100);
    const filterName = currentFilter === 'bass' ? 'Bass Boost (Strong) 🎚️' : currentFilter === 'nightcore' ? 'Nightcore (Fast) ⚡' : 'Normal 🎵';

    const embed = new EmbedBuilder()
        .setColor('#2b2d31')
        .setTitle('🎛️ Camora Music Studio')
        .setDescription('Professional music control panel. Use the buttons below or slash commands to manage playback.')
        .addFields(
            { name: '🎵 Current Track', value: `\`${songTitle}\``, inline: false },
            { name: '🔁 Loop Mode', value: loopStatus ? '`Enabled (On)`' : '`Disabled (Off)`', inline: true },
            { name: '🔊 Volume', value: `\`${volPercent}%\``, inline: true },
            { name: '🎚️ Audio Filter', value: `\`${filterName}\``, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Camora Music System • Studio Edition' });

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_previous').setLabel('Prev').setStyle(ButtonStyle.Secondary).setEmoji('⏮️'),
        new ButtonBuilder().setCustomId('music_pause').setLabel('Pause').setStyle(ButtonStyle.Primary).setEmoji('⏸️'),
        new ButtonBuilder().setCustomId('music_resume').setLabel('Resume').setStyle(ButtonStyle.Success).setEmoji('▶️'),
        new ButtonBuilder().setCustomId('music_skip').setLabel('Skip').setStyle(ButtonStyle.Secondary).setEmoji('⏭️')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_loop').setLabel('Loop').setStyle(ButtonStyle.Primary).setEmoji('🔁'),
        new ButtonBuilder().setCustomId('music_favorite').setLabel('Favorite').setStyle(ButtonStyle.Secondary).setEmoji('⭐'),
        new ButtonBuilder().setCustomId('music_voldown').setLabel('Vol -').setStyle(ButtonStyle.Secondary).setEmoji('🔉'),
        new ButtonBuilder().setCustomId('music_volup').setLabel('Vol +').setStyle(ButtonStyle.Secondary).setEmoji('🔊'),
        new ButtonBuilder().setCustomId('music_download').setLabel('Download').setStyle(ButtonStyle.Success).setEmoji('📥')
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_stop').setLabel('Stop & Leave Voice').setStyle(ButtonStyle.Danger).setEmoji('⏹️')
    );

    return { embeds: [embed], components: [row1, row2, row3] };
}

async function playSong(guild, song, interactionData, queueMap) {
    const serverQueue = queueMap.get(guild.id);
    if (!song) {
        if (serverQueue?.lastPanel) {
            try { await serverQueue.lastPanel.delete(); } catch (e) {}
        }
        cleanupFile(serverQueue?.currentFile);
        if (serverQueue?.connection && serverQueue.connection.state.status !== 'destroyed') {
            serverQueue.connection.destroy();
        }
        queueMap.delete(guild.id);
        return;
    }

    cleanupFile(serverQueue.currentFile);

    try {
        const filePath = path.join(downloadsDir, `song_${Date.now()}_${Math.random()}.mp3`);
        serverQueue.currentFile = filePath;
        
        await youtubedl(song.url, {
            extractAudio: true,
            audioFormat: 'mp3',
            o: filePath,
            noCheckCertificates: true,
            ffmpegLocation: ffmpegPath
        });

        if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
            throw new Error('Audio file is empty');
        }

        let resourceOptions = { inlineVolume: true };
        if (serverQueue.filter === 'bass') {
            resourceOptions.inputType = 'arbitrary';
            resourceOptions.filters = { audioFilters: ['bass=g=20:f=125'] };
        } else if (serverQueue.filter === 'nightcore') {
            resourceOptions.inputType = 'arbitrary';
            resourceOptions.filters = { audioFilters: ['asetrate=44100*1.35,aresample=44100,atempo=1'] };
        }

        const resource = createAudioResource(filePath, resourceOptions);
        resource.volume.setVolume(serverQueue.volume);
        serverQueue.player.play(resource);

        const panelData = createMusicPanel(song.title, serverQueue.loop, serverQueue.volume, serverQueue.filter);
        if (serverQueue.textChannel) {
            if (serverQueue.lastPanel) {
                try {
                    await serverQueue.lastPanel.edit(panelData);
                } catch (e) {
                    serverQueue.lastPanel = await serverQueue.textChannel.send(panelData);
                }
            } else {
                serverQueue.lastPanel = await serverQueue.textChannel.send(panelData);
            }
        }

        serverQueue.player.once(AudioPlayerStatus.Idle, () => {
            cleanupFile(filePath);
            serverQueue.currentFile = null;
            
            if (serverQueue.loop) {
                playSong(guild, serverQueue.songs[0], interactionData, queueMap);
            } else {
                const finishedSong = serverQueue.songs.shift();
                if (finishedSong) {
                    serverQueue.history.push(finishedSong);
                    if (serverQueue.history.length > 10) serverQueue.history.shift();
                }
                playSong(guild, serverQueue.songs[0], interactionData, queueMap);
            }
        });

    } catch (err) {
        cleanupFile(serverQueue.currentFile);
        serverQueue.currentFile = null;
        serverQueue.songs.shift();
        if (serverQueue.songs.length > 0) playSong(guild, serverQueue.songs[0], interactionData, queueMap);
    }
}

// تشغيل البوتات بشكل مستقل
TOKENS.forEach((token, index) => {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds, 
            GatewayIntentBits.GuildVoiceStates, 
            GatewayIntentBits.GuildMessages, 
            GatewayIntentBits.MessageContent
        ]
    });

    const queue = new Map();
    const rest = new REST({ version: '10' }).setToken(token);

    client.once('ready', async () => {
        console.log(`🤖 Bot #${index + 1} is online: ${client.user.tag}`);
        try {
            await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
        } catch (e) {}

        setInterval(() => {
            const guildCount = client.guilds.cache.size;
            let voiceChannelCount = 0;
            client.guilds.cache.forEach(guild => {
                voiceChannelCount += guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice).size;
            });

            const activities = [
                { name: `🎧 Serving ${guildCount} servers`, type: ActivityType.Listening },
                { name: `🔊 Active across ${voiceChannelCount} voice channels`, type: ActivityType.Watching }
            ];

            const randomActivity = activities[Math.floor(Math.random() * activities.length)];
            client.user.setPresence({ activities: [randomActivity], status: 'online' });
        }, 10000);
    });

    client.on('interactionCreate', async interaction => {
        try {
            const guildId = interaction.guildId;
            const serverQueue = queue.get(guildId);

            if (interaction.isChatInputCommand()) {
                const { commandName } = interaction;
                const voiceChannel = interaction.member.voice?.channel;

                if (commandName === 'play') {
                    if (!voiceChannel) return interaction.reply({ content: '❌ You must be in a voice channel!', ephemeral: true });
                    
                    const query = interaction.options.getString('query');
                    if (query.includes('list=') || query.includes('/playlist')) {
                        return interaction.reply({ content: '❌ Playlists are not supported to prevent lag! Please provide a single song link.', ephemeral: true });
                    }

                    await interaction.deferReply({ ephemeral: true });
                    
                    let targetUrl, title;
                    try {
                        if (query.startsWith('http')) {
                            targetUrl = query;
                            try {
                                const info = await youtubedl(query, { dumpSingleJson: true, noCheckCertificates: true });
                                title = info.title || query;
                            } catch (e) {
                                title = query;
                            }
                        } else {
                            const results = await play.search(query, { limit: 1 });
                            if (!results || !results.length) {
                                return interaction.editReply('❌ No results found for this song name.');
                            }
                            targetUrl = results[0].url;
                            title = results[0].title;
                        }
                    } catch (searchError) {
                        return interaction.editReply('❌ Failed to fetch or search the link.');
                    }

                    const interactionData = { guildName: interaction.guild.name, voiceChannelName: voiceChannel.name };

                    if (!serverQueue) {
                        const connection = joinVoiceChannel({
                            channelId: voiceChannel.id,
                            guildId,
                            adapterCreator: interaction.guild.voiceAdapterCreator
                        });

                        const player = createAudioPlayer();
                        connection.subscribe(player);

                        const queueConstruct = {
                            textChannel: interaction.channel,
                            voiceChannel,
                            connection,
                            player,
                            songs: [{ title, url: targetUrl }],
                            history: [],
                            loop: false,
                            volume: 1,
                            filter: 'normal',
                            currentFile: null,
                            lastPanel: null
                        };

                        queue.set(guildId, queueConstruct);
                        await interaction.editReply(`✅ Started playing: **${title}**`);
                        playSong(interaction.guild, queueConstruct.songs[0], interactionData, queue);
                    } else {
                        serverQueue.songs.push({ title, url: targetUrl });
                        const queuePosition = serverQueue.songs.length - 1;
                        await interaction.editReply(`✅ Added to queue: **${title}** \`(#${queuePosition} in queue)\``);
                    }
                    return;
                }

                if (commandName === 'favorites') {
                    const userId = interaction.user.id;
                    const userFavs = userFavorites[userId] || [];
                    if (userFavs.length === 0) {
                        return interaction.reply({ content: '⭐ You have no favorite songs saved yet!', ephemeral: true });
                    }
                    const favList = userFavs.map((fav, index) => `\`${index + 1}.\` [${fav.title}](${fav.url})`).join('\n');
                    const favEmbed = new EmbedBuilder().setColor('#f1c40f').setTitle('⭐ Your Personal Favorites').setDescription(favList);
                    return interaction.reply({ embeds: [favEmbed], ephemeral: true });
                }

                if (!serverQueue) return interaction.reply({ content: '❌ Nothing is currently playing!', ephemeral: true });
                if (!voiceChannel || voiceChannel.id !== serverQueue.voiceChannel.id) {
                    return interaction.reply({ content: '❌ You must be in the same voice channel as the bot!', ephemeral: true });
                }

                if (commandName === 'pause') {
                    serverQueue.player.pause();
                    return interaction.reply({ content: '⏸️ Playback paused.', ephemeral: true });
                }
                if (commandName === 'resume') {
                    serverQueue.player.unpause();
                    return interaction.reply({ content: '▶️ Playback resumed.', ephemeral: true });
                }
                if (commandName === 'skip') {
                    serverQueue.player.stop();
                    return interaction.reply({ content: '⏭️ Track skipped.', ephemeral: true });
                }
                if (commandName === 'previous') {
                    if (!serverQueue.history || serverQueue.history.length === 0) {
                        return interaction.reply({ content: '❌ No previous songs found in history!', ephemeral: true });
                    }
                    const prevSong = serverQueue.history.pop();
                    serverQueue.songs.unshift(prevSong);
                    serverQueue.player.stop();
                    return interaction.reply({ content: '⏮️ Playing previous track.', ephemeral: true });
                }
                if (commandName === 'queue') {
                    const currentSong = serverQueue.songs[0];
                    const upcomingSongs = serverQueue.songs.slice(1);
                    const queueEmbed = new EmbedBuilder()
                        .setColor('#2b2d31')
                        .setTitle('📋 Music Queue')
                        .addFields(
                            { name: '🎵 Now Playing', value: `\`${currentSong ? currentSong.title : 'None'}\``, inline: false },
                            { name: '📜 Upcoming Tracks', value: upcomingSongs.length > 0 ? upcomingSongs.map((song, index) => `\`${index + 1}.\` ${song.title}`).join('\n') : '`No songs in queue.`', inline: false }
                        );
                    return interaction.reply({ embeds: [queueEmbed], ephemeral: true });
                }
                if (commandName === 'download') {
                    if (!serverQueue.currentFile || !fs.existsSync(serverQueue.currentFile)) {
                        return interaction.reply({ content: '❌ No audio file available to download right now.', ephemeral: true });
                    }
                    await interaction.deferReply({ ephemeral: true });
                    const currentSongTitle = serverQueue.songs[0]?.title || 'audio';
                    const safeName = currentSongTitle.replace(/[^a-zA-Z0-9أ-ي]/g, '_').substring(0, 50);
                    const attachment = new AttachmentBuilder(serverQueue.currentFile, { name: `${safeName}.mp3` });
                    return interaction.editReply({ content: `📥 Here is your audio file for: **${currentSongTitle}**`, files: [attachment] });
                }
                if (commandName === 'filter') {
                    await interaction.deferReply({ ephemeral: true });
                    const filterType = interaction.options.getString('type');
                    serverQueue.filter = filterType;
                    playSong(interaction.guild, serverQueue.songs[0], { guildName: interaction.guild.name, voiceChannelName: voiceChannel.name }, queue);
                    return interaction.editReply({ content: `🎚️ Audio filter applied: **${filterType.toUpperCase()}**. Restarting track...` });
                }
                if (commandName === 'loop') {
                    serverQueue.loop = !serverQueue.loop;
                    if (serverQueue.lastPanel) {
                        try {
                            const updatedPanel = createMusicPanel(serverQueue.songs[0]?.title || 'Unknown', serverQueue.loop, serverQueue.volume, serverQueue.filter);
                            await serverQueue.lastPanel.edit(updatedPanel);
                        } catch (e) {}
                    }
                    return interaction.reply({ content: serverQueue.loop ? '🔁 Loop mode enabled.' : '🔁 Loop mode disabled.', ephemeral: true });
                }
                if (commandName === 'volume') {
                    const level = interaction.options.getNumber('level');
                    if (level < 0.1 || level > 2) {
                        return interaction.reply({ content: '❌ Volume level must be between 0.1 and 2.', ephemeral: true });
                    }
                    serverQueue.volume = level;
                    try {
                        const resource = serverQueue.player.state.resource;
                        if (resource && resource.volume) resource.volume.setVolume(serverQueue.volume);
                    } catch (e) {}
                    if (serverQueue.lastPanel) {
                        try {
                            const updatedPanel = createMusicPanel(serverQueue.songs[0]?.title || 'Unknown', serverQueue.loop, serverQueue.volume, serverQueue.filter);
                            await serverQueue.lastPanel.edit(updatedPanel);
                        } catch (e) {}
                    }
                    return interaction.reply({ content: `🔊 Volume set to **${Math.round(level * 100)}%**`, ephemeral: true });
                }
                if (commandName === 'stop') {
                    if (serverQueue.lastPanel) {
                        try { await serverQueue.lastPanel.delete(); } catch (e) {}
                    }
                    serverQueue.songs = [];
                    serverQueue.history = [];
                    serverQueue.player.stop();
                    cleanupFile(serverQueue.currentFile);
                    if (serverQueue.connection && serverQueue.connection.state.status !== 'destroyed') {
                        serverQueue.connection.destroy();
                    }
                    queue.delete(guildId);
                    return interaction.reply({ content: '⏹️ Stopped playback and disconnected.', ephemeral: true });
                }
            }

            if (interaction.isButton()) {
                if (!serverQueue) return interaction.reply({ content: '❌ No active playback session!', ephemeral: true }).catch(() => {});
                const memberVoice = interaction.member.voice?.channel;
                if (!memberVoice || memberVoice.id !== serverQueue.voiceChannel.id) {
                    return interaction.reply({ content: '❌ You must be in the same voice channel!', ephemeral: true }).catch(() => {});
                }

                const action = interaction.customId;
                if (action === 'music_pause') {
                    serverQueue.player.pause();
                    return interaction.reply({ content: '⏸️ Audio paused.', ephemeral: true });
                } 
                if (action === 'music_resume') {
                    serverQueue.player.unpause();
                    return interaction.reply({ content: '▶️ Audio resumed.', ephemeral: true });
                } 
                if (action === 'music_skip') {
                    serverQueue.player.stop();
                    return interaction.reply({ content: '⏭️ Track skipped.', ephemeral: true });
                }
                if (action === 'music_previous') {
                    if (!serverQueue.history || serverQueue.history.length === 0) {
                        return interaction.reply({ content: '❌ No previous songs found in history!', ephemeral: true });
                    }
                    const prevSong = serverQueue.history.pop();
                    serverQueue.songs.unshift(prevSong);
                    serverQueue.player.stop();
                    return interaction.reply({ content: '⏮️ Playing previous track.', ephemeral: true });
                }
                if (action === 'music_favorite') {
                    const userId = interaction.user.id;
                    const currentSong = serverQueue.songs[0];
                    if (!currentSong) return interaction.reply({ content: '❌ No song playing to save!', ephemeral: true });

                    if (!userFavorites[userId]) userFavorites[userId] = [];
                    const existingIndex = userFavorites[userId].findIndex(s => s.url === currentSong.url);

                    if (existingIndex !== -1) {
                        userFavorites[userId].splice(existingIndex, 1);
                        saveFavorites();
                        return interaction.reply({ content: `⭐ Removed **${currentSong.title}** from your favorites!`, ephemeral: true });
                    } else {
                        userFavorites[userId].push({ title: currentSong.title, url: currentSong.url });
                        saveFavorites();
                        return interaction.reply({ content: `⭐ Added **${currentSong.title}** to your favorites!`, ephemeral: true });
                    }
                }
                if (action === 'music_voldown') {
                    serverQueue.volume = Math.max(0.1, Number((serverQueue.volume - 0.2).toFixed(1)));
                    try {
                        const resource = serverQueue.player.state.resource;
                        if (resource && resource.volume) resource.volume.setVolume(serverQueue.volume);
                    } catch (e) {}
                    if (serverQueue.lastPanel) {
                        try {
                            const updatedPanel = createMusicPanel(serverQueue.songs[0]?.title || 'Unknown', serverQueue.loop, serverQueue.volume, serverQueue.filter);
                            await serverQueue.lastPanel.edit(updatedPanel);
                        } catch (e) {}
                    }
                    return interaction.reply({ content: `🔉 Volume decreased to **${Math.round(serverQueue.volume * 100)}%**`, ephemeral: true });
                }
                if (action === 'music_volup') {
                    serverQueue.volume = Math.min(2, Number((serverQueue.volume + 0.2).toFixed(1)));
                    try {
                        const resource = serverQueue.player.state.resource;
                        if (resource && resource.volume) resource.volume.setVolume(serverQueue.volume);
                    } catch (e) {}
                    if (serverQueue.lastPanel) {
                        try {
                            const updatedPanel = createMusicPanel(serverQueue.songs[0]?.title || 'Unknown', serverQueue.loop, serverQueue.volume, serverQueue.filter);
                            await serverQueue.lastPanel.edit(updatedPanel);
                        } catch (e) {}
                    }
                    return interaction.reply({ content: `🔊 Volume increased to **${Math.round(serverQueue.volume * 100)}%**`, ephemeral: true });
                }
                if (action === 'music_download') {
                    if (!serverQueue.currentFile || !fs.existsSync(serverQueue.currentFile)) {
                        return interaction.reply({ content: '❌ No audio file available to download right now.', ephemeral: true });
                    }
                    await interaction.deferReply({ ephemeral: true });
                    const currentSongTitle = serverQueue.songs[0]?.title || 'audio';
                    const safeName = currentSongTitle.replace(/[^a-zA-Z0-9أ-ي]/g, '_').substring(0, 50);
                    const attachment = new AttachmentBuilder(serverQueue.currentFile, { name: `${safeName}.mp3` });
                    return interaction.editReply({ content: `📥 Here is your audio file for: **${currentSongTitle}**`, files: [attachment] });
                }
                if (action === 'music_loop') {
                    serverQueue.loop = !serverQueue.loop;
                    if (serverQueue.lastPanel) {
                        try {
                            const updatedPanel = createMusicPanel(serverQueue.songs[0]?.title || 'Unknown', serverQueue.loop, serverQueue.volume, serverQueue.filter);
                            await serverQueue.lastPanel.edit(updatedPanel);
                        } catch (e) {}
                    }
                    return interaction.reply({ content: serverQueue.loop ? '🔁 Loop enabled.' : '🔁 Loop disabled.', ephemeral: true });
                } 
                if (action === 'music_stop') {
                    if (serverQueue.lastPanel) {
                        try { await serverQueue.lastPanel.delete(); } catch (e) {}
                    }
                    serverQueue.songs = [];
                    serverQueue.history = [];
                    serverQueue.player.stop();
                    cleanupFile(serverQueue.currentFile);
                    if (serverQueue.connection && serverQueue.connection.state.status !== 'destroyed') {
                        serverQueue.connection.destroy();
                    }
                    queue.delete(guildId);
                    return interaction.reply({ content: '⏹️ Bot disconnected.', ephemeral: true });
                }
            }
        } catch (err) {
            if (err.code !== 10062 && err.code !== 40060) {
                console.error('Interaction Error:', err);
            }
        }
    });

    client.login(token);
});