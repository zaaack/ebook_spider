import { task, desc, option, fs, logger, setGlobalOptions } from 'foy'
import crypto from 'crypto'
import cheerio, { load } from 'cheerio'
import axios from 'axios'
import { basename, join } from 'path'
setGlobalOptions({ loading: false })
function hash(u: string) {
  return crypto.createHash('md5').update(u).digest('base64url')
}

function url2page(u: string, ext = '.html') {
  return hash(u) + ext
}
function save(f: string, data: any) {
  // if (fs.existsSync(f)) return
  return fs.outputFile(f, data)
}
function normalUrl(u?: string) {
  if (!u) return u
  if (u.startsWith('//')) return 'https:' + u
  return u
}

const conf = {
  // url: 'https://mp.weixin.qq.com/s/vDV9cZtYBnV4AcuFTdfBNw', //  宣宾老师×形法感悟和经验集锦
  // url: 'https://mp.weixin.qq.com/s/Y0Fu6FNd4KN3wHCnzGC9Yg', // 火柴棒医生手记
  // url: 'https://mp.weixin.qq.com/s/t45XaHYHbITLgXX0nLMfYg', //易安、刘凤民、牛先明等人体×形平衡法实践分享目录
  // url: 'https://mp.weixin.qq.com/s/0KnnI-D-PNL6Pwj0BpnCpg', //《×形法疗效反馈》目录
  url: 'https://mp.weixin.qq.com/s/D_lNwzZo3EZ0DXwHAwZP2Q', // 《人体×形平衡法》目录
  title: '',
  dir: './宣宾',
}
task('start', async (ctx) => {
  const pagesJson = `${conf.dir}/pages.json`
  const assetsJson = `${conf.dir}/assets.json`
  const pages = new Map<string, { url: string; title: string; file: string }>(
    fs.existsSync(pagesJson) ? fs.readJsonSync(pagesJson) : []
  )
  const assets = new Set<string>(
    fs.existsSync(assetsJson) ? fs.readJsonSync(assetsJson) : []
  )

  async function saveJson() {
    await fs.outputJson(pagesJson, Array.from(pages.entries()), { space: 2})
    await fs.outputJson(assetsJson, Array.from(assets), { space: 2 })
  }
  async function fetchPage({ url, title }) {
    if (pages.has(url)) return
    pages.set(url, {} as any)
    let data = await (await axios.get(url)).data
    let $ = load(data)
    let tasks = $('a')
      .toArray()
      .map(async (e) => {
        let remoteUrl = normalUrl($(e).attr('href'))
        if (
          !remoteUrl ||
          !remoteUrl.startsWith('http') ||
          !remoteUrl.includes('mp.weixin.qq.com')
        )
          return
        let title = $(e).text()
        $(e).attr('href', `./${url2page(remoteUrl)}`)
        await fetchPage({ url: remoteUrl, title })
      })
    let imgTasks = $('img')
      .toArray()
      .map(async (e) => {
        let remoteUrl = normalUrl($(e).attr('data-src'))
        if (!remoteUrl) return
        let file = `${conf.dir}/html/${url2page(remoteUrl, '.jpg')}`
        $(e).attr('src', `./${url2page(remoteUrl, '.jpg')}`)
        $(e).attr(
          'style',
          $(e)
          .attr('style')
          ?.replace(/display\s*:\s*none\s*;?/g, '')
        )
        // 即使存在也要更新html外联
        if (assets.has(remoteUrl)) return
        assets.add(remoteUrl)
        let data = await (
          await axios.get(remoteUrl, { responseType: 'arraybuffer' })
        ).data
        await save(file, data)
      })
    let cssTasks = $('link[rel="stylesheet"]')
      .toArray()
      .map(async (e) => {
        let remoteUrl = normalUrl($(e).attr('href'))
        if (!remoteUrl) return
        let file = `${conf.dir}/html/${url2page(remoteUrl, '.css')}`
        $(e).attr('href', `./${url2page(remoteUrl, '.css')}`)
        // 即使存在也要更新html外联
        if (assets.has(remoteUrl)) return
        assets.add(remoteUrl)
        let data = await (await axios.get(remoteUrl)).data
        await save(file, data)
      })
    logger.info('start url:', url)
    await Promise.all(tasks.concat(imgTasks).concat(cssTasks)).catch((e) =>
      logger.error(e.message, e.stack, e.response?.data)
    )
    let file = `${conf.dir}/html/${url2page(url)}`
    pages.set(url, {
      url,
      title: ($('#activity-name').text() || title).trim(),
      file,
    })
    try {
      $('link[rel="mask-icon"]').remove()
      $('link[rel="shortcut"]').remove()
      $('link[rel="apple-touch-icon-precomposed"]').remove()
      $('link[rel="modulepreload"]').remove()
      $('link["dns-prefetch"]').remove()
    } catch (error) {
      logger.warn(error)
    }
    await save(file, $.html())
    await saveJson()
    logger.info('end url:', url)
    logger.info('pages.size', pages.size)
  }

  await fetchPage({ url: conf.url, title: '' })
})

