@echo off
title Checklive - Sao luu
cd /d "%~dp0.."
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "TS=%%i"
echo Dang sao luu...
docker compose exec -T backup pg_dump -h db -U checklive -Fc -f /backups/checklive-thucong-%TS%.dump checklive
if errorlevel 1 (
  echo [LOI] Sao luu that bai. Checklive co dang chay khong?
  pause
  exit /b 1
)
echo Da sao luu vao: backups\checklive-thucong-%TS%.dump
echo Nen chep thu muc backups sang Google Drive / USB thuong xuyen.
pause
