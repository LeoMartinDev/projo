import { join } from 'node:path'

export type TestVideo = {
  container: 'mkv' | 'mp4'
  video: 'h264' | 'hevc'
  audio: 'aac' | 'ac3' | 'flac'
  durationS: number
  pixelFormat?: 'yuv420p' | 'yuv420p10le'
  gopFrames?: number
}

export const audioDelayS = 0.03

const encoders = { h264: 'libx264', hevc: 'libx265', aac: 'aac', ac3: 'ac3', flac: 'flac' }

export const hasFfmpeg = (): boolean =>
  (Bun.which('ffmpeg') ?? '') !== '' && (Bun.which('ffprobe') ?? '') !== ''

export const hasFfmpegEncoder = (name: string): boolean =>
  hasFfmpeg() &&
  Bun.spawnSync(['ffmpeg', '-hide_banner', '-h', `encoder=${name}`])
    .stdout.toString()
    .startsWith(`Encoder ${name} `)

export const generateVideo = async (dir: string, spec: TestVideo): Promise<string> => {
  const pixelFormat = spec.pixelFormat ?? 'yuv420p'
  const gop = spec.gopFrames ?? 48
  const path = join(
    dir,
    `${spec.video}-${spec.audio}-${spec.durationS}s${pixelFormat === 'yuv420p' ? '' : `-${pixelFormat}`}${gop === 48 ? '' : `-gop${gop}`}.${spec.container}`,
  )
  const proc = Bun.spawn({
    cmd: [
      'ffmpeg',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=160x90:rate=24',
      '-itsoffset',
      String(audioDelayS),
      '-t',
      String(spec.durationS - audioDelayS),
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      '-t',
      String(spec.durationS),
      '-c:v',
      encoders[spec.video],
      '-preset',
      'ultrafast',
      '-g',
      String(gop),
      '-bf',
      '2',
      '-pix_fmt',
      pixelFormat,
      ...(spec.video === 'hevc'
        ? ['-x265-params', `log-level=error:keyint=${gop}:min-keyint=${gop}:scenecut=0`]
        : ['-sc_threshold', '0']),
      '-c:a',
      encoders[spec.audio],
      ...(spec.container === 'mp4' ? ['-movflags', '+faststart'] : []),
      path,
    ],
    stdout: 'ignore',
    stderr: 'pipe',
  })
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  if (code !== 0) throw new Error(`ffmpeg failed to generate ${path}: ${stderr}`)
  return path
}

export const ffprobeJson = async (path: string) => {
  const proc = Bun.spawn({
    cmd: ['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path],
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) throw new Error(`ffprobe failed on ${path}: ${stderr}`)
  return JSON.parse(stdout) as {
    format: { duration?: string; format_name: string }
    streams: { codec_type: string; codec_name: string; duration?: string }[]
  }
}

export const decodesCleanly = async (path: string): Promise<boolean> => {
  const proc = Bun.spawn({
    cmd: ['ffmpeg', '-v', 'error', '-xerror', '-i', path, '-f', 'null', '-'],
    stdout: 'ignore',
    stderr: 'pipe',
  })
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  const problems = stderr
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.includes('non monotonically increasing dts'))
  return code === 0 && problems.length === 0
}
