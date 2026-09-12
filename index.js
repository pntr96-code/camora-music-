const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');
const play = require('play-dl');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ==========================================
// ⚙️ إعدادات البوت (تأكد من وضعها في ملف .env)
// ==========================================
const CONFIG = {
    CLIENT_ID: process.env.CLIENT_ID,
    CLIENT_SECRET: process.env.CLIENT_SECRET,
    BOT_TOKEN: process.env.BOT_TOKEN,
    OWNER_ID: process.env.OWNER_ID
};
// ==========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const queue = new Map();
const stateFilePath = path.join(__dirname, 'bot_state.json');
const startTime = Date.now();
let lastRestartTime = new Date().toLocaleString();

const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const commands = [
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist from YouTube')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('URL, playlist link, or search query')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('p')
        .setDescription('Shortcut for play command')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('URL or search query')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('join')
        .setDescription('Bring the bot to your voice channel'),
    new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Toggle loop for the current track'),
    new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current track'),
    new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause the playback'),
    new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume the playback'),
    new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop music and clear the queue'),
    new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Disconnect the bot from voice channel'),
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Send the interactive control panel'),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Display help information and available commands')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(CONFIG.BOT_TOKEN);

async function registerSlashCommands() {
    try {
        console.log('⏳ Registering Slash commands...');
        await rest.put(
            Routes.applicationCommands(CONFIG.CLIENT_ID),
            { body: commands },
        );
        console.log('✅ Slash commands successfully registered and updated!');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
}

function setupConnectionHandlers(connection, guild, voiceChannel, textChannel) {
    connection.on('stateChange', async (oldState, newState) => {
        if (newState.status === VoiceConnectionStatus.Disconnected) {
            try {
                await Promise.race([
                    new Promise((resolve) => connection.once(VoiceConnectionStatus.Signalling, resolve)),
                    new Promise((resolve) => connection.once(VoiceConnectionStatus.Connecting, resolve)),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
                ]);
            } catch (error) {
                try {
                    const newConnection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: guild.id,
                        adapterCreator: guild.voiceAdapterCreator,
                        selfDeaf: true,
                    });
                    const serverQueue = queue.get(guild.id);
                    if (serverQueue) {
                        serverQueue.connection = newConnection;
                        newConnection.subscribe(serverQueue.player);
                        setupConnectionHandlers(newConnection, guild, voiceChannel, textChannel);
                    }
                } catch (e) {
                    console.error('Failed to reconnect to voice channel:', e);
                }
            }
        }
    });
}

