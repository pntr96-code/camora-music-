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
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    AttachmentBuilder,
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

// 📌 الرومات الثابتة لكل بوت بالترتيب
const FIXED_CHANNELS = [
    '1518935693240565820', // بوت 1
    '1548657289529917621', // بوت 2
    '1548657305011224618', // بوت 3
    '1548657322279051444', // بوت 4
    '1548657355867037726'  // بوت 5
];

const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);

function cleanupFile(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
    }
}

function createMusicPanel(songTitle, loopStatus, volumeStatus) {
    const volPercent = Math.round(volumeStatus * 100);

    const embed = new EmbedBuilder()
        .setColor('#2b2d31')
        .setTitle('🎛️ Camora Music Studio')
        .setDescription('استخدم الأزرار أدناه للتحكم بالتشغيل والصوت.')
        .addFields(
            { name: '🎵 المقطع الحالي', value: `\`${songTitle}\``, inline: false },
            { name: '🔁 التكرار', value: loopStatus ? '`مفعل`' : '`معطل`', inline: true },
            { name: '🔊 الصوت', value: `\`${volPercent}%\``, inline: true }
        )
        .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_pause').setLabel('إيقاف مؤقت').setStyle(ButtonStyle.Primary).setEmoji('⏸️'),
        new ButtonBuilder().setCustomId('music_resume').setLabel('استئناف').setStyle(ButtonStyle.Success).setEmoji('▶️'),
        new ButtonBuilder().setCustomId('music_skip').setLabel('تخطي').setStyle(ButtonStyle.Secondary).setEmoji('⏭️')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_loop').setLabel('تكرار').setStyle(ButtonStyle.Primary).setEmoji('🔁'),
        new ButtonBuilder().setCustomId('music_voldown').setLabel('خفاض صوت').setStyle(ButtonStyle.Secondary).setEmoji('🔉'),
        new ButtonBuilder().setCustomId('music_volup').setLabel('رفع صوت').setStyle(ButtonStyle.Secondary).setEmoji('🔊'),
        new ButtonBuilder().setCustomId('music_stop').setLabel('إيقاف نهائي').setStyle(ButtonStyle.Danger).setEmoji('⏹️')
    );

    return { embeds: [embed], components: [row1, row2] };
}

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

    client.once('ready', async () => {
        console.log(`🤖 Bot #${botNumber} is online: ${client.user.tag}`);

        // الدخول الفوري والثابت للروم الصوتي فور تشغيل البوت
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
                        currentFile: null,
                        lastPanel: null
                    });
                    console.log(`🔗 Bot #${botNumber} joined room in guild: ${guild.name}`);
                } catch (err) {}
            }
        });
    });

    async function playSong(guild, song) {
        const serverQueue = queue.get(guild.id);
        if (!song) {
            if (serverQueue?.lastPanel) {
                try { await serverQueue.lastPanel.delete(); } catch (e) {}
            }
            cleanupFile(serverQueue?.currentFile);
            serverQueue.currentFile = null;
            serverQueue.lastPanel = null;
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

            const panelData = createMusicPanel(song.title, serverQueue.loop, serverQueue.volume);
            if (serverQueue.textChannel) {
                if (serverQueue.lastPanel) {
                    try { await serverQueue.lastPanel.edit(panelData); } catch (e) {
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
                    playSong(guild, serverQueue.songs[0]);
                } else {
                    serverQueue.songs.shift();
                    playSong(guild, serverQueue.songs[0]);
                }
            });

        } catch (err) {
            cleanupFile(serverQueue.currentFile);
            serverQueue.currentFile = null;
            serverQueue.songs.shift();
            if (serverQueue.songs.length > 0) playSong(guild, serverQueue.songs[0]);
        }
    }

    client.on('interactionCreate', async interaction => {
        try {
            const guildId = interaction.guildId;
            let serverQueue = queue.get(guildId);

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
                        currentFile: null,
                        lastPanel: null
                    };
                    queue.set(guildId, serverQueue);
                }
            }

            serverQueue.textChannel = interaction.channel;

            // أزرار لوحة التحكم
            if (interaction.isButton()) {
                const action = interaction.customId;
                if (!serverQueue || serverQueue.songs.length === 0) {
                    return interaction.reply({ content: '❌ لا يوجد مقطع يعمل حالياً!', ephemeral: true });
                }

                if (action === 'music_pause') {
                    serverQueue.player.pause();
                    return interaction.reply({ content: '⏸️ تم إيقاف المقطع مؤقتاً.', ephemeral: true });
                }
                if (action === 'music_resume') {
                    serverQueue.player.unpause();
                    return interaction.reply({ content: '▶️ تم استئناف التشغيل.', ephemeral: true });
                }
                if (action === 'music_skip') {
                    serverQueue.player.stop();
                    return interaction.reply({ content: '⏭️ تم تخطي المقطع.', ephemeral: true });
                }
                if (action === 'music_loop') {
                    serverQueue.loop = !serverQueue.loop;
                    if (serverQueue.lastPanel) {
                        try {
                            const updatedPanel = createMusicPanel(serverQueue.songs[0]?.title || 'Unknown', serverQueue.loop, serverQueue.volume);
                            await serverQueue.lastPanel.edit(updatedPanel);
                        } catch (e) {}
                    }
                    return interaction.reply({ content: serverQueue.loop ? '🔁 تم تفعيل التكرار.' : '🔁 تم إيقاف التكرار.', ephemeral: true });
                }
                if (action === 'music_voldown') {
                    serverQueue.volume = Math.max(0.1, Number((serverQueue.volume - 0.2).toFixed(1)));
                    try {
                        const res = serverQueue.player.state.resource;
                        if (res && res.volume) res.volume.setVolume(serverQueue.volume);
                    } catch (e) {}
                    return interaction.reply({ content: `🔉 تم خفض الصوت إلى ${Math.round(serverQueue.volume * 100)}%`, ephemeral: true });
                }
                if (action === 'music_volup') {
                    serverQueue.volume = Math.min(2, Number((serverQueue.volume + 0.2).toFixed(1)));
                    try {
                        const res = serverQueue.player.state.resource;
                        if (res && res.volume) res.volume.setVolume(serverQueue.volume);
                    } catch (e) {}
                    return interaction.reply({ content: `🔊 تم رفع الصوت إلى ${Math.round(serverQueue.volume * 100)}%`, ephemeral: true });
                }
                if (action === 'music_stop') {
                    if (serverQueue.lastPanel) {
                        try { await serverQueue.lastPanel.delete(); } catch (e) {}
                    }
                    serverQueue.songs = [];
                    serverQueue.player.stop();
                    cleanupFile(serverQueue.currentFile);
                    serverQueue.currentFile = null;
                    serverQueue.lastPanel = null;
                    return interaction.reply({ content: '⏹️ تم إيقاف التشغيل وتفريغ القائمة (البوت باقي في الروم الثابت).', ephemeral: true });
                }
            }
        } catch (err) {}
    });

    client.login(token);
});
