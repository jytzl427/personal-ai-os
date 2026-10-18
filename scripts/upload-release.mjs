import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function getToken() {
  const out = execSync("git credential fill", {
    input: "protocol=https\nhost=github.com\n"
  }).toString();
  const token = out.match(/password=(.+)/)?.[1]?.trim();
  if (!token) throw new Error("Could not retrieve GitHub token from git credentials");
  return token;
}

const token = getToken();
const OWNER = "jytzl427";
const REPO = "personal-ai-os";
const TAG = "v1.1";

async function main() {
  console.log(`Checking existing releases for ${OWNER}/${REPO}...`);
  const listRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Personal-AI-OS"
    }
  });

  const releases = await listRes.json();
  let release = releases.find((r) => r.tag_name === TAG);

  if (!release) {
    console.log(`Creating release for ${TAG}...`);
    const createRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "Personal-AI-OS"
      },
      body: JSON.stringify({
        tag_name: TAG,
        name: "v1.1 全新页面UI重构与物理微动效交互升级",
        body: `## 🚀 Personal AI OS v1.1 绿色免安装版

### 🌟 核心更新与微动效打磨
- **纯净护眼浅色体系**：坚守暖白天鹅绒底色（\`#f8faf9\`）与森林松针绿主色（\`#154e3f\`），无暗黑模式，高对比度低疲劳；
- **真实物理弹簧微动效**：
  - 页面切换 5px 柔和微升入场（\`0.22s var(--ease-spring)\`）；
  - 任务勾选实体弹簧物理弹跳（\`checkbox-bounce\`）与勾号弹出、标题阻尼划线；
  - 磁吸滑块分段控制（\`SegmentedControl\`），平滑指引切换；
  - 项目卡片浮起与进度条循环水润流光扫描（\`shimmer-sweep\`）；
  - 全局操作按键触觉级按压反馈（\`scale(0.975)\`）；
  - 侧边栏呼吸雷达波脉冲指示灯；
- **今日看板就绪**：整合每日到期任务、收支概览与健康底盘；
- **免安装单文件 EXE**：双击即可启动，无需安装任何 Node.js 或 Rust 环境。

### 📦 资产下载说明
- **\`Personal-AI-OS-v1.1-windows-x64.zip\`**（推荐，仅 36.5MB）：解压后直接双击 \`Personal-AI-OS.exe\` 即可运行。
- **\`Personal-AI-OS.exe\`**（97.4MB）：单文件绿色执行程序。
`,
        draft: false,
        prerelease: false
      })
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create release: ${createRes.status} ${err}`);
    }
    release = await createRes.json();
    console.log(`Release created: ${release.html_url}`);
  } else {
    console.log(`Release already exists: ${release.html_url}`);
  }

  const files = [
    {
      name: "Personal-AI-OS-v1.1-windows-x64.zip",
      path: path.resolve("release", "Personal-AI-OS-v1.1-windows-x64.zip"),
      contentType: "application/zip"
    },
    {
      name: "Personal-AI-OS.exe",
      path: path.resolve("release", "Personal-AI-OS.exe"),
      contentType: "application/vnd.microsoft.portable-executable"
    }
  ];

  for (const file of files) {
    if (!fs.existsSync(file.path)) {
      console.warn(`File not found: ${file.path}, skipping.`);
      continue;
    }

    const existingAsset = release.assets?.find((a) => a.name === file.name);
    if (existingAsset) {
      console.log(`Asset ${file.name} already exists (ID: ${existingAsset.id}), deleting old asset...`);
      await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${existingAsset.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "Personal-AI-OS"
        }
      });
    }

    console.log(`Uploading ${file.name} (${(fs.statSync(file.path).size / (1024 * 1024)).toFixed(1)} MB) via curl...`);
    const uploadUrl = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`;

    const { spawnSync } = await import("node:child_process");
    const result = spawnSync("curl.exe", [
      "-L",
      "--retry", "3",
      "--retry-delay", "2",
      "-X", "POST",
      "-H", `Authorization: Bearer ${token}`,
      "-H", `Content-Type: ${file.contentType}`,
      "--data-binary", `@${file.path}`,
      uploadUrl
    ], { stdio: ["ignore", "pipe", "inherit"] });

    if (result.status !== 0) {
      console.error(`curl failed with exit code ${result.status}`);
    } else {
      try {
        const asset = JSON.parse(result.stdout.toString());
        console.log(`Successfully uploaded ${file.name}! Download URL: ${asset.browser_download_url}`);
      } catch {
        console.log(`Upload output: ${result.stdout.toString().slice(0, 200)}`);
      }
    }
  }

  console.log(`\n🎉 Release published successfully: ${release.html_url}`);
}

main().catch((err) => {
  console.error("Error in release upload:", err);
  process.exit(1);
});