client.once('ready', async () => {
    console.log(`✅ Bot is online and ready: ${client.user.tag}`);
    await registerSlashCommands();

    const statuses = [
        () => {
            const guildCount = client.guilds.cache.size;
            return { name: `over ${guildCount} servers`, type: ActivityType.Watching };
        },
        () => {
            let activeVoiceCount = 0;
            queue.forEach((serverQueue) => {
                if (serverQueue.connection && serverQueue.voiceChannel) {
                    activeVoiceCount++;
                }
            });
            return { name: `music in ${activeVoiceCount} voice channels`, type: ActivityType.Playing };
        }
    ];

    let currentIndex = 0;
    const updateStatus = () => {
        const statusObj = statuses[currentIndex]();
        client.user.setActivity(statusObj.name, { type: statusObj.type });
        currentIndex = (currentIndex + 1) % statuses.length;
    };

    updateStatus();
    setInterval(updateStatus, 5000);

    console.log(`💻 CMD Commands available: status, reload, exit\n`);

    if (fs.existsSync(stateFilePath)) {
        try {
            const savedState = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
            if (savedState && savedState.guildId && savedState.voiceChannelId) {
                const guild = client.guilds.cache.get(savedState.guildId);
                if (guild) {
                    const voiceChannel = guild.channels.cache.get(savedState.voiceChannelId);
                    const textChannel = guild.channels.cache.get(savedState.textChannelId);
                    if (voiceChannel) {
                        const connection = joinVoiceChannel({
                            channelId: voiceChannel.id,
                            guildId: guild.id,
                            adapterCreator: guild.voiceAdapterCreator,
                            selfDeaf: true,
                        });

                        const queueConstruct = {
                            textChannel: textChannel,
                            voiceChannel: voiceChannel,
                            connection: connection,
                            player: createAudioPlayer(),
                            songs: savedState.songs || [],
                            loop: savedState.loop || false
                        };

                        queue.set(guild.id, queueConstruct);
                        queueConstruct.connection.subscribe(queueConstruct.player);
                        setupConnectionHandlers(connection, guild, voiceChannel, textChannel);

                        queueConstruct.player.on(AudioPlayerStatus.Idle, () => {
                            const q = queue.get(guild.id);
                            if (!q) return;

                            if (q.loop && q.songs.length > 0) {
                                processAndPlay(guild, q.songs[0]);
                                return;
                            }

                            const finishedSong = q.songs.shift();
                            if (finishedSong && finishedSong.filePath && fs.existsSync(finishedSong.filePath)) {
                                try { fs.unlinkSync(finishedSong.filePath); } catch (e) {}
                            }

                            if (q.songs.length > 0 && q.songs[0]) {
                                processAndPlay(guild, q.songs[0]);
                            } else {
                                if (q.textChannel) {
                                    q.textChannel.send('🎶 Queue finished, bot is staying in voice channel (Always Online).').catch(() => {});
                                }
                            }
                        });

                        queueConstruct.player.on('error', error => {
                            console.error('Player Error:', error);
                            const q = queue.get(guild.id);
                            if (q) {
                                q.songs.shift();
                                if (q.songs.length > 0 && q.songs[0]) {
                                    processAndPlay(guild, q.songs[0]);
                                }
                            }
                        });

                        if (queueConstruct.songs.length > 0) {
                            processAndPlay(guild, queueConstruct.songs[0]);
                        }
                    }
                }
            }
            fs.unlinkSync(stateFilePath);
        } catch (e) {
            console.error('Error restoring state:', e);
        }
    }

    rl.on('line', (line) => {
        const cmdInput = line.trim().toLowerCase();
        if (cmdInput === 'exit' || cmdInput === 'quit' || cmdInput === 'stop') {
            if (fs.existsSync(stateFilePath)) fs.unlinkSync(stateFilePath);
            queue.forEach((serverQueue) => {
                try { serverQueue.connection.destroy(); } catch (e) {}
            });
            client.destroy();
            process.exit(0);
        } 
        else if (cmdInput === 'status' || cmdInput === 'info') {
            let totalChannels = 0;
            client.guilds.cache.forEach(guild => {
                totalChannels += guild.channels.cache.size;
            });

            const uptimeMs = Date.now() - startTime;
            const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
            const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((uptimeMs % (1000 * 60)) / 1000);

            console.log(`\n=== 📊 BOT STATUS REPORT ===`);
            console.log(`🌐 Connected Servers: ${client.guilds.cache.size}`);
            console.log(`📁 Total Channels: ${totalChannels}`);
            console.log(`⏱️ Uptime: ${hours}h ${minutes}m ${seconds}s`);
            console.log(`🔄 Last Restart: ${lastRestartTime}`);
            console.log(`===========================\n`);
        }
        else if (cmdInput === 'reload' || cmdInput === 'restart') {
            queue.forEach((serverQueue, guildId) => {
                const stateData = {
                    guildId: guildId,
                    voiceChannelId: serverQueue.voiceChannel?.id,
                    textChannelId: serverQueue.textChannel?.id,
                    songs: serverQueue.songs,
                    loop: serverQueue.loop
                };
                fs.writeFileSync(stateFilePath, JSON.stringify(stateData));
            });
            console.log('✅ Reloaded successfully!');
        }
    });
});

