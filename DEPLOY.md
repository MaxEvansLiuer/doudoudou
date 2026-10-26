# 部署与访问说明

## 一句话结论

| 你的诉求 | 能不能 | 怎么做 |
|---|---|---|
| 仓库**私有** + 用 GitHub Pages 免公网访问 | ❌ 免费账号不行 | Pages 对私有仓库要 Pro/Team/Enterprise |
| 仓库**公开** + GitHub Pages | ✅ 免费 | Settings → Pages → 选 `main` + `/ (root)` |
| 仓库私有，但要公网能访问页面 | ✅ 但要换个托管 | Netlify / Vercel / Cloudflare Pages 都支持私有仓库免费部署 |
| 仓库私有，只想自己看 | ✅ | 本地双击 `index.html`；或 `git clone` 后本地开 |

**关键点：私有仓库的页面是"构建产物"，和仓库可见性无关。**
只要把 `index.html` 这套静态文件交给一个"能读私有仓库"的托管服务（Netlify/Vercel 授权一次 GitHub 即可），
就能得到公网 URL，而仓库仍然是私有的。

## 方案 A：仓库公开 + GitHub Pages（最省事，推荐）

1. 仓库 Settings → 最下方 **Change visibility** → 改成 Public（本项目无任何密钥/隐私数据）
2. Settings → **Pages** → Source: `Deploy from a branch`
3. Branch 选 `main`，目录选 `/ (root)` → Save
4. 等 1 分钟，访问：`https://maxevansliuer.github.io/doudoudou/`

> 注意：仓库名要和你实际建的一致；用户名小写。

## 方案 B：仓库保持私有 + Netlify（免费、可用私有仓库）

1. 打开 <https://app.netlify.com/> → Add new site → **Import an existing project**
2. 选 GitHub → 授权 → 选 `MaxEvansLiuer/doudoudou`（私有仓库也能选）
3. Build command 留空，Publish directory 填 `.`（根目录）
4. Deploy → 得到一个 `xxx.netlify.app` 的公网地址

Vercel / Cloudflare Pages 同理：连接私有仓库 → framework 选 "None/Static" → 输出目录 `.`。

## 方案 C：完全自己控制（不想接第三方）

用任意静态托管：自己的服务器 / 对象存储（OSS/COS/R2）/ 内网 nginx。
把仓库里这些文件原样传上去即可（它们就是最终产物，不需要构建）：

```text
index.html  app.js  core.js  mard-palette.js
```

## 关于"私有仓库的 URL 能不能外部访问"

- `https://github.com/...` 私有仓库本身：别人打不开（除非你加协作者）
- `https://raw.githubusercontent.com/...`：私有仓库**必须带 token** 才能读，不能直接嵌到网页里
- jsDelivr 等 CDN：只能代理**公开**仓库
- GitHub Pages：私有仓库的站点默认也**只有自己能看**（同样要 Pro 才有）；公开仓库的站点才是公网可访问

所以想要"仓库私有 + 公网可访问"，实际就是换个托管（方案 B），或者把仓库公开（方案 A）。
