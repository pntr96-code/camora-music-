const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const play = require('play-dl');

const BOT_TOKEN = process.env.TOKEN_1;
const TARGET_CHANNEL = '1518935693240565820';
const PREFIX = '!play '; // الأمر المخصص لتشغيل الأغنية

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
            } catch (err) {
                console.error('Connection error:', err);
            }
        }
    });
});

async function playSong(guild, song) {
    const serverQueue = queue.get(guild.id);
    if (!song || !song.url) return;

    try {
        let streamData = await play.stream(song.url);
        const resource = createAudioResource(streamData.stream, { 
            inputType: streamData.type,
            inlineVolume: true 
        });
        
        resource.volume.setVolume(1.0);
        serverQueue.player.play(resource);

        serverQueue.player.removeAllListeners(AudioPlayerStatus.Idle);
        serverQueue.player.once(AudioPlayerStatus.Idle, () => {
            serverQueue.songs.shift();
            playSong(guild, serverQueue.songs[0]);
        });

    } catch (err) {
        console.error('Playback error details:', err);
        serverQueue.songs.shift();
        if (serverQueue.songs.length > 0) playSong(guild, serverQueue.songs[0]);
    }
}

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    // التحقق مما إذا كانت الرسالة تبدأ بالأمر المحدد
    if (!message.content.startsWith(PREFIX)) return;

    const targetUrl = message.content.slice(PREFIX.length).trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        return message.reply('❌ يرجى كتابة رابط يوتيوب صحيح بعد الأمر.');
    }

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
        const videoInfo = await play.video_basic_info(targetUrl);
        const title = videoInfo.video_details.title || targetUrl;

        serverQueue.songs.push({ title, url: targetUrl });
        
        if (serverQueue.songs.length === 1) {
            await msg.edit(`✅ جاري تشغيل: **${title}**`);
            playSong(message.guild, serverQueue.songs[0]);
        } else {
            await msg.edit(`✅ تمت الإضافة لقائمة الانتظار: **${title}**`);
        }
    } catch (e) {
        console.error('Fetch error details:', e);
        await msg.edit('❌ حدث خطأ أثناء جلب الرابط.');
    }
});

client.login(BOT_TOKEN);