async function handlePlayCommand(interaction) {
    const query = interaction.options.getString('query');
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) return interaction.reply({ content: '❌ You must be connected to a voice channel first!', ephemeral: true });

    await interaction.deferReply();
    let serverQueue = queue.get(interaction.guildId);

    try {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: interaction.guildId,
            adapterCreator: interaction.guild.voiceAdapterCreator,
            selfDeaf: true,
        });

        const songsToAdd = [];

        if (query.includes('playlist?list=')) {
            const playlist = await play.playlist_info(query, { incomplete: true });
            const playlistVideos = await playlist.all_videos();
            for (const video of playlistVideos) {
                songsToAdd.push({ title: video.title, url: video.url, filePath: null });
            }
        } else if (query.startsWith('http')) {
            songsToAdd.push({ title: query, url: query, filePath: null });
        } else {
            const searchResults = await play.search(query, { limit: 1 });
            if (!searchResults || searchResults.length === 0) return interaction.editReply('❌ No matching results found!');
            songsToAdd.push({ title: searchResults[0].title, url: searchResults[0].url, filePath: null });
        }

        if (songsToAdd.length === 0) return interaction.editReply('❌ No tracks found to add!');

        if (!serverQueue) {
            const queueConstruct = {
                textChannel: interaction.channel,
                voiceChannel: voiceChannel,
                connection: connection,
                player: createAudioPlayer(),
                songs: [],
                loop: false
            };

            queue.set(interaction.guildId, queueConstruct);
            queueConstruct.songs.push(...songsToAdd);
            queueConstruct.connection.subscribe(queueConstruct.player);
            setupConnectionHandlers(connection, interaction.guild, voiceChannel, interaction.channel);

            queueConstruct.player.on(AudioPlayerStatus.Idle, () => {
                const q = queue.get(interaction.guildId);
                if (!q) return;

                if (q.loop && q.songs.length > 0) {
                    processAndPlay(interaction.guild, q.songs[0]);
                    return;
                }

                const finishedSong = q.songs.shift();
                if (finishedSong && finishedSong.filePath && fs.existsSync(finishedSong.filePath)) {
                    try { fs.unlinkSync(finishedSong.filePath); } catch (e) {}
                }

                if (q.songs.length > 0 && q.songs[0]) {
                    processAndPlay(interaction.guild, q.songs[0]);
                } else {
                    if (q.textChannel) {
                        q.textChannel.send('🎶 Queue finished, bot is staying in voice channel (Always Online).').catch(() => {});
                    }
                }
            });

            queueConstruct.player.on('error', error => {
                console.error('Player Error:', error);
                const q = queue.get(interaction.guildId);
                if (q) {
                    q.songs.shift();
                    if (q.songs.length > 0 && q.songs[0]) {
                        processAndPlay(guild, q.songs[0]);
                    }
                }
            });

            await interaction.editReply(`⏳ **Playing track... (${songsToAdd.length} track)**`);
            processAndPlay(interaction.guild, queueConstruct.songs[0]);

        } else {
            const wasEmpty = serverQueue.songs.length === 0;
            serverQueue.songs.push(...songsToAdd);
            serverQueue.textChannel = interaction.channel;

            if (wasEmpty) {
                await interaction.editReply(`⏳ **Playing track... (${songsToAdd.length} track)**`);
                processAndPlay(interaction.guild, serverQueue.songs[0]);
            } else {
                await interaction.editReply(`✅ **Added ${songsToAdd.length} tracks to queue (Position: ${serverQueue.songs.length})!**`);
            }
        }

    } catch (error) {
        console.error(error);
        await interaction.editReply('❌ An error occurred while processing the track or playlist.');
    }
}

