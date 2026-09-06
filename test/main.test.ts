/**
 * 端到端验证扫描 / 联动删除 / 撤销的行为。
 * 在 Electron 主进程里跑，因为 trashManager 依赖 electron 的 shell.trashItem。
 *
 *   npm run test
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { app } from 'electron'
import { scanDirectory } from '../src/main/photoLibrary'
import { deletePhotos, pendingCount, undoDelete } from '../src/main/trashManager'
import { TRASH_DIR_NAME } from '../src/shared/types'

/**
 * 最小的合法 1x1 JPEG。按段拼出来而不是抄一长串 hex，免得手抄出错。
 * SOI + APP0 + DQT + SOF0 + DHT + SOS + 压缩数据 + EOI
 */
const JPEG = Buffer.from(
  [
    'ffd8', // SOI
    'ffe000104a46494600010100000100010000', // APP0/JFIF
    'ffdb004300' + 'ff'.repeat(64), // DQT：全 ff 量化表
    'ffc00011080001000101011100', // SOF0：1x1，单通道
    'ffc40014000100000000000000000000000000000009', // DHT
    'ffda0008010100003f00', // SOS
    'd2cf20', // 熵编码数据
    'ffd9' // EOI
  ].join(''),
  'hex'
)

const failures: string[] = []
let passed = 0

