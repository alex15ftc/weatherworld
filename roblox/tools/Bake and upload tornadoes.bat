@echo off
rem Double-click: bake every tornado type in Blender, pack and upload them (bake-and-upload-tornadoes.ps1).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bake-and-upload-tornadoes.ps1" %*
echo.
pause
