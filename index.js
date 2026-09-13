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
const ytdl = require('@distube/ytdl-core');

const BOT_TOKEN = process.env.TOKEN_1;
const TARGET_CHANNEL = '1518935693240565820';
const BOT_NAME = 'Camora Music';

function createWelcomePanel() {
    const embed = new EmbedBuilder()
        .setColor('#2b2d31')
        .setTitle('🎵 Camora Music - لوحة التحكم')
        .setDescription('**أرسل رابط يوتيوب مباشرة في الشات وسيعمل المقطع فوراً!**')
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('start_listening').setLabel('البدء بالاستماع').setStyle(ButtonStyle.Success).setEmoji('▶️'),
        new ButtonBuilder().setLabel('YouTube').setStyle(ButtonStyle.Link).setUrl('https://www.youtube.com').setEmoji('🔴')
    );

    return { embeds: [embed], components: [row] };
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
    console.log(`🤖 [${BOT_NAME}] is online: ${client.user.tag}`);

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
                    textChannel: null,
                    voiceChannel,
                    connection,
                    player,
                    songs: [],
                    loop: false,
                    volume: 1,
                    lastPanel: null
                });
                console.log(`✅ Locked into room: ${voiceChannel.name}`);
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
        serverQueue.lastPanel = null;
        return;
    }

    try {
        const stream = ytdl(song.url, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 });
        const resource = createAudioResource(stream, { inlineVolume: true });
        
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
            if (serverQueue.loop) {
                playSong(guild, serverQueue.songs[0]);
            } else {
                serverQueue.songs.shift();
                playSong(guild, serverQueue.songs[0]);
            }
        });

    } catch (err) {
        serverQueue.songs.shift();
        if (serverQueue.songs.length > 0) playSong(guild, serverQueue.songs[0]);
    }
}

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    if (message.content.trim() === '!panel') {
        return message.channel.send(createWelcomePanel());
    }

    let content = message.content.trim();
    if (content.startsWith('!play')) {
        content = content.replace('!play', '').trim();
    } else if (content.startsWith('!p')) {
        content = content.replace('!p', '').trim();
    } else if (content.startsWith('!')) {
        content = content.replace('!', '').trim();
    }

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
                textChannel: message.channel,
                voiceChannel,
                connection,
                player,
                songs: [],
                loop: false,
                volume: 1,
                lastPanel: null
            };
            queue.set(message.guildId, serverQueue);
        }
    }

    serverQueue.textChannel = message.channel;
    const msg = await message.channel.send('⏳ جاري جلب المقطع...');

    try {
        const songInfo = await ytdl.getInfo(content);
        const title = songInfo.videoDetails.title;
        const targetUrl = content;

        if (serverQueue.songs.length === 0) {
            serverQueue.songs.push({ title, url: targetUrl });
            await msg.edit(`✅ جاري تشغيل: **${title}**`);
            playSong(message.guild, serverQueue.songs[0]);
        } else {
            serverQueue.songs.push({ title, url: targetUrl });
            await msg.edit(`✅ تمت الإضافة لقائمة الانتظار: **${title}**`);
        }
    } catch (e) {
        await msg.edit('❌ حدث خطأ أثناء جلب الرابط.');
    }
});

client.on('interactionCreate', async interaction => {
    try {
        const guildId = interaction.guildId;
        let serverQueue = queue.get(guildId);

        if (interaction.isButton() && interaction.customId === 'start_listening') {
            return interaction.reply({ content: '💡 أرسل رابط يوتيوب مباشرة في الشات وسيعمل البوت فوراً!', ephemeral: true });
        }

        if (!serverQueue) return;
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
                serverQueue.lastPanel = null;
                return interaction.reply({ content: '⏹️ تم إيقاف التشغيل.', ephemeral: true });
            }
        }
    } catch (err) {}
});

client.login(BOT_TOKEN);
