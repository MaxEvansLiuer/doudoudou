# 把本项目推到 GitHub（在 doudoudou 目录里运行：.\push.ps1）
# 前置：装 git  →  winget install --id Git.Git -e --source winget
#       装完要新开一个终端窗口，git 才在 PATH 里

$repo = "https://github.com/MaxEvansLiuer/doudoudou.git"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "没有检测到 git。" -ForegroundColor Yellow
    Write-Host "先执行：winget install --id Git.Git -e --source winget" -ForegroundColor Yellow
    Write-Host "装完关掉这个窗口，重新开一个 PowerShell 再跑一次本脚本。" -ForegroundColor Yellow
    exit 1
}

Write-Host "== 1/5 初始化仓库 ==" -ForegroundColor Cyan
if (-not (Test-Path ".git")) { git init | Out-Null }
git branch -M main

Write-Host "== 2/5 设置提交身份（可改） ==" -ForegroundColor Cyan
if (-not (git config user.name))  { git config user.name  "MaxEvansLiuer" }
if (-not (git config user.email)) { git config user.email "MaxEvansLiuer@users.noreply.github.com" }

Write-Host "== 3/5 暂存并提交 ==" -ForegroundColor Cyan
git add .
git commit -m "拼豆图纸识别 v0.2：网格对齐 / 图例反推色号 / 选区编辑 / 导出" 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "（没有新改动，继续）" -ForegroundColor DarkGray }

Write-Host "== 4/5 关联远程 ==" -ForegroundColor Cyan
git remote remove origin 2>$null
git remote add origin $repo

Write-Host "== 5/5 推送 ==" -ForegroundColor Cyan
Write-Host "如果弹出登录窗口：用户名填 MaxEvansLiuer，密码填 Personal Access Token（不是账号密码）" -ForegroundColor DarkGray
Write-Host "没 token 就去：GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens" -ForegroundColor DarkGray
Write-Host "  权限只勾选 repo（Contents: Read and write）即可。" -ForegroundColor DarkGray

git push -u origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "推送失败，尝试先把远程已有内容拉下来合并…" -ForegroundColor Yellow
    git pull --rebase origin main --allow-unrelated-histories
    git push -u origin main
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✔ 推送完成：https://github.com/MaxEvansLiuer/doudoudou" -ForegroundColor Green
    Write-Host "  想开 Pages：Settings → Pages → Branch 选 main + / (root) → Save" -ForegroundColor Green
    Write-Host "  然后访问：https://maxevansliuer.github.io/doudoudou/" -ForegroundColor Green
} else {
    Write-Host "✗ 还是失败：多半是没登录 / token 权限不够。也可以直接用网页上传（见 DEPLOY.md）" -ForegroundColor Red
}
