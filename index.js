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

const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);

function cleanupFile(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
    }
}

// 🎛️ واجهة رسالة الترحيب والبدء (تشبه الصورة التي أرسلتها)
function createWelcomePanel(botName) {
    const embed = new EmbedBuilder()
        .setColor('#2b2d31')
        .setTitle(`🎵 ${botName} - لوحة التحكم`)
        .setDescription('**اكتب اسم أو رابط الأغنية في الشات للاستماع، أو اضغط على أزرار المنصات أدناه:**')
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('start_listening').setLabel('البدء بالاستماع').setStyle(ButtonStyle.Success).setEmoji('▶️'),
        new ButtonBuilder().setLabel('YouTube').setStyle(ButtonStyle.Link).setUrl('https://www.youtube.com').setEmoji('🔴'),
        newButtonBuilder().setLabel('Spotify').setStyle(ButtonStyle.Link).setUrl('https://www.spotify.com').setEmoji('🟢')
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

function launchBot(token, targetChannelId, botName) {
    if (!token) return;

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

        client.guilds.cache.forEach(async guild => {
            const voiceChannel = guild.channels.cache.get(targetChannelId);
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
            const filePath = path.join(downloadsDir, `${botName.replace(/\s+/g, '')}_${Date.now()}.mp3`);
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

    client.on('messageCreate', async message => {
        if (message.author.bot || !message.guild) return;
        
        let query = message.content.trim();
        if (query.startsWith('!play')) {
            query = query.replace('!play', '').trim();
        } else if (!query.startsWith('http')) {
            return; // يقبل الروابط مباشرة بدون أوامر معقدة
        }

        if (!query) return;

        let serverQueue = queue.get(message.guildId);
        if (!serverQueue) {
            const voiceChannel = message.guild.channels.cache.get(targetChannelId);
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
                    currentFile: null,
                    lastPanel: null
                };
                queue.set(message.guildId, serverQueue);
            }
        }

        serverQueue.textChannel = message.channel;
        const msg = await message.channel.send('⏳ جاري جلب المقطع...');

        try {
            let targetUrl, title;
            if (query.startsWith('http')) {
                targetUrl = query;
                try {
                    const info = await youtubedl(query, { dumpSingleJson: true, noCheckCertificates: true });
                    title = info.title || query;
                } catch (e) { title = query; }
            } else {
                const results = await play.search(query, { limit: 1 });
                if (!results || !results.length) return msg.edit('❌ لم يتم العثور على نتائج.');
                targetUrl = results[0].url;
                title = results[0].title;
            }

            if (serverQueue.songs.length === 0) {
                serverQueue.songs.push({ title, url: targetUrl });
                await msg.edit(`✅ **[${botName}]** جاري تشغيل: **${title}**`);
                playSong(message.guild, serverQueue.songs[0]);
            } else {
                serverQueue.songs.push({ title, url: targetUrl });
                await msg.edit(`✅ **[${botName}]** تمت الإضافة لقائمة الانتظار: **${title}**`);
            }
        } catch (e) {
            await msg.edit('❌ حدث خطأ أثناء تشغيل المقطع.');
        }
    });

    client.on('interactionCreate', async interaction => {
        try {
            const guildId = interaction.guildId;
            let serverQueue = queue.get(guildId);

            if (interaction.isButton() && interaction.customId === 'start_listening') {
                return interaction.reply({ content: '💡 أرسل رابط يوتيوب أو اسم الأغنية مباشرة في الشات وسيقوم البوت بتشغيلها!', ephemeral: true });
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
                    cleanupFile(serverQueue.currentFile);
                    serverQueue.currentFile = null;
                    serverQueue.lastPanel = null;
                    return interaction.reply({ content: '⏹️ تم إيقاف التشغيل.', ephemeral: true });
                }
            }
        } catch (err) {}
    });

    client.login(token).catch(e => {});

    // أول ما يكتب البوت رسالة أو يفتح، إذا تبي يرسل لوحة الترحيب بأي شات يكتب فيه أول مرة:
    client.on('messageCreate', async message => {
        if (message.author.bot || !message.guild) return;
        if (message.content === '!panel' || message.content === '!setup') {
            await message.channel.send(createWelcomePanel(botName));
        }
    });
}

// تشغيل البوتين بالترتيب ومكتومي الصوت
launchBot(process.env.TOKEN_1, '1518935693240565820', 'Camora Music 1');
launchBot(process.env.TOKEN_2, '1548657289529917621', 'Camora Music 2');