async function it(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures.push(name)
    console.log(`  ✗ ${name}`)
    console.log(`    ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 铺一份固定的测试目录。 */
async function fixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'photoflow-test-'))
  const write = (name: string, data: Buffer | string) => fs.writeFile(path.join(dir, name), data)

  await Promise.all([
    write('P1011677.JPG', JPEG),
    write('P1011677.RW2', 'panasonic raw'),
    write('P1011678.JPG', JPEG),
    write('P1011678.rw2', '小写扩展名也要联动'),
    write('P1011679.JPG', JPEG), // 没有 RAW
    write('IMG_0001.JPG', JPEG),
    write('IMG_0001.CR3', 'canon raw'),
    write('IMG_0001.JPG.xmp', '挂在 JPG 上的边车'),
    write('DSC00042.JPG', JPEG),
    write('DSC00042.ARW', 'sony raw'),
    write('DSC00042.ARW.xmp', '挂在 RAW 上的边车'),
    write('notes.txt', '非图片，应被忽略'),
    write('P1011680.RW2', '孤立 RAW，没有同名 JPG，不该出现在列表里')
  ])
  await fs.mkdir(path.join(dir, 'sub'))
  await write(path.join('sub', 'CHILD.JPG'), JPEG)
  return dir
}

const exists = (p: string) =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false)

async function run(): Promise<void> {
  console.log('photoLibrary.scanDirectory')

  await it('只列 JPG，忽略 txt、孤立 RAW 和子目录', async () => {
    const dir = await fixture()
    const { photos } = await scanDirectory(dir)
    assert.deepEqual(
      photos.map((p) => p.name),
      ['DSC00042.JPG', 'IMG_0001.JPG', 'P1011677.JPG', 'P1011678.JPG', 'P1011679.JPG']
    )
  })

  await it('配出同名 RAW，含小写扩展名与 XMP 边车', async () => {
    const dir = await fixture()
    const { photos } = await scanDirectory(dir)
    const byName = new Map(photos.map((p) => [p.name, p.sidecars.map((s) => path.basename(s))]))
    assert.deepEqual(byName.get('P1011677.JPG'), ['P1011677.RW2'])
    assert.deepEqual(byName.get('P1011678.JPG'), ['P1011678.rw2'])
    assert.deepEqual(byName.get('P1011679.JPG'), [])
    assert.deepEqual(byName.get('IMG_0001.JPG'), ['IMG_0001.CR3', 'IMG_0001.JPG.xmp'])
    assert.deepEqual(byName.get('DSC00042.JPG'), ['DSC00042.ARW', 'DSC00042.ARW.xmp'])
  })

  await it('跳过暂存区目录本身', async () => {
    const dir = await fixture()
    await fs.mkdir(path.join(dir, TRASH_DIR_NAME))
    await fs.writeFile(path.join(dir, TRASH_DIR_NAME, 'GHOST.JPG'), JPEG)
    const { photos } = await scanDirectory(dir)
    assert.ok(!photos.some((p) => p.name === 'GHOST.JPG'))
  })

  console.log('trashManager.deletePhotos')

  await it('删除 JPG 时同名 RAW 一起消失', async () => {
    const dir = await fixture()
    const { photos } = await scanDirectory(dir)
    const target = photos.find((p) => p.name === 'P1011677.JPG')!
    const result = await deletePhotos([target])

    assert.equal(result.failures.length, 0)
    assert.equal(await exists(path.join(dir, 'P1011677.JPG')), false)
    assert.equal(await exists(path.join(dir, 'P1011677.RW2')), false)
    // 其他照片不受影响。
    assert.equal(await exists(path.join(dir, 'P1011678.JPG')), true)
    assert.equal(result.batch.entries.length, 2)
  })

  await it('文件搬进暂存区而非直接抹掉', async () => {
    const dir = await fixture()
    const { photos } = await scanDirectory(dir)
    const target = photos.find((p) => p.name === 'IMG_0001.JPG')!
    const result = await deletePhotos([target])

    const batchDir = path.join(dir, TRASH_DIR_NAME, result.batch.id)
    assert.deepEqual((await fs.readdir(batchDir)).sort(), [
      'IMG_0001.CR3',
      'IMG_0001.JPG',
      'IMG_0001.JPG.xmp'
    ])
  })

  await it('批量删除多张，条目数等于 JPG 加附属文件', async () => {
    const dir = await fixture()
    const { photos } = await scanDirectory(dir)
    const targets = photos.filter((p) => p.name !== 'P1011679.JPG')
    const result = await deletePhotos(targets)

    assert.equal(result.failures.length, 0)
    assert.equal(result.batch.photos.length, 4)
    // 4 张 JPG + RW2 + rw2 + CR3 + JPG.xmp + ARW + ARW.xmp = 10
    assert.equal(result.batch.entries.length, 10)
    assert.deepEqual((await scanDirectory(dir)).photos.map((p) => p.name), ['P1011679.JPG'])
  })

  console.log('trashManager.undoDelete')

  await it('撤销把 JPG 和 RAW 一起搬回原位', async () => {
    const dir = await fixture()
    const { photos } = await scanDirectory(dir)
    const target = photos.find((p) => p.name === 'DSC00042.JPG')!
    const { batch } = await deletePhotos([target])

    const undone = await undoDelete(batch.id)
    assert.equal(undone.failures.length, 0)
    assert.equal(undone.restored.length, 1)
    assert.equal(await exists(path.join(dir, 'DSC00042.JPG')), true)
    assert.equal(await exists(path.join(dir, 'DSC00042.ARW')), true)
    assert.equal(await exists(path.join(dir, 'DSC00042.ARW.xmp')), true)
    // 批次目录搬空后应被清掉。
    assert.equal(await exists(path.join(dir, TRASH_DIR_NAME, batch.id)), false)
  })

  await it('同一批次撤销两次，第二次报不可撤销', async () => {
    const dir = await fixture()
    const { photos } = await scanDirectory(dir)
    const { batch } = await deletePhotos([photos[0]])
    await undoDelete(batch.id)
    const again = await undoDelete(batch.id)
    assert.equal(again.restored.length, 0)
    assert.equal(again.failures.length, 1)
  })

  await it('原位已有同名文件时不覆盖，报告失败', async () => {
    const dir = await fixture()
    const { photos } = await scanDirectory(dir)
    const target = photos.find((p) => p.name === 'P1011677.JPG')!
    const { batch } = await deletePhotos([target])

    // 模拟用户在删除后又放回一个同名 JPG。
    await fs.writeFile(path.join(dir, 'P1011677.JPG'), '外部新建的占位文件')
    const undone = await undoDelete(batch.id)

    assert.ok(undone.failures.some((f) => f.path.endsWith('P1011677.JPG')))
    assert.equal(
      await fs.readFile(path.join(dir, 'P1011677.JPG'), 'utf8'),
      '外部新建的占位文件'
    )
    // RAW 没被占用，仍应还原成功。
    assert.equal(await exists(path.join(dir, 'P1011677.RW2')), true)
  })

  await it('pendingCount 统计未清理的待删文件', async () => {
    const dir = await fixture()
    const { photos } = await scanDirectory(dir)
    const before = pendingCount()
    const { batch } = await deletePhotos([photos.find((p) => p.name === 'P1011678.JPG')!])
    assert.equal(pendingCount(), before + 2)
    await undoDelete(batch.id)
    assert.equal(pendingCount(), before)
  })

  console.log(`\n${passed} 通过，${failures.length} 失败`)
  app.exit(failures.length === 0 ? 0 : 1)
}

app.whenReady().then(run)
