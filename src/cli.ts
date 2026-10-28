/**
 * BoneStudio batch CLI.
 *
 * Mirrors the flow of the shipped `DragonBones Tools` (`convertTo.js`) so a
 * project can be converted from a script:
 *
 *   bone-studio inspect <file>
 *   bone-studio convert -i <file> -o <out> -t binary|json
 *
 * `binary` writes a `*_ske.dbbin` container, `json` writes a normalised
 * `*_ske.json`. Both accept either input form.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { DbSkeletonData } from './core/types';
import { encodeDbbin } from './core/export/dbbin';
import { decodeDbbin } from './core/parse/dbbinDecode';
import { parseSkeletonData, serializeSkeletonData, skeletonSummary } from './core/parse/ske';
import { parseTextureAtlas } from './core/parse/texture';
import { parseDbproj, serializeDbproj, unwrapProjectSkeleton, wrapSkeletonAsProject } from './core/project/dbproj';
import { packAtlas, serializeSpineAtlas, serializeTextureAtlas } from './core/export/atlas';
import { serializeSpineSkeleton } from './core/export/spine';
import { exportSpine4 } from './core/export/spine4';
import { blitRaster, cropRaster, decodePng, encodePng } from './tools/png';

const USAGE = [
  'BoneStudio CLI',
  '',
  '  inspect <file>                             print a format summary',
  '  convert -i <file> -o <out> -t <type>       convert a skeleton document',
  '  repack  -i <tex.json> -o <dir>             re-pack a texture atlas',
  '  project -i <file> -o <out>                 dump/pack a .dbproj project',
  '  spine   -i <file> -o <dir>                 export Spine JSON (+ .atlas when *_tex.json sits next to it)',
  '  --spine-version 4.2|4.1|3.6                 Spine target (default 4.2; 3.6 = legacy toSpine-compatible writer)',
  '',
  '  -t binary | json        convert output type (default: binary)',
  '  -o may be a file path or an existing directory',
  '  --max-width <px>        atlas page width ceiling (repack, default 2048)',
  '  --padding <px>          gap between sprites (repack, default 1)',
  '  --spine                 also write a Spine .atlas alongside the JSON',
].join('\n');

type Format = 'binary' | 'json';

function fail(message: string): never {
  console.error(message);
  console.error(`\n${USAGE}`);
  process.exit(2);
}

/** Read a `*_ske.json` or `*_ske.dbbin` document plus its origin format. */
function readDocument(path: string): { doc: DbSkeletonData; from: Format } {
  if (!existsSync(path)) fail(`no such file: ${path}`);
  const bytes = readFileSync(path);
  if (extname(path).toLowerCase() === '.dbbin') {
    return { doc: decodeDbbin(bytes).json as DbSkeletonData, from: 'binary' };
  }
  return { doc: parseSkeletonData(JSON.parse(bytes.toString('utf8'))).raw, from: 'json' };
}

function parseArgs(argv: string[]): { command: string; input?: string; output?: string; type: Format } {
  const command = argv[0] ?? '';
  let input: string | undefined;
  let output: string | undefined;
  let type: Format = 'binary';
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (token === '-i' || token === '--input') input = argv[++i];
    else if (token === '-o' || token === '--output') output = argv[++i];
    else if (token === '-t' || token === '--type') {
      const value = argv[++i];
      if (value !== 'binary' && value !== 'json') fail(`unknown output type: ${value}`);
      type = value;
    } else if (!input && !token.startsWith('-')) input = token;
    else if (token === '--max-width' || token === '--padding' || token === '--spine-version') i++;
    else if (token === '--spine') continue;
    else if (token.startsWith('--')) continue;
    else fail(`unknown argument: ${token}`);
  }
  return { command, input, output, type };
}

function targetDirOf(file: string): string {
  return dirname(file);
}

