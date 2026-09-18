const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior } = require('@discordjs/voice');
const play = require('play-dl');

// إعداد الكوكيز لتخطي حظر يوتيوب (Error 429)
if (process.env.YOUTUBE_COOKIE) {
    play.setToken({
        youtube: {
            cookie: process.env.YOUTUBE_COOKIE
        }
    }).then(() => {
        console.log("🍪 YouTube Cookies Loaded Successfully!");
    }).catch(err => {
        console.error("❌ Failed to load YouTube Cookies:", err);
    });
}

const BOT_TOKEN = process.env.TOKEN_1; // تأكد إن المتغير في Railway اسمه TOKEN_1
const TARGET_CHANNEL = '1518935693240565820';
const PREFIX = '!play ';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const queue = new Map();

// دالة مخصصة لإنشاء اللاعب (Player) وربط الأحداث فيه مرة واحدة لتفادي تكرار المقاطع
function createQueuePlayer(guildId) {
    const player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play }
    });

    player.on(AudioPlayerStatus.Idle, () => {
        const serverQueue = queue.get(guildId);
        if (serverQueue) {
            serverQueue.songs.shift(); // حذف الأغنية التي انتهت
            if (serverQueue.songs.length > 0) {
                playSong(serverQueue.voiceChannel.guild, serverQueue.songs[0]); // تشغيل التالية
            }
        }
    });

    // لتفادي توقف البوت في حال حدوث خطأ داخلي في المشغل
    player.on('error', error => {
        console.error(`Player Error: ${error.message}`);
        const serverQueue = queue.get(guildId);
        if (serverQueue) {
            serverQueue.songs.shift();
            if (serverQueue.songs.length > 0) {
                playSong(serverQueue.voiceChannel.guild, serverQueue.songs[0]);
            }
        }
    });

    return player;
}

client.once('ready', () => {
    console.log(`🤖 [Camora Music] is online: ${client.user.tag}`);

    // الانضمام التلقائي للروم
    const channel = client.channels.cache.get(TARGET_CHANNEL);
    if (channel && channel.type === ChannelType.GuildVoice) {
        try {
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: true
            });

            const player = createQueuePlayer(channel.guild.id);
            connection.subscribe(player);

            queue.set(channel.guild.id, {
                voiceChannel: channel,
                connection,
                player,
                songs: []
            });
            console.log(`✅ Locked into room: ${channel.name}`);
        } catch (err) {
            console.error('Connection error:', err);
        }
    }
});

async function playSong(guild, song) {
    const serverQueue = queue.get(guild.id);
    if (!song || !song.url || !serverQueue) return;

    try {
        let streamData = await play.stream(song.url);
        const resource = createAudioResource(streamData.stream, { 
            inputType: streamData.type,
            inlineVolume: true 
        });
        
        resource.volume.setVolume(1.0);
        serverQueue.player.play(resource);

    } catch (err) {
        console.error('Playback error details:', err);
        // إذا فشل التشغيل، نتخطى المقطع ونشغل اللي بعده
        serverQueue.songs.shift();
        if (serverQueue.songs.length > 0) playSong(guild, serverQueue.songs[0]);
    }
}

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith(PREFIX)) return;

    const targetUrl = message.content.slice(PREFIX.length).trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        return message.reply('❌ يرجى كتابة رابط صحيح بعد الأمر.');
    }

    let serverQueue = queue.get(message.guildId);
    
    // إذا لم يكن هناك اتصال مسبق أو البوت تم طرده، نعيد الاتصال
    if (!serverQueue) {
        const voiceChannel = message.guild.channels.cache.get(TARGET_CHANNEL);
        if (!voiceChannel) {
            return message.reply('❌ لم أتمكن من العثور على الروم الصوتي المحدد في السيرفر.');
        }

        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guildId,
                adapterCreator: message.guild.voiceAdapterCreator,
                selfDeaf: true
            });
            
            const player = createQueuePlayer(message.guildId);
            connection.subscribe(player);
            
            serverQueue = {
                voiceChannel,
                connection,
                player,
                songs: []
            };
            queue.set(message.guildId, serverQueue);
        } catch (err) {
            console.error(err);
            return message.reply('❌ حدث خطأ أثناء محاولة الانضمام للروم.');
        }
    }

    const msg = await message.channel.send('⏳ جاري جلب وتشغيل المقطع...');

    try {
        const videoInfo = await play.video_basic_info(targetUrl);
        const title = videoInfo.video_details.title || 'مقطع غير معروف';

        serverQueue.songs.push({ title, url: targetUrl });
        
        if (serverQueue.songs.length === 1) {
            await msg.edit(`✅ جاري تشغيل: **${title}**`);
            playSong(message.guild, serverQueue.songs[0]);
        } else {
            await msg.edit(`✅ تمت الإضافة لقائمة الانتظار: **${title}** (ترتيبها: ${serverQueue.songs.length})`);
        }
    } catch (e) {
        console.error('Fetch error details:', e);
        await msg.edit('❌ حدث خطأ أثناء جلب الرابط. (قد يكون المقطع محظور أو خاص)');
    }
});

client.login(BOT_TOKEN);
