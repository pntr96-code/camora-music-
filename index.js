const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;

process.on('unhandledRejection', error => {
    if (error.code === 10062 || error.code === 40060 || error.code === 170020) return;
});
process.on('uncaughtException', (err) => {
    if (err.code === 10062 || err.code === 40060 || err.code === 170020) return;
});

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');
const path = require('path');
const fs = require('fs');

const BOT_TOKEN = process.env.TOKEN_1;
const TARGET_CHANNEL = '1518935693240565820';

const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);

function cleanupFile(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
    }
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
    console.log(`🤖 [Camora Music] is online: ${client.user.tag}`);

    client.guilds.cache.forEach(guild => {
        const voiceChannel = guild.channels.cache.get(TARGET_CHANNEL);
        if (voiceChannel && voiceChannel.type === ChannelType.GuildVoice) {
            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator,
                    selfDeaf: true
                });

                const player = createAudioPlayer();
                connection.subscribe(player);

                queue.set(guild.id, {
                    voiceChannel,
                    connection,
                    player,
                    songs: [],
                    currentFile: null
                });
                console.log(`✅ Locked into room: ${voiceChannel.name}`);
            } catch (err) {}
        }
    });
});

async function playSong(guild, song) {
    const serverQueue = queue.get(guild.id);
    if (!song || !song.url) {
        cleanupFile(serverQueue?.currentFile);
        serverQueue.currentFile = null;
        return;
    }

    cleanupFile(serverQueue.currentFile);

    try {
        const filePath = path.join(downloadsDir, `audio_${Date.now()}.mp3`);
        serverQueue.currentFile = filePath;

        // تحميل الملف الصوتي لتجاوز الحظر السحابي تماماً
        await youtubedl(song.url, {
            extractAudio: true,
            audioFormat: 'mp3',
            o: filePath,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            addHeader: ['referer:https://www.youtube.com', 'user-agent:Mozilla/5.0'],
            ffmpegLocation: ffmpegPath
        });

        if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
            throw new Error('Downloaded file is empty');
        }

        const resource = createAudioResource(filePath, { inlineVolume: true });
        resource.volume.setVolume(1.0);
        serverQueue.player.play(resource);

        serverQueue.player.once(AudioPlayerStatus.Idle, () => {
            cleanupFile(filePath);
            serverQueue.currentFile = null;
            serverQueue.songs.shift();
            playSong(guild, serverQueue.songs[0]);
        });

    } catch (err) {
        console.error('Playback error:', err);
        cleanupFile(serverQueue.currentFile);
        serverQueue.currentFile = null;
        serverQueue.songs.shift();
        if (serverQueue.songs.length > 0) playSong(guild, serverQueue.songs[0]);
    }
}

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const rawContent = message.content.trim();
    let targetUrl = '';
    const words = rawContent.split(/\s+/);
    for (const word of words) {
        if (word.startsWith('http://') || word.startsWith('https://')) {
            targetUrl = word;
            break;
        }
    }

    if (!targetUrl) return;

    let serverQueue = queue.get(message.guildId);
    if (!serverQueue) {
        const voiceChannel = message.guild.channels.cache.get(TARGET_CHANNEL);
        if (voiceChannel) {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guildId,
                adapterCreator: message.guild.voiceAdapterCreator,
                selfDeaf: true
            });
            const player = createAudioPlayer();
            connection.subscribe(player);
            serverQueue = {
                voiceChannel,
                connection,
                player,
                songs: [],
                currentFile: null
            };
            queue.set(message.guildId, serverQueue);
        }
    }

    const msg = await message.channel.send('⏳ جاري تحميل وتشغيل المقطع...');

    try {
        let title = targetUrl;
        try {
            const info = await youtubedl(targetUrl, { dumpSingleJson: true, noCheckCertificates: true });
            title = info.title || targetUrl;
        } catch (e) {}

        serverQueue.songs.push({ title, url: targetUrl });
        
        if (serverQueue.songs.length === 1) {
            await msg.edit(`✅ جاري تشغيل: **${title}**`);
            playSong(message.guild, serverQueue.songs[0]);
        } else {
            await msg.edit(`✅ تمت الإضافة لقائمة الانتظار: **${title}**`);
        }
    } catch (e) {
        console.error(e);
        await msg.edit('❌ حدث خطأ أثناء تحميل الرابط.');
    }
});

client.login(BOT_TOKEN);
