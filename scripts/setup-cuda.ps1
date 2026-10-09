$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$gpuPrefix = Join-Path $projectDirectory '.conda/sortnest-cuda'
$gpuPython = Join-Path $gpuPrefix 'python.exe'
$pipTemp = Join-Path $projectDirectory '.cache/pip-temp'
New-Item -ItemType Directory -Force $pipTemp | Out-Null
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
try {
    $env:TEMP = $pipTemp
    $env:TMP = $pipTemp
    if (-not (Test-Path -LiteralPath $gpuPython)) {
        conda create --prefix $gpuPrefix --clone sortnest --offline -y
        if ($LASTEXITCODE -ne 0) { throw '创建 CUDA 环境失败。' }
    }
    & $gpuPython -s -m pip install torch==2.11.0+cu128 torchvision==0.26.0+cu128 --index-url https://download.pytorch.org/whl/cu128 --no-cache-dir
    if ($LASTEXITCODE -ne 0) { throw '安装 CUDA PyTorch 失败。' }
    & $gpuPython -s -m pip install bitsandbytes==0.50.2 --index-url https://pypi.org/simple --no-cache-dir
    if ($LASTEXITCODE -ne 0) { throw '安装量化依赖失败。' }
    & $gpuPython -s -c "import torch; assert torch.cuda.is_available(), 'CUDA unavailable'; print(torch.__version__, torch.cuda.get_device_name(0))"
    if ($LASTEXITCODE -ne 0) { throw 'CUDA 检查失败，请检查 NVIDIA 驱动。' }
} finally {
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
}
