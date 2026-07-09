import fs from 'fs'
import os from 'os'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import yts from 'yt-search'

const execAsync = promisify(exec)

// youtube-dl-exec é opcional (o binário dele não existe pra todas arquiteturas,
// ex: Termux/Android). Se não estiver disponível, caímos pro yt-dlp do sistema.
let ytdlExec = null
try {
  const mod = await import('youtube-dl-exec')
  ytdlExec = mod.default
} catch {
  ytdlExec = null
}

function extractVideoId(url) {
  const m = url.match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

async function search(query) {
  try {
    const id = extractVideoId(query)
    const video = id ? await yts({ videoId: id }) : (await yts(query)).videos?.[0]

    if (!video) return { ok: false, msg: 'Nenhum vídeo encontrado' }

    return {
      ok: true,
      data: {
        videoId: video.videoId,
        url: video.url || `https://www.youtube.com/watch?v=${video.videoId}`,
        title: video.title,
        description: video.description || '',
        thumbnail: video.thumbnail,
        seconds: video.seconds,
        timestamp: video.timestamp,
        views: video.views,
        ago: video.ago || '',
        author: { name: video.author?.name || 'Desconhecido' }
      }
    }
  } catch (err) {
    return { ok: false, msg: err.message }
  }
}

// Roda o yt-dlp: tenta o binário do npm (youtube-dl-exec) primeiro,
// se não existir/falhar usa o comando "yt-dlp" instalado no sistema (pip).
async function downloadWithYtDlp(url, { audioOnly, output }) {
  if (ytdlExec) {
    try {
      const opts = {
        noPlaylist: true,
        output
      }
      if (audioOnly) {
        opts.extractAudio = true
        opts.audioFormat = 'mp3'
        opts.audioQuality = 5
      } else {
        opts.format = 'bestvideo[ext=mp4][height<=480]+bestaudio[ext=m4a]/best[ext=mp4]/best'
        opts.mergeOutputFormat = 'mp4'
      }
      await ytdlExec(url, opts)
      return
    } catch (err) {
      // binário do npm falhou (ex: arquitetura não suportada) — cai pro sistema
    }
  }

  const args = audioOnly
    ? `-x --audio-format mp3 --audio-quality 5`
    : `-f "bestvideo[ext=mp4][height<=480]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4`

  await execAsync(
    `yt-dlp ${args} --no-playlist -o "${output}" "${url}"`,
    { maxBuffer: 1024 * 1024 * 300, timeout: 180000 }
  )
}

async function getTitleWithYtDlp(url) {
  if (ytdlExec) {
    try {
      const info = await ytdlExec(url, { getTitle: true, noPlaylist: true })
      if (typeof info === 'string' && info.trim()) return info.trim()
    } catch {}
  }
  try {
    const { stdout } = await execAsync(`yt-dlp --get-title --no-playlist "${url}"`, { timeout: 30000 })
    if (stdout?.trim()) return stdout.trim()
  } catch {}
  return null
}

// Baixa e converte para mp3 (grátis, sem apikey)
async function mp3(url) {
  const tmpBase = path.join(os.tmpdir(), `nazuna_yt_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  const finalFile = `${tmpBase}.mp3`

  try {
    await downloadWithYtDlp(url, { audioOnly: true, output: `${tmpBase}.%(ext)s` })

    if (!fs.existsSync(finalFile)) {
      throw new Error('Não foi possível gerar o arquivo de áudio (verifique se o yt-dlp está instalado)')
    }

    const buffer = fs.readFileSync(finalFile)
    const title = (await getTitleWithYtDlp(url)) || 'audio'

    fs.unlink(finalFile, () => {})

    return {
      ok: true,
      buffer,
      title,
      thumbnail: '',
      filename: `${title.replace(/[^\w\s]/gi, '').slice(0, 60) || 'audio'}.mp3`
    }
  } catch (err) {
    try { if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile) } catch {}
    return { ok: false, msg: err.message }
  }
}

// Baixa vídeo (mp4)
async function mp4(url) {
  const tmpBase = path.join(os.tmpdir(), `nazuna_yt_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  const finalFile = `${tmpBase}.mp4`

  try {
    await downloadWithYtDlp(url, { audioOnly: false, output: `${tmpBase}.%(ext)s` })

    if (!fs.existsSync(finalFile)) {
      throw new Error('Não foi possível gerar o arquivo de vídeo (verifique se o yt-dlp está instalado)')
    }

    const buffer = fs.readFileSync(finalFile)
    const title = (await getTitleWithYtDlp(url)) || 'video'

    fs.unlink(finalFile, () => {})

    return {
      ok: true,
      buffer,
      title,
      thumbnail: '',
      filename: `${title.replace(/[^\w\s]/gi, '').slice(0, 60) || 'video'}.mp4`
    }
  } catch (err) {
    try { if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile) } catch {}
    return { ok: false, msg: err.message }
  }
}

export { search, mp3, mp4 }
export const ytmp3 = mp3
export const ytmp4 = mp4

