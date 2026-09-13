const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;

process.on('unhandledRejection', error => {
    if (error.code === 10062 || error.code === 40060) return;
});
process.on('uncaughtException', (err) => {
    if (err.code === 10062 || err.code === 40060) return;
});

const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ChannelType
} = require('discord.js');

const { joinVoiceChannel, createAudioPlayer } = require('@discordjs/voice');
const path = require('path');
const fs = require('fs');

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

// دالة تشغيل بوت منفرد بشكل مستقل تماماً
function launchBot(token, targetChannelId, botName) {
    if (!token) {
        console.log(`⚠️ Token for ${botName} is missing!`);
        return;
    }

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
        console.log(`🤖 [${botName}] is online: ${client.user.tag}`);

        client.guilds.cache.forEach(guild => {
            const voiceChannel = guild.channels.cache.get(targetChannelId);
            if (voiceChannel && voiceChannel.type === ChannelType.GuildVoice) {
                try {
                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: guild.id,
                        adapterCreator: guild.voiceAdapterCreator,
                        selfDeaf: false
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
                    console.log(`✅ [${botName}] Locked into room ID: ${targetChannelId}`);
                } catch (err) {
                    console.error(`❌ [${botName}] Error joining room:`, err);
                }
            } else {
                console.log(`⚠️ [${botName}] Room ID (${targetChannelId}) not found in server!`);
            }
        });
    });

    client.on('interactionCreate', async interaction => {
        try {
            const guildId = interaction.guildId;
            let serverQueue = queue.get(guildId);

            if (!serverQueue) {
                const voiceChannel = interaction.guild.channels.cache.get(targetChannelId);
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
                    return interaction.reply({ content: '⏹️ تم إيقاف التشغيل.', ephemeral: true });
                }
            }
        } catch (err) {}
    });

    client.login(token).catch(e => console.error(`❌ Failed to login ${botName}:`, e.message));
}

// تشغيل البوتات الخمسة بالتسلسل المباشر والصحيح
launchBot(process.env.TOKEN_1, '1518935693240565820', 'Camora Music 1');
launchBot(process.env.TOKEN_2, '1548657289529917621', 'Camora Music 2');
launchBot(process.env.TOKEN_3, '1548657305011224618', 'Camora Music 3');
launchBot(process.env.TOKEN_4, '1548657322279051444', 'Camora Music 4');
launchBot(process.env.TOKEN_5, '1548657355867037726', 'Camora Music 5');
