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

const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');
const play = require('play-dl');
const path = require('path');
const fs = require('fs');

const tokensEnv = process.env.BOT_TOKENS || '';
const TOKENS = tokensEnv.split(',').map(t => t.trim()).filter(Boolean);

// 📌 ايديوهات الرومات الصوتية الخمسة بالترتيب الصحيح لكل بوت
const FIXED_CHANNELS = [
    '1518935693240565820', // Bot 1
    '1548657289529917621', // Bot 2
    '1548657305011224618', // Bot 3
    '1548657322279051444', // Bot 4
    '1548657355867037726'  // Bot 5
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

        client.guilds.cache.forEach(guild => {
            const voiceChannel = guild.channels.cache.get(fixedChannelId);
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
                    console.log(`✅ Bot #${botNumber} joined room: ${voiceChannel.name} in (${guild.name})`);
                } catch (err) {
                    console.error(`❌ Bot #${botNumber} failed to join room:`, err);
                }
            } else {
                console.log(`⚠️ Bot #${botNumber} channel ID (${fixedChannelId}) not found in guild (${guild.name})`);
            }
        });
    });

    client.login(token);
});
