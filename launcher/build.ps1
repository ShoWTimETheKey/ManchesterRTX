# Build ManchesterRTX.exe (the double-click launcher) into the project root with the Visual Studio toolchain.
#   launcher\build.ps1
$here = $PSScriptRoot
$vcvars = Get-ChildItem "C:\Program Files\Microsoft Visual Studio" -Recurse -Filter vcvars64.bat -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if (-not $vcvars) { throw 'vcvars64.bat not found (Visual Studio C++ tools needed)' }
New-Item -ItemType Directory -Force "$here\obj" | Out-Null
$cmd = "call `"$vcvars`" >nul && cd /d `"$here`" && rc /nologo /fo obj\ManchesterRTX.res ManchesterRTX.rc && " +
       "cl /nologo /std:c++20 /O2 /EHsc /utf-8 /W3 /DUNICODE /D_UNICODE /Foobj\ ManchesterRTX.cpp obj\ManchesterRTX.res /Fe..\ManchesterRTX.exe " +
       "/link /SUBSYSTEM:WINDOWS /MANIFEST:NO user32.lib gdi32.lib gdiplus.lib shlwapi.lib ole32.lib"
cmd /c $cmd
if ($LASTEXITCODE -ne 0) { throw "launcher build failed ($LASTEXITCODE)" }
Get-Item "$here\..\ManchesterRTX.exe" | Select-Object Name, Length, LastWriteTime
