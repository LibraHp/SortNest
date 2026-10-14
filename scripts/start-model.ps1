param(
    [ValidateSet('cpu','cuda')][string]$Device = 'cpu',
    [int]$Port = 8787
)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$modelDir = Join-Path $projectDirectory 'EmbeddingGemma-2'
if (-not (Test-Path -LiteralPath (Join-Path $modelDir 'model.safetensors'))) {
    throw "缺少模型权重：$modelDir。请先下载 google/embeddinggemma-2 到该目录。"
}
if ($Device -eq 'cuda') {
    $gpuPython = Join-Path $projectDirectory '.conda/sortnest-cuda/python.exe'
    if (-not (Test-Path -LiteralPath $gpuPython)) {
        throw 'CUDA 环境未安装。请先运行 scripts/setup-cuda.ps1。'
    }
    & $gpuPython -s "$projectDirectory/services/gemma_server.py" --model-dir $modelDir --device cuda --port $Port
} else {
    conda run --no-capture-output -n sortnest python -s "$projectDirectory/services/gemma_server.py" --model-dir $modelDir --device cpu --port $Port
}
exit $LASTEXITCODE
