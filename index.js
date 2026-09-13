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
const ytdl = require('@distube/ytdl-core');

const BOT_TOKEN = process.env.TOKEN_1;
const TARGET_CHANNEL = '1518935693240565820';

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
                    songs: []
                });
                console.log(`✅ Locked into room: ${voiceChannel.name}`);
            } catch (err) {}
        }
    });
});

async function playSong(guild, song) {
    const serverQueue = queue.get(guild.id);
    if (!song || !song.url) return;

    try {
        // تشغيل مباشر ونقي عبر ytdl-core بدون الحاجة لبايثون أو أدوات خارجية
        const stream = ytdl(song.url, { 
            filter: 'audioonly', 
            quality: 'highestaudio', 
            highWaterMark: 1 << 25,
            dlChunkSize: 0 
        });

        const resource = createAudioResource(stream, { inlineVolume: true });
        resource.volume.setVolume(1.0);
        serverQueue.player.play(resource);

        serverQueue.player.once(AudioPlayerStatus.Idle, () => {
            serverQueue.songs.shift();
            playSong(guild, serverQueue.songs[0]);
        });

    } catch (err) {
        console.error('Playback error:', err);
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
                songs: []
            };
            queue.set(message.guildId, serverQueue);
        }
    }

    const msg = await message.channel.send('⏳ جاري جلب وتشغيل المقطع...');

    try {
        const songInfo = await ytdl.getInfo(targetUrl);
        const title = songInfo.videoDetails.title || targetUrl;

        serverQueue.songs.push({ title, url: targetUrl });
        
        if (serverQueue.songs.length === 1) {
            await msg.edit(`✅ جاري تشغيل: **${title}**`);
            playSong(message.guild, serverQueue.songs[0]);
        } else {
            await msg.edit(`✅ تمت الإضافة لقائمة الانتظار: **${title}**`);
        }
    } catch (e) {
        console.error(e);
        await msg.edit('❌ حدث خطأ أثناء جلب الرابط.');
    }
});

client.login(BOT_TOKEN);
