const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;

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

const tokensEnv = process.env.BOT_TOKENS || '';
const TOKENS = tokensEnv.split(',').map(t => t.trim()).filter(Boolean);

if (TOKENS.length === 0) {
    console.error('❌ Error: No bot tokens found! Please set BOT_TOKENS.');
    process.exit(1);
}

// 📌 الرومات الثابتة لكل بوت (البوت الأول يرتبط بالروم الأول، وهكذا)
const FIXED_CHANNELS = [
    '1518935693240565820', // بوت 1
    '1548657289529917621', // بوت 2
    '1548657305011224618', // بوت 3
    '1548657322279051444', // بوت 4
    '1548657355867037726'  // بوت 5
];

const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);

const favoritesFile = path.join(__dirname, 'favorites.json');
let userFavorites = {};
if (fs.existsSync(favoritesFile)) {
    try { userFavorites = JSON.parse(fs.readFileSync(favoritesFile, 'utf8')); } catch (e) {}
}

function saveFavorites() {
    try { fs.writeFileSync(favoritesFile, JSON.stringify(userFavorites, null, 2)); } catch (e) {}
}

function cleanupFile(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
    }
}

// تشغيل كل بوت على حِدة وبشكل مستقل تماماً عن البقية
TOKENS.forEach((token, index) => {
    const botNumber = index + 1;
    const fixedChannelId = FIXED_CHANNELS[index];

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds, 
            GatewayIntentBits.GuildVoiceStates, 
            GatewayIntentBits.GuildMessages, 
            GatewayIntentBits.MessageContent
        ]
    });

    const queue = new Map();

    // تخصيص أوامر سلاش فريدة لكل بوت لكي لا تتداخل أبداً (مثلاً play1, play2...)
    const slashCommands = [
        new SlashCommandBuilder()
            .setName(`play${botNumber}`)
            .setDescription(`🎵 Play a song on Bot #${botNumber}`)
            .addStringOption(opt => opt.setName('query').setDescription('YouTube link or song name').setRequired(true)),
        new SlashCommandBuilder().setName(`skip${botNumber}`).setDescription(`⏭️ Skip song on Bot #${botNumber}`),
        new SlashCommandBuilder().setName(`stop${botNumber}`).setDescription(`⏹️ Stop music on Bot #${botNumber}`),
        new SlashCommandBuilder().setName(`queue${botNumber}`).setDescription(`📋 Show queue for Bot #${botNumber}`),
        new SlashCommandBuilder().setName(`favorites${botNumber}`).setDescription(`⭐ Show favorites`)
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(token);

    client.once('ready', async () => {
        console.log(`🤖 Bot #${botNumber} is online: ${client.user.tag}`);
        try {
            await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
        } catch (e) {}

        // الدخول الثابت الفوري للروم المخصص لهذا البوت فقط
        client.guilds.cache.forEach(guild => {
            const voiceChannel = guild.channels.cache.get(fixedChannelId);
            if (voiceChannel && voiceChannel.type === ChannelType.GuildVoice) {
                try {
                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: guild.id,
                        adapterCreator: guild.voiceAdapterCreator
                    });

                    const player = createAudioPlayer();
                    connection.subscribe(player);

                    queue.set(guild.id, {
                        textChannel: null,
                        voiceChannel,
                        connection,
                        player,
                        songs: [],
                        history: [],
                        loop: false,
                        volume: 1,
                        filter: 'normal',
                        currentFile: null,
                        lastPanel: null
                    });
                } catch (err) {}
            }
        });
    });

    async function playSong(guild, song) {
        const serverQueue = queue.get(guild.id);
        if (!song) {
            cleanupFile(serverQueue?.currentFile);
            serverQueue.currentFile = null;
            return;
        }

        cleanupFile(serverQueue.currentFile);

        try {
            const filePath = path.join(downloadsDir, `bot${botNumber}_${Date.now()}.mp3`);
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

            const resource = createAudioResource(filePath, { inlineVolume: true });
            resource.volume.setVolume(serverQueue.volume);
            serverQueue.player.play(resource);

            serverQueue.player.once(AudioPlayerStatus.Idle, () => {
                cleanupFile(filePath);
                serverQueue.currentFile = null;
                serverQueue.songs.shift();
                playSong(guild, serverQueue.songs[0]);
            });

        } catch (err) {
            cleanupFile(serverQueue.currentFile);
            serverQueue.currentFile = null;
            serverQueue.songs.shift();
            if (serverQueue.songs.length > 0) playSong(guild, serverQueue.songs[0]);
        }
    }

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        const guildId = interaction.guildId;
        let serverQueue = queue.get(guildId);

        // تجهيز الاتصال تلقائياً لو لم يكن موجوداً بالسيرفر
        if (!serverQueue) {
            const voiceChannel = interaction.guild.channels.cache.get(fixedChannelId);
            if (voiceChannel) {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId,
                    adapterCreator: interaction.guild.voiceAdapterCreator
                });
                const player = createAudioPlayer();
                connection.subscribe(player);
                serverQueue = {
                    textChannel: interaction.channel,
                    voiceChannel,
                    connection,
                    player,
                    songs: [],
                    history: [],
                    loop: false,
                    volume: 1,
                    filter: 'normal',
                    currentFile: null,
                    lastPanel: null
                };
                queue.set(guildId, serverQueue);
            } else {
                return interaction.reply({ content: `❌ Fixed voice channel for Bot #${botNumber} not found!`, ephemeral: true });
            }
        }

        const { commandName } = interaction;

        if (commandName === `play${botNumber}`) {
            const query = interaction.options.getString('query');
            await interaction.deferReply({ ephemeral: true });

            let targetUrl, title;
            try {
                if (query.startsWith('http')) {
                    targetUrl = query;
                    try {
                        const info = await youtubedl(query, { dumpSingleJson: true, noCheckCertificates: true });
                        title = info.title || query;
                    } catch (e) { title = query; }
                } else {
                    const results = await play.search(query, { limit: 1 });
                    if (!results || !results.length) return interaction.editReply('❌ No results found.');
                    targetUrl = results[0].url;
                    title = results[0].title;
                }
            } catch (e) {
                return interaction.editReply('❌ Failed to fetch link.');
            }

            if (serverQueue.songs.length === 0) {
                serverQueue.songs.push({ title, url: targetUrl });
                await interaction.editReply(`✅ Bot #${botNumber} playing: **${title}**`);
                playSong(interaction.guild, serverQueue.songs[0]);
            } else {
                serverQueue.songs.push({ title, url: targetUrl });
                await interaction.editReply(`✅ Bot #${botNumber} added to queue: **${title}**`);
            }
        }

        if (commandName === `skip${botNumber}`) {
            if (serverQueue.songs.length === 0) return interaction.reply({ content: '❌ Nothing playing!', ephemeral: true });
            serverQueue.player.stop();
            return interaction.reply({ content: `⏭️ Bot #${botNumber} track skipped.`, ephemeral: true });
        }

        if (commandName === `stop${botNumber}`) {
            serverQueue.songs = [];
            serverQueue.player.stop();
            cleanupFile(serverQueue.currentFile);
            return interaction.reply({ content: `⏹️ Bot #${botNumber} stopped (remains in voice channel).`, ephemeral: true });
        }
    });

    client.login(token);
});