client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'play' || commandName === 'p') {
            await handlePlayCommand(interaction);
        }

        else if (commandName === 'join') {
            const voiceChannel = interaction.member.voice.channel;
            if (!voiceChannel) return interaction.reply({ content: '❌ You must be connected to a voice channel first!', ephemeral: true });

            try {
                joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: interaction.guildId,
                    adapterCreator: interaction.guild.voiceAdapterCreator,
                    selfDeaf: true,
                });
                return interaction.reply({ content: `✅ **Joined voice channel successfully!**`, ephemeral: true });
            } catch (error) {
                console.error(error);
                return interaction.reply({ content: '❌ An error occurred while joining the voice channel.', ephemeral: true });
            }
        }

        else if (commandName === 'loop') {
            const serverQueue = queue.get(interaction.guildId);
            if (!serverQueue) return interaction.reply({ content: '❌ Nothing is currently playing!', ephemeral: true });
            serverQueue.loop = !serverQueue.loop;
            return interaction.reply(serverQueue.loop ? '🔁 **Loop On**' : '🔁 **Loop Off**');
        }

        else if (commandName === 'skip') {
            const serverQueue = queue.get(interaction.guildId);
            if (!serverQueue) return interaction.reply({ content: '❌ Nothing is currently playing!', ephemeral: true });
            serverQueue.player.stop(); 
            return interaction.reply('⏭️ Track skipped.');
        }

        else if (commandName === 'pause') {
            const serverQueue = queue.get(interaction.guildId);
            if (!serverQueue) return interaction.reply({ content: '❌ Nothing is currently playing!', ephemeral: true });
            serverQueue.player.pause();
            return interaction.reply('⏸️ **Playback paused.**');
        }

        else if (commandName === 'resume') {
            const serverQueue = queue.get(interaction.guildId);
            if (!serverQueue) return interaction.reply({ content: '❌ Nothing is paused!', ephemeral: true });
            serverQueue.player.unpause();
            return interaction.reply('▶️ **Playback resumed.**');
        }

        else if (commandName === 'stop') {
            const serverQueue = queue.get(interaction.guildId);
            if (!serverQueue) return interaction.reply({ content: '❌ Nothing is currently playing!', ephemeral: true });
            serverQueue.player.stop();
            serverQueue.songs = [];
            return interaction.reply('⏸️ **Playback stopped and queue cleared.**');
        }

        else if (commandName === 'leave') {
            const serverQueue = queue.get(interaction.guildId);
            if (!serverQueue) return interaction.reply({ content: '❌ Bot is not connected!', ephemeral: true });
            if (!interaction.member.permissions.has('Administrator') && !interaction.member.permissions.has('ManageChannels')) {
                return interaction.reply({ content: '❌ You do not have permission!', ephemeral: true });
            }
            serverQueue.songs = [];
            try { serverQueue.connection.destroy(); } catch (e) {}
            queue.delete(interaction.guildId);
            return interaction.reply('🛑 **Bot disconnected.**');
        }

        else if (commandName === 'panel') {
            const serverQueue = queue.get(interaction.guildId);
            if (!serverQueue) return interaction.reply({ content: '❌ Bot must be connected first!', ephemeral: true });
            await interaction.deferReply();
            await sendControlPanel(interaction.channel, serverQueue);
            await interaction.deleteReply();
        }

        else if (commandName === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('🎵 𝐂𝐚𝐦𝐨𝐫𝐚 𝐌𝐮𝐬𝐢𝐜 • Help & Commands')
                .setDescription('Your ultimate companion for high-quality music, interactive control panels, and 24/7 playback.')
                .addFields(
                    { name: '🎶 Music Commands', value: '`/play` or `/p` - Play a song or playlist\n`/join` - Bring bot to your voice channel\n`/loop` - Toggle track loop\n`/skip` - Skip current track\n`/pause` - Pause playback\n`/resume` - Resume playback', inline: false },
                    { name: '🎛️ Control & Management', value: '`/panel` - Send interactive control panel\n`/stop` - Stop audio and clear queue\n`/leave` - Disconnect the bot', inline: false },
                    { name: '🔗 Important Links', value: '[Join Support Server](https://discord.gg/2tW4USQW7p)', inline: false }
                )
                .setFooter({ text: '𝐂𝐚𝐦𝐨𝐫𝐚 𝐌𝐮𝐬𝐢𝐜 • All rights reserved' });

            return interaction.reply({ embeds: [helpEmbed], ephemeral: true });
        }
    }

    if (interaction.isButton()) {
        const q = queue.get(interaction.guildId);

        if (interaction.customId === 'btn_pause') {
            if (!q) return interaction.reply({ content: '❌ Nothing is playing!', ephemeral: true });
            q.player.pause();
            await interaction.reply({ content: '⏸️ Paused.', ephemeral: true });
        } else if (interaction.customId === 'btn_resume') {
            if (!q) return interaction.reply({ content: '❌ Nothing is paused!', ephemeral: true });
            q.player.unpause();
            await interaction.reply({ content: '▶️ Resumed.', ephemeral: true });
        } else if (interaction.customId === 'btn_skip') {
            if (!q) return interaction.reply({ content: '❌ Nothing is playing!', ephemeral: true });
            q.player.stop();
            await interaction.reply({ content: '⏭️ Skipped.', ephemeral: true });
        } else if (interaction.customId === 'btn_loop') {
            if (!q) return interaction.reply({ content: '❌ Nothing is playing!', ephemeral: true });
            q.loop = !q.loop;
            await interaction.reply({ content: q.loop ? '🔁 Loop On' : '🔁 Loop Off', ephemeral: true });
        } else if (interaction.customId === 'btn_stop') {
            if (!q) return interaction.reply({ content: '❌ Nothing is playing!', ephemeral: true });
            q.player.stop(); q.songs = [];
            await interaction.reply({ content: '⏹️ Stopped and queue cleared.', ephemeral: true });
        } else if (interaction.customId === 'btn_leave') {
            if (!q) return interaction.reply({ content: '❌ Bot is not connected!', ephemeral: true });
            if (!interaction.member.permissions.has('Administrator') && !interaction.member.permissions.has('ManageChannels')) {
                return interaction.reply({ content: '❌ You lack permission!', ephemeral: true });
            }
            q.songs = [];
            try { q.connection.destroy(); } catch (e) {}
            queue.delete(interaction.guildId);
            await interaction.reply({ content: '🛑 Bot left the voice channel.', ephemeral: true });
        }
    }
});

