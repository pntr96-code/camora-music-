const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;

// منع إغلاق البوت عند حدوث أي خطأ مفاجئ بالشبكة أو ديسكورد
process.on('unhandledRejection', error => {
    if (error.code === 10062 || error.code === 40060 || error.code === 170020) return;
});
process.on('uncaughtException', (err) => {
    if (err.code === 10062 || err.code === 40060 || err.code === 170020) return;
});

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const play = require('play-dl');

const BOT_TOKEN = process.env.TOKEN_1;
const TARGET_CHANNEL = '1518935693240565820'; // روم البوت الثابت

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

    // الدخول التلقائي للروم فور إقلاع البوت
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
            } catch (err) {
                console.log(`❌ Error joining voice:`, err);
            }
        }
    });
});

async function playSong(guild, song) {
    const serverQueue = queue.get(guild.id);
    if (!song) {
        return;
    }

    try {
        // جلب البث الصوتي المباشر
        const stream = await play.stream(song.url);
        const resource = createAudioResource(stream.stream, { 
            inputType: stream.type, 
            inlineVolume: true 
        });
        
        resource.volume.setVolume(1.0); // صوت واضح وقوي
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

    let content = message.content.trim();
    
    // دعم الأوامر المباشرة أو إرسال الرابط بدون أمر
    if (content.startsWith('!play')) {
        content = content.replace('!play', '').trim();
    } else if (content.startsWith('!p')) {
        content = content.replace('!p', '').trim();
    }

    // إذا لم يكن رابط يوتيوب، تجاهل الرسالة
    if (!content.includes('http://') && !content.includes('https://')) return;

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
        const songInfo = await play.video_info(content);
        const title = songInfo.video_details.title;
        const targetUrl = content;

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
