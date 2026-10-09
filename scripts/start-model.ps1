param(
    [ValidateSet('cpu','cuda')][string]$Device = 'cpu',
    [ValidateSet('auto','none','4bit')][string]$Quantization = 'auto',
    [int]$Port = 8787
)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
if ($Device -eq 'cuda') {
    $gpuPython = Join-Path $projectDirectory '.conda/sortnest-cuda/python.exe'
    if (-not (Test-Path -LiteralPath $gpuPython)) {
        throw 'CUDA 环境未安装。请先运行 scripts/setup-cuda.ps1。'
    }
    & $gpuPython -s "$projectDirectory/services/wemm_server.py" --model-dir "$projectDirectory/WeMM-Embedding-2B" --device cuda --quantization $Quantization --port $Port
} else {
    conda run --no-capture-output -n sortnest python -s "$projectDirectory/services/wemm_server.py" --model-dir "$projectDirectory/WeMM-Embedding-2B" --device cpu --quantization $Quantization --port $Port
}
exit $LASTEXITCODE
