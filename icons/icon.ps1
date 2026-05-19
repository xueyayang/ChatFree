# resize-icons.ps1 - 将 icon.png 缩放到 128x128、48x48、16x16，自动覆盖已有文件
# 适用于 PowerShell 7

# 检查 ffmpeg 是否可用
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Error "未找到 ffmpeg，请确保 ffmpeg 已安装并添加到 PATH 环境变量中。"
    exit 1
}

# 执行缩放，-y 表示覆盖已有输出文件
ffmpeg -y `
    -i icon.png -vf scale=128:128 icon128.png `
    -i icon.png -vf scale=48:48 icon48.png `
    -i icon.png -vf scale=16:16 icon16.png

# 检查执行结果
if ($LASTEXITCODE -eq 0) {
    Write-Host "图标缩放完成：icon128.png, icon48.png, icon16.png"
} else {
    Write-Error "ffmpeg 执行出错，退出代码：$LASTEXITCODE"
}
