/**
 * AI 面板用的纯函数：各客户端的 MCP 配置片段与「Agent 提示词」。不依赖 DOM / Node，便于单测。
 */
export type ClientId = 'cursor' | 'claude' | 'codex';
export type OsId = 'windows' | 'unix';

export const PLACEHOLDER: Record<OsId, string> = { windows: 'C:/path/to/bone-studio', unix: '/path/to/bone-studio' };

/** 服务端给的是本机路径；所选系统与本机不同就退回占位符。Windows 统一写正斜杠（node 与 JSON 都认，免转义）。 */
export function repoPathFor(os: OsId, info: { repoRoot?: string; platform?: string } | null): string {
  const root = info?.repoRoot;
  if (!root) return PLACEHOLDER[os];
  const isWin = info?.platform === 'win32' || /^[A-Za-z]:[\\/]/.test(root);
  if ((os === 'windows') !== isWin) return PLACEHOLDER[os];
  return root.replace(/\\/g, '/').replace(/\/$/, '');
}

export interface Snippet { id: string; title: string; file?: string; lang: 'json' | 'bash' | 'powershell' | 'toml'; text: string; note?: string }

export function mcpSnippets(client: ClientId, os: OsId, root: string): Snippet[] {
  const server = `${root}/dist-mcp/server.js`;
  const projects = `${root}/projects`;
  const shell = os === 'windows' ? 'powershell' : 'bash';
  const build: Snippet = { id: 'build', title: '1. 先构建 MCP server', lang: shell, text: `cd ${os === 'windows' ? `"${root}"` : root}\nnpm install\nnpm run build:mcp` };
  const json = JSON.stringify({ mcpServers: { 'bone-studio': { command: 'node', args: [server], env: { BONESTUDIO_PROJECTS: projects } } } }, null, 2);
  if (client === 'cursor') {
    return [build,
      { id: 'cursor-project', title: '2a. 项目级（仓库里已带）', file: '.cursor/mcp.json', lang: 'json', note: '在 Cursor 里打开 bone-studio 仓库即可生效；${workspaceFolder} 由 Cursor 展开。',
        text: JSON.stringify({ mcpServers: { 'bone-studio': { command: 'node', args: ['${workspaceFolder}/dist-mcp/server.js'], env: { BONESTUDIO_PROJECTS: '${workspaceFolder}/projects' } } } }, null, 2) },
      { id: 'cursor-global', title: '2b. 全局（任意项目可用）', file: os === 'windows' ? '%USERPROFILE%/.cursor/mcp.json' : '~/.cursor/mcp.json', lang: 'json', text: json },
      { id: 'cursor-oneclick', title: '或：一键安装', lang: shell, text: `npm run install:ai -- --client cursor` }];
  }
  if (client === 'claude') {
    return [build,
      { id: 'claude-cli', title: '2a. 用 claude CLI 注册（用户级）', lang: shell, text: `claude mcp add bone-studio -s user -e BONESTUDIO_PROJECTS=${projects} -- node ${server}` },
      { id: 'claude-json', title: '2b. 或项目级 .mcp.json', file: '<项目根>/.mcp.json', lang: 'json', text: json },
      { id: 'claude-oneclick', title: '或：一键安装', lang: shell, text: `npm run install:ai -- --client claude` }];
  }
  return [build,
    { id: 'codex-toml', title: '2a. Codex（~/.codex/config.toml）', file: os === 'windows' ? '%USERPROFILE%/.codex/config.toml' : '~/.codex/config.toml', lang: 'toml',
      text: `[mcp_servers.bone-studio]\ncommand = "node"\nargs = ["${server}"]\n\n[mcp_servers.bone-studio.env]\nBONESTUDIO_PROJECTS = "${projects}"` },
    { id: 'generic-json', title: '2b. 其它 MCP 客户端（stdio，通用 JSON）', lang: 'json', text: json },
    { id: 'codex-oneclick', title: '或：一键安装（Codex）', lang: shell, text: `npm run install:ai -- --client codex` }];
}