function flagValue(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Resolve `-o` against a directory, keeping the `_ske` naming convention. */
function outputPath(output: string, input: string, type: Format): string {
  const stem = basename(input).replace(/\.(json|dbbin)$/i, '');
  const base = stem.endsWith('_ske') ? stem : `${stem}_ske`;
  if (!existsSync(output) && extname(output) !== '') return output;
  mkdirSync(output, { recursive: true });
  return join(output, `${base}${type === 'binary' ? '.dbbin' : '.json'}`);
}

export function main(argv: string[]): number {
  const { command, input, output, type } = parseArgs(argv);
  if (!command || command === '-h' || command === '--help') {
    console.log(USAGE);
    return 0;
  }

  if (command === 'inspect') {
    if (!input) fail('inspect needs a file');
    const path = resolve(input);
    const { doc, from } = readDocument(path);
    console.log(JSON.stringify({ file: path, format: from, armatures: skeletonSummary(parseSkeletonData(doc)) }, null, 2));
    return 0;
  }

  if (command === 'convert') {
    if (!input) fail('convert needs -i <file>');
    const source = resolve(input);
    const { doc, from } = readDocument(source);
    const target = outputPath(resolve(output ?? dirname(source)), source, type);
    if (type === 'binary') {
      writeFileSync(target, Buffer.from(encodeDbbin(doc)));
    } else {
      const normalised = from === 'binary' ? doc : parseSkeletonData(doc).raw;
      writeFileSync(target, serializeSkeletonData(parseSkeletonData(normalised)));
    }
    console.log(`${from} -> ${type}: ${target}`);
    return 0;
  }

  if (command === 'spine') {
    if (!input) fail('spine needs -i <file>');
    const source = resolve(input);
    const { doc } = readDocument(source);
    // 统一成 JSON 形态，dbbin 输入走同一条路径（与官方 Tools 的输入约定一致）
    const normalised = JSON.parse(serializeSkeletonData(parseSkeletonData(doc))) as DbSkeletonData;
    const dir = resolve(output ?? dirname(source));
    mkdirSync(dir, { recursive: true });
    const texPath = source.replace(/_ske\.(json|dbbin)$/i, '_tex.json');
    const tex = existsSync(texPath) ? parseTextureAtlas(readJsonFile(texPath) as never) : null;
    const regionOf = (path: string) => {
      const region = tex?.byName.get(path) ?? tex?.regions.find((entry) => entry.name === path);
      return region ? { width: region.width, height: region.height } : null;
    };
    const written: string[] = [];
    const vIndex = argv.indexOf('--spine-version');
    const target = vIndex >= 0 ? argv[vIndex + 1] : '4.2';
    if (target === '4.2' || target === '4.1') {
      const rawTex = existsSync(texPath) ? readJsonFile(texPath) as never : null;
      for (const armature of normalised.armature ?? []) {
        const r = exportSpine4(normalised, { armature: armature.name, version: target, texture: rawTex });
        const jsonPath = join(dir, `${armature.name}.json`);
        writeFileSync(jsonPath, JSON.stringify(r.json, null, 1));
        written.push(jsonPath);
        if (r.atlas) { const atlasPath = join(dir, `${armature.name}.atlas`); writeFileSync(atlasPath, r.atlas); written.push(atlasPath); }
      }
      console.log(`spine ${target}: ${written.length} file(s) -> ${dir}`);
      return 0;
    }
    if (target !== '3.6') fail(`unknown --spine-version: ${target}`);
    for (const armature of normalised.armature ?? []) {
      const spine = serializeSpineSkeleton({ armature: [armature], frameRate: normalised.frameRate } as never, { regionOf });
      const jsonPath = join(dir, `${armature.name}.json`);
      writeFileSync(jsonPath, JSON.stringify(spine.spines[0], null, 1));
      written.push(jsonPath);
      if (tex) {
        const packed = {
          width: tex.width,
          height: tex.height,
          placements: tex.regions.map((region) => ({
            name: region.name, x: region.x, y: region.y, width: region.width, height: region.height,
            frameWidth: region.frameWidth, frameHeight: region.frameHeight, frameX: region.frameX, frameY: region.frameY,
          })),
        };
        const atlasPath = join(dir, `${armature.name}.atlas`);
        writeFileSync(atlasPath, serializeSpineAtlas(packed, tex.imagePath.split(/[\\/]/).pop() ?? 'texture.png'));
        written.push(atlasPath);
      }
    }
    console.log(`spine: ${written.length} file(s) -> ${dir}`);
    return 0;
  }

  if (command === 'repack') {
    if (!input) fail('repack needs -i <tex.json>');
    const source = resolve(input);
    const atlas = parseTextureAtlas(readJsonFile(source) as never);
    const imagePath = resolve(dirname(source), atlas.imagePath);
    if (!existsSync(imagePath)) fail('atlas image not found: ' + imagePath);
    const maxWidth = Number(flagValue(argv, '--max-width')) || 2048;
    const padding = Number(flagValue(argv, '--padding'));
    const spines = argv.includes('--spine');
    const raster = decodePng(readFileSync(imagePath));
    const packed = packAtlas(atlas.regions.map((region) => ({
      name: region.name,
      width: region.width,
      height: region.height,
      frameX: region.frameX,
      frameY: region.frameY,
      frameWidth: region.frameWidth,
      frameHeight: region.frameHeight,
    })), { maxWidth, padding: Number.isFinite(padding) ? padding : 1 });
    const page = {
      width: packed.width,
      height: packed.height,
      rgba: new Uint8Array(packed.width * packed.height * 4),
    };
    for (const placement of packed.placements) {
      const region = atlas.byName.get(placement.name);
      if (!region) continue;
      blitRaster(page, cropRaster(raster, region.x, region.y, region.width, region.height), placement.x, placement.y);
    }
    const targetDir = resolve(output ?? dirname(source));
    mkdirSync(targetDir, { recursive: true });
    const stem = basename(source).replace(/\.(json|atlas)$/i, '').replace(/_tex$/, '');
    const imageName = stem + '_tex.png';
    writeFileSync(join(targetDir, imageName), encodePng(page));
    writeFileSync(join(targetDir, stem + '_tex.json'), JSON.stringify(
      serializeTextureAtlas(packed, { imagePath: imageName, name: atlas.name || stem }),
    ));
    if (spines) writeFileSync(join(targetDir, stem + '.atlas'), serializeSpineAtlas(packed, imageName));
    console.log('repacked ' + atlas.regions.length + ' regions into ' + packed.width + 'x' + packed.height + ': ' + targetDir);
    return 0;
  }

  if (command === 'project') {
    if (!input) fail('project needs -i <file>');
    const source = resolve(input);
    if (!existsSync(source)) fail('no such file: ' + source);
    const bytes = readFileSync(source);
    const isProject = source.toLowerCase().endsWith('.dbproj');
    if (isProject) {
      const parsed = parseDbproj(bytes);
      const target = outputPath(resolve(output ?? dirname(source)), source.replace(/\.dbproj$/i, '') + '.json', 'json');
      writeFileSync(target, JSON.stringify(parsed.data, null, 2));
      console.log(parsed.format + ' -> json: ' + target);
            const skeleton = parsed.data && typeof parsed.data === 'object'
        ? unwrapProjectSkeleton(parsed.data as Record<string, unknown>)
        : null;
      if (skeleton) {
        const skePath = join(targetDirOf(target), basename(target).replace(/\.json$/i, '').replace(/[.]project$/, '') + '_ske.json');
        writeFileSync(skePath, JSON.stringify(skeleton, null, 2));
        console.log('project -> skeleton: ' + skePath);
      }
      if (parsed.complete === false) {
              const keys = parsed.data && typeof parsed.data === 'object'
                ? Object.keys(parsed.data as object).length : 0;
              console.warn('WARNING: AMF3 payload decoded only partially (' + keys + ' root keys so far).');
              console.warn('         The dumped JSON is INCOMPLETE - see 格式规范');
            }
      return 0;
    }
    const target = (() => {
      const out = resolve(output ?? dirname(source));
      if (!existsSync(out) && extname(out) !== '') return out;
      mkdirSync(out, { recursive: true });
      return join(out, basename(source).replace(/\.json$/i, '') + '.dbproj');
    })();
    const data = JSON.parse(readFileSync(source, 'utf8'));
    // a bare skeleton document must be wrapped, otherwise the app finds no `dragonBones`
    const project = Array.isArray((data as { armature?: unknown }).armature)
      ? wrapSkeletonAsProject(data as Record<string, unknown>)
      : data;
    const written = serializeDbproj(project, true);
    writeFileSync(target, written);
    console.log('json -> plain-JSON dbproj (' + written.length + ' B, readable by DragonBones): ' + target);
    return 0;
  }

  fail(`unknown command: ${command}`);
}

// Entry module: `vite-node src/cli.ts` rewrites `process.argv[1]`, so the CLI
// runs whenever this file is executed — except under Vitest, which imports
// `main` directly to drive it in-process.
if (!process.env.VITEST) process.exitCode = main(process.argv.slice(2));
