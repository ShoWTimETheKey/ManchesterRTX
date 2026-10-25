# 启动 ManchesterRTX（RTXPT 路径追踪 + DLSS 4 光线重建 / 超分辨率 / 多帧生成）
#   直接运行会出现菜单；也可带参数跳过菜单：
#   tools\launch.ps1 -Scene night -Camera 1 -Dlss quality -FG 3
#   -Scene  day | clear | cloudy | dusk | night
#   -Camera 0 全景, 1 River Street 与 Acer, 2 市政厅, 3 Deansgate 天际线, 4 Castlefield, 5 牛津路街景
#   -Dlss   dlaa | quality | balanced | performance | ultraperformance
#   -FG     0 关, 1 = 2x, 2 = 3x, 3 = 4x（多帧生成需 RTX 50 系列）
#   -Windowed  窗口模式（默认全屏，分辨率取主显示器）
param([string]$Scene='',[int]$Camera=-1,[string]$Dlss='',[int]$FG=-1,[switch]$Windowed,[switch]$NoMenu)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$assets="$root\renderer\Assets"
$bin="$root\renderer\bin"

function Pick($title,$items,$default){
  Write-Host ''
  Write-Host $title -ForegroundColor Cyan
  for($i=0;$i -lt $items.Count;$i++){
    $mark= if($i -eq $default){' (默认)'}else{''}
    Write-Host ("  {0}. {1}{2}" -f ($i+1),$items[$i][1],$mark)
  }
  $r=Read-Host '选择编号，直接回车用默认'
  if($r -match '^\d+$' -and [int]$r -ge 1 -and [int]$r -le $items.Count){ return $items[[int]$r-1][0] }
  return $items[$default][0]
}

$scenes=@(@('day','白天 · 程序化正午天空'),@('clear','晴天 · HDRI 天空，清晰日影'),@('cloudy','多云 · HDRI 天空，柔和阴影'),
          @('dusk','黄昏 · 火烧云 HDRI，灯光渐亮'),@('night','夜晚 · 窗灯、路灯、泛光灯与月光'))
$cams=@(@(0,'全景鸟瞰'),@(1,'River Street Tower（Canvas Manchester）与 Acer Tower（Square Gardens）'),@(2,'市政厅 / Albert Square'),
        @(3,'Deansgate 天际线'),@(4,'Castlefield 运河'),@(5,'Oxford Road 街景（人眼高度）'))
$modes=@(@('dlaa','DLAA · 原生分辨率渲染，最清晰（RTX 5080 4K + 4x 帧生成实测约 136 FPS）'),@('quality','Quality · 渲染 75% 分辨率（4K + 4x 帧生成实测约 212 FPS，推荐）'),@('balanced','Balanced · 58%'),
         @('performance','Performance · 50%（4K 不开帧生成实测约 135 FPS）'),@('ultraperformance','Ultra Performance · 33%'))
$fgs=@(@(0,'关闭'),@(1,'2x'),@(2,'3x'),@(3,'4x 多帧生成（RTX 50 系列）'))

$interactive= -not $NoMenu -and -not $Scene
if($interactive){
  Write-Host 'ManchesterRTX · NVIDIA RTX Path Tracing 1.8.1 · DLSS 4 (SR + RR + MFG)' -ForegroundColor Yellow
  $Scene=Pick '天气 / 时间' $scenes 1
  $Camera=Pick '起始机位（运行中可在 Scene 面板切换相机）' $cams 0
  $Dlss=Pick 'DLSS 超分辨率模式（光线重建 RR 始终开启）' $modes 1
  $FG=Pick 'DLSS 帧生成' $fgs 3
  $w=Read-Host "`n全屏？[Y/n]"
  if($w -match '^[nN]'){ $Windowed=$true }
}
if(-not $Scene){ $Scene='clear' }
if($Camera -lt 0){ $Camera=0 }
if(-not $Dlss){ $Dlss='quality' }
if($FG -lt 0){ $FG=3 }

$src="$assets\manchester-$Scene.scene.json"
if(-not (Test-Path $src)){ throw "找不到场景：$src（先运行 exporter\export.mjs）" }
$json=Get-Content $src -Raw | ConvertFrom-Json
($json.graph | Where-Object { $_.type -eq 'SampleSettings' }).startingCamera=$Camera
$tmp='_launch.scene.json'
[IO.File]::WriteAllText("$assets\$tmp",($json | ConvertTo-Json -Depth 20),(New-Object Text.UTF8Encoding($false)))

$vc=Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentHorizontalResolution } | Select-Object -First 1
$sw=[int]$vc.CurrentHorizontalResolution; $sh=[int]$vc.CurrentVerticalResolution
if(-not $sw){ $sw=3840; $sh=2160 }
if($Windowed){ $W=[int]($sw*2/3); $H=[int]($sh*2/3) } else { $W=$sw; $H=$sh }

$a=@('--scene',$tmp,'--realtimeAA','3','--dlssMode',$Dlss,'--dlssFG',$FG,'--width',$W,'--height',$H)
if(-not $Windowed){ $a+='--fullscreen' }
Write-Host ''
Write-Host ("启动：{0} · 机位 {1} · DLSS {2} · 帧生成 {3} · {4}x{5}{6}" -f $Scene,$Camera,$Dlss,@('关','2x','3x','4x')[$FG],$W,$H,$(if($Windowed){' 窗口'}else{' 全屏'})) -ForegroundColor Green
Write-Host '操作：WASD 移动，Q/E 下降/上升，按住左键拖动转视角，Shift 加速 / Ctrl 减速，F2 隐藏/显示界面（沉浸模式），关闭窗口退出' -ForegroundColor DarkGray
Push-Location $bin
try { $p=Start-Process -FilePath .\Rtxpt.exe -ArgumentList $a -PassThru; $p.WaitForExit() }
finally { Pop-Location; Remove-Item "$assets\$tmp" -ErrorAction SilentlyContinue }