export function skillTargets(os: OsId): Array<{ client: string; path: string }> {
  const home = os === 'windows' ? '%USERPROFILE%' : '~';
  return [
    { client: 'Cursor（项目）', path: '<项目根>/.cursor/skills/bonestudio-mcp/SKILL.md' },
    { client: 'Cursor（全局）', path: `${home}/.cursor/skills/bonestudio-mcp/SKILL.md` },
    { client: 'Claude Code', path: `${home}/.claude/skills/bonestudio-mcp/SKILL.md` },
    { client: 'Codex', path: `${home}/.codex/skills/bonestudio-mcp/SKILL.md` },
  ];
}

/** 粘进外部 agent 就能自己装好的完整提示词 */
export function agentPrompt(opts: { root: string; os: OsId; editorOrigin: string; client?: ClientId }): string {
  const { root, os, editorOrigin } = opts;
  const home = os === 'windows' ? '%USERPROFILE%' : '~';
  return [
    '请帮我把 BoneStudio（2D 骨骼动画编辑器）的 MCP server 和配套 Skill 接入你自己（当前 agent），然后自检。',
    '',
    `仓库路径：${root}`,
    `编辑器（dev server）：${editorOrigin}`,
    '',
    '最快的做法：在仓库根目录运行下面的命令（按你是哪个客户端选 cursor / claude / codex），它会构建 MCP、安装 Skill、注册 MCP 并自检：',
    `  cd ${os === 'windows' ? `"${root}"` : root}`,
    '  npm install',
    '  npm run install:ai -- --client <cursor|claude|codex>',
    '',
    '如果不能运行脚本，就手动完成：',
    '1. 构建：在仓库根目录 `npm install && npm run build:mcp`，确认生成了 dist-mcp/server.js。',
    `2. 安装 Skill：下载 ${editorOrigin}/api/mcp/skill.md（或 ${editorOrigin}/api/mcp/skill.zip，解压得到 bonestudio-mcp/SKILL.md），`,
    `   也可以直接复制仓库里的 docs/SKILL-bone-studio-mcp.md，保存为你的 skills 目录下的 bonestudio-mcp/SKILL.md：`,
    '   - Cursor：<项目根>/.cursor/skills/bonestudio-mcp/SKILL.md（或全局 ' + home + '/.cursor/skills/…）',
    `   - Claude Code：${home}/.claude/skills/bonestudio-mcp/SKILL.md`,
    `   - Codex：${home}/.codex/skills/bonestudio-mcp/SKILL.md`,
    '3. 注册 MCP server（stdio）：command = node，args = ["' + root + '/dist-mcp/server.js"]，env BONESTUDIO_PROJECTS = "' + root + '/projects"。',
    '   - Cursor：写入 .cursor/mcp.json 的 mcpServers["bone-studio"]',
    `   - Claude Code：claude mcp add bone-studio -s user -e BONESTUDIO_PROJECTS=${root}/projects -- node ${root}/dist-mcp/server.js`,
    '   - Codex：在 ~/.codex/config.toml 加 [mcp_servers.bone-studio]（command/args/env 同上）',
    '4. 重新加载 MCP 后自检：先调用 session_set {name:"<你的 agent 名>", task:"安装自检"}（以后每次开工都先调它，编辑器「实时预览」按这个名字显示你），再调用 bone-studio 的 project_list（应返回工作区目录与工程列表），再调用 skeleton_summary（没打开工程时报 "no project open" 属正常）。',
    '   能看到 44 个左右的工具（project_import、bone_key、render_animation、spine_export…）就算成功。',
    '   多个 agent 同时工作时，写别人锁住的工程会报「正被 <名字> 编辑」——换工程或 project_save 另存，不要硬写。',
    '   在编辑器里看：仓库根目录 npm run dev → 欢迎页「AI 工程」分区（与内置示例分开），或用 editor_url 返回的 ?aiproject=<工程>&live=1 链接；AI 工作区由 BONESTUDIO_PROJECTS 决定（默认 <仓库>/projects），不要设 BONESTUDIO_SAMPLES。',
    '5. 把结果（工具数量、session_set 返回的会话 id、project_list 返回、你修改了哪些配置文件）告诉我。不要修改仓库里的其它代码。',
  ].join('\n');
}