async function sendControlPanel(channel, serverQueue) {
    const panelEmbed = new EmbedBuilder()
        .setColor('#2b2d31')
        .setTitle('🎛️ 𝐂𝐚𝐦𝐨𝐫𝐚 𝐌𝐮𝐬𝐢𝐜 Interface')
        .setDescription('Control panel for **𝐂𝐚𝐦𝐨𝐫𝐚 𝐌𝐮𝐬𝐢𝐜**. Use the buttons below to manage playback:')
        .addFields(
            { name: '🎵 Current Track', value: serverQueue.songs.length > 0 ? `\`${serverQueue.songs[0].title}\`` : '`Always Online`', inline: false }
        )
        .setFooter({ text: '𝐂𝐚𝐦𝐨𝐫𝐚 𝐌𝐮𝐬𝐢𝐜 • Interactive Control Panel' });

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_pause').setLabel('Pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_resume').setLabel('Resume').setEmoji('▶️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_skip').setLabel('Skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_loop').setLabel('Loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_stop').setLabel('Stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('btn_leave').setLabel('Leave').setEmoji('🚪').setStyle(ButtonStyle.Danger)
    );

    return await channel.send({ embeds: [panelEmbed], components: [row1, row2] });
}

async function processAndPlay(guild, songData) {
    const serverQueue = queue.get(guild.id);
    if (!serverQueue || !songData) return;

    try {
        const fileName = `song_${Date.now()}.webm`;
        const filePath = path.join(downloadsDir, fileName);
        songData.filePath = filePath;

        await youtubedl(songData.url, {
            f: 'bestaudio',
            o: filePath,
            noCheckCertificates: true,
            noWarnings: true,
            noPlaylist: true
        });

        if (!fs.existsSync(filePath)) throw new Error('Downloaded file not found.');

        const resource = createAudioResource(filePath);
        serverQueue.player.play(resource);

        if (serverQueue.textChannel) {
            await sendControlPanel(serverQueue.textChannel, serverQueue);
        }

    } async (err) => {
        console.error('Download/Playback Error:', err);
        serverQueue.songs.shift();
        if (serverQueue.songs.length > 0 && serverQueue.songs[0]) {
            processAndPlay(guild, serverQueue.songs[0]);
        }
    }
}

client.login(CONFIG.BOT_TOKEN);