task('fix', async (ctx) => {
  await fs.iter('./宣宾/html', async (p, s) => {
    if (p.endsWith('.html')) {
      let content = await fs.readFile(p, 'utf-8')
      let $ = load(content)
      let imgTasks = $('img')
        .toArray()
        .map(async (e) => {
          let src = normalUrl($(e).attr('data-src'))
          if (src?.startsWith('http')) {
            let f = `./宣宾/html/${url2page(src, '.jpg')}`
            if (!fs.existsSync(f)) {
              try {
                let data = await (await axios.get(src, { responseType: 'arraybuffer'})).data
                logger.info('download', f, src)
                await fs.outputFile(f, data)
              } catch (error) {
                error.url = src
                error.file = f
                throw error
              }
            }
            $(e).attr('src', `./${url2page(src, '.jpg')}`)
          }
          $(e).attr(
            'style',
            $(e)
              .attr('style')
              ?.replace(/display\s*:\s*none\s*;?/g, '')
          )
        })
      await Promise.all(imgTasks).catch(e => logger.error(e.message, e.stack, e.url, e.file))
      // $('link[rel="stylesheet"]')
      //   .toArray()
      //   .map((e) => {
      //     let src = normalUrl($(e).attr('href'))
      //     if (src?.startsWith('http')) {
      //       $(e).attr('href', `./${url2page(src, '.css')}`)
      //     }
      //   })

      // $('link[rel="mask-icon"]').remove()
      // $('link[rel="shortcut"]').remove()
      // $('link[rel="apple-touch-icon-precomposed"]').remove()
      // $('link[rel="modulepreload"]').remove()
      // $('link[rel="dns-prefetch"]').remove()
      // await fs.outputFile(p, $.html())
    }
  })
})

const home = 'orzud2bptae9vNdbZPVTkA.html'


task('tar', async (ctx) => {
  await fs.rmrf('./宣宾.tar.gz')
  await ctx.exec(`tar -c --use-compress-program=pigz -f ./宣宾.tar.gz ./宣宾`)
})
task('untar', async (ctx) => {
  await ctx.exec(`tar -x --use-compress-program=pigz -f ./宣宾.tar.gz`)
})

task('pages', async ctx => {
  let f = './宣宾/pages.json'
  let pages = await fs.readJson(f)
  pages.forEach(([k, v]) => {
    v.title = v.title.trim()
  })
  await fs.outputJson(f, pages, { space: 2 })
})
task('epubee', async ctx => {
    const dir = '/mnt/e/阿里云盘/ePUBee🐝整站电子书500G'
    const files: {name: string, path: string}[] = []
    await fs.iter(dir, (path, s) => {
      if (s.isFile() && path.endsWith('.epub')) {
        files.push({
          name: basename(path, '.epub'),
          path: path.replace(dir, '.')
        })
      }
    })
    await fs.outputJson(join(dir, 'books.json'), files)
})